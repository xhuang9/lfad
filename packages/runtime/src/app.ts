/**
 * The Hono application implementing the daemon ⇄ UI HTTP/SSE contract. Every
 * mutation flows through `@lfad/core`; the {@link BoardIndex} is rebuilt and
 * an SSE `board-changed` event is broadcast synchronously after each write so
 * clients (and the index) stay consistent without waiting for the watcher.
 * Step validation and the `/api/steps` payload derive from the live board
 * config (`getConfig`), so a hot-reloaded `board.yml` takes effect per request.
 */

import {
  appendArtifact,
  appendLog,
  archiveTicket,
  BLOCKED_DIR,
  createTicket,
  dependencyCyclePath,
  dependencyHoldForMove,
  evaluateDependencies,
  inferDependencyBoundary,
  KEYWORD_COLORS,
  isQueue,
  isRunnableInBatch,
  listArchive,
  moveTicket,
  nextStep,
  reactivateTicket,
  parkTicket,
  readTicket,
  renameActiveTicketTags,
  setBody,
  setStepNote,
  setWorktree,
  stepKeys,
  updateFrontmatter,
  unparkTicket,
  type AutomationLevel,
  type BoardConfig,
  type Category,
  type CreateTicketInput,
  type DependencyEdge,
  type DependencyMilestone,
  type Step,
  type Ticket,
} from '@lfad/core'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { isReservedArtifactName, isSafeRelativeName, readArtifacts, resolveTicketFile, saveTicketImage, type Artifact } from './artifacts.js'
import { assertArchivable } from './archive.js'
import type { BoardIndex } from './board-index.js'
import { snapshotBeforeBoardEdit, snapshotBeforeEdit } from './git.js'
import { stepsPayload } from './labels.js'
import { findFlowPluginDir, readManual, readSkillBody } from './manual.js'
import { parseTicketManualTasks } from './manual-tasks.js'
import { parseTicketQuestions, type QuestionInfo } from './questions.js'
import { RunningConflictError, type RunningRegistry } from './running-registry.js'
import type { RunConfig } from './run-config.js'
import { RunConflictError, type RunManager } from './run-manager.js'
import type { SseHub } from './sse.js'
import { createStaticHandler } from './static.js'
import { createWorktree, removeWorktree } from './worktree.js'

/** The six valid ticket categories. */
const CATEGORIES: readonly Category[] = ['ui', 'bug', 'logic', 'business', 'refactor', 'hotfix']

/** The three per-ticket automation levels (absent frontmatter = 'normal'). */
const AUTOMATION_LEVELS: readonly AutomationLevel[] = ['normal', 'express', 'manual']
const DEPENDENCY_MILESTONES: readonly DependencyMilestone[] = ['design-approved', 'done', 'archived']
const SETTINGS_FILE = '.lfad-settings.json'
/** Boards created before the rename keep their settings here until the next save. */
const LEGACY_SETTINGS_FILE = '.hitloop-settings.json'

const KEYWORD_COLOR_SET = new Set(KEYWORD_COLORS)

type CommandPrefix = '/' | '$'
type BoardLayout = 'auto' | 'landscape' | 'portrait'

interface ProjectKeyword {
  word: string
  color: string
}

interface KeywordSettings {
  maxShown: number
  items: ProjectKeyword[]
}

interface PromptTemplates {
  runAll: string
}

interface TagRename {
  from: string
  to: string
}

const DEFAULT_KEYWORD_SETTINGS: KeywordSettings = { maxShown: 3, items: [] }
const DEFAULT_PROMPT_TEMPLATES: PromptTemplates = {
  runAll: 'Use a workflow to run parallel actions and process every board ticket that is not blocked on a user action. '
    + 'The unblocked tickets right now are {ids}. '
    + 'Run {command} <id> for each one in its own parallel lane, and stop each ticket at its next human gate.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readSettings(boardRoot: string): Promise<Record<string, unknown>> {
  try {
    const path = existsSync(join(boardRoot, SETTINGS_FILE)) ? join(boardRoot, SETTINGS_FILE) : join(boardRoot, LEGACY_SETTINGS_FILE)
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeSettings(boardRoot: string, settings: Record<string, unknown>): Promise<void> {
  await writeFile(join(boardRoot, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

function parseKeywordSettings(value: unknown): KeywordSettings | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.maxShown) || (value.maxShown as number) < 1 || !Array.isArray(value.items)) {
    return null
  }
  const items: ProjectKeyword[] = []
  const seen = new Set<string>()
  for (const item of value.items) {
    if (!isRecord(item) || typeof item.word !== 'string' || typeof item.color !== 'string') return null
    const word = item.word.trim()
    const normalized = word.toLocaleLowerCase()
    if (word.length === 0 || seen.has(normalized) || !KEYWORD_COLOR_SET.has(item.color)) return null
    seen.add(normalized)
    items.push({ word, color: item.color })
  }
  return { maxShown: value.maxShown as number, items }
}

function parseTagRenames(value: unknown, settings: KeywordSettings): TagRename[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  const destinations = new Set(settings.items.map((item) => item.word.toLocaleLowerCase()))
  const seen = new Set<string>()
  const renames: TagRename[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.from !== 'string' || typeof item.to !== 'string') return null
    const from = item.from.trim()
    const to = item.to.trim()
    const normalizedFrom = from.toLocaleLowerCase()
    if (from.length === 0 || to.length === 0 || seen.has(normalizedFrom) || !destinations.has(to.toLocaleLowerCase())) return null
    seen.add(normalizedFrom)
    if (from !== to) renames.push({ from, to })
  }
  return renames
}

function parsePromptTemplates(value: unknown): PromptTemplates | null {
  if (!isRecord(value) || typeof value.runAll !== 'string') return null
  if (value.runAll.trim().length === 0 || !value.runAll.includes('{ids}')) return null
  return { runAll: value.runAll }
}

async function readCommandPrefix(boardRoot: string): Promise<CommandPrefix> {
  return (await readSettings(boardRoot)).commandPrefix === '$' ? '$' : '/'
}

async function writeCommandPrefix(boardRoot: string, prefix: CommandPrefix): Promise<void> {
  await writeSettings(boardRoot, { ...await readSettings(boardRoot), commandPrefix: prefix })
}

async function readLayout(boardRoot: string): Promise<BoardLayout> {
  const stored = (await readSettings(boardRoot)).layout
  return stored === 'landscape' || stored === 'portrait' ? stored : 'auto'
}

async function writeLayout(boardRoot: string, layout: BoardLayout): Promise<void> {
  await writeSettings(boardRoot, { ...await readSettings(boardRoot), layout })
}

async function readKeywordSettings(boardRoot: string): Promise<KeywordSettings> {
  return parseKeywordSettings((await readSettings(boardRoot)).keywords) ?? DEFAULT_KEYWORD_SETTINGS
}

async function writeKeywordSettings(boardRoot: string, keywords: KeywordSettings): Promise<void> {
  await writeSettings(boardRoot, { ...await readSettings(boardRoot), keywords })
}

async function readPromptTemplates(boardRoot: string): Promise<PromptTemplates> {
  return parsePromptTemplates((await readSettings(boardRoot)).prompts) ?? DEFAULT_PROMPT_TEMPLATES
}

async function writePromptTemplates(boardRoot: string, prompts: PromptTemplates): Promise<void> {
  const settings = await readSettings(boardRoot)
  const storedPrompts = isRecord(settings.prompts) ? settings.prompts : {}
  await writeSettings(boardRoot, { ...settings, prompts: { ...storedPrompts, ...prompts } })
}

/** Dependencies injected into {@link buildApp}. */
export interface AppDeps {
  boardRoot: string
  uiDir?: string
  /** Where the Document step writes knowledge chunks (relocatable, e.g. ../.readme/chunks). */
  docsChunksDir: string
  /** Where the Document step writes session docs (relocatable, e.g. ../.readme/session). */
  docsSessionsDir: string
  /** Live accessor for the parsed board config (hot-reload safe). */
  getConfig: () => BoardConfig
  index: BoardIndex
  sse: SseHub
  /** The run engine: spawns agent runs, queues them, streams logs over SSE. */
  runManager: RunManager
  /** Ephemeral cooperative leases held by official agent sessions. */
  runningRegistry: RunningRegistry
  /** Host run config — the worktree primitives need codeRepo/worktreeRoot. */
  runConfig: RunConfig
  /** Lazily resolves the daemon's bound port (only known after the server starts). */
  getPort: () => number
}

/** Narrows an unknown value to a step key of the given config (or 'blocked'). */
function isStep(config: BoardConfig, value: unknown): value is Step {
  return typeof value === 'string' && (value === BLOCKED_DIR || stepKeys(config).includes(value))
}

/** Narrows an unknown value to a valid {@link Category}. */
function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

/** Extracts a human-readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Questions + open-input count for one artifacts array, computed in a single
 * pass (shared by the detail GET and the artifact PUT responses).
 */
function detailPayload(artifacts: Artifact[]): { questions: QuestionInfo[], openInputs: number, manualTasks: ReturnType<typeof parseTicketManualTasks> } {
  const questions = parseTicketQuestions(artifacts)
  return { questions, openInputs: questions.filter((q) => q.open).length, manualTasks: parseTicketManualTasks(artifacts) }
}

/**
 * Builds the full Hono app: health, steps, board, ticket detail, ticket
 * create/move, worktree primitives, the SSE stream, and the static UI catch-all.
 */
export function buildApp(deps: AppDeps): Hono {
  const { boardRoot, uiDir, docsChunksDir, docsSessionsDir, getConfig, index, sse, runManager, runningRegistry, runConfig, getPort } = deps
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true }))

  app.get('/api/settings/command-prefix', async (c) => c.json({ prefix: await readCommandPrefix(boardRoot) }))

  app.put('/api/settings/command-prefix', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { prefix?: unknown }
    if (body.prefix !== '/' && body.prefix !== '$') return c.json({ error: 'prefix must be / or $' }, 400)
    await writeCommandPrefix(boardRoot, body.prefix)
    return c.json({ prefix: body.prefix })
  })

  app.get('/api/settings/layout', async (c) => c.json({ layout: await readLayout(boardRoot) }))

  app.put('/api/settings/layout', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { layout?: unknown }
    if (body.layout !== 'auto' && body.layout !== 'landscape' && body.layout !== 'portrait') {
      return c.json({ error: 'layout must be auto, landscape, or portrait' }, 400)
    }
    await writeLayout(boardRoot, body.layout)
    return c.json({ layout: body.layout })
  })

  app.get('/api/settings/keywords', async (c) => c.json({ keywords: await readKeywordSettings(boardRoot) }))

  app.put('/api/settings/keywords', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const keywords = parseKeywordSettings(body.keywords)
    if (keywords === null) {
      return c.json({ error: 'keywords must contain a positive integer maxShown and unique word/color items from the supported palette' }, 400)
    }
    const renames = parseTagRenames(body.renames, keywords)
    if (renames === null) return c.json({ error: 'renames must map unique non-empty source words to words in the saved registry' }, 400)
    if (renames.length > 0 && typeof body.propagate !== 'boolean') {
      return c.json({ error: 'propagate must be true or false when wording changes' }, 400)
    }

    snapshotBeforeBoardEdit(boardRoot, SETTINGS_FILE)
    const result = body.propagate === true
      ? renameActiveTicketTags(boardRoot, getConfig(), renames)
      : { updated: 0, ticketIds: [] }
    await writeKeywordSettings(boardRoot, keywords)
    index.rebuild()
    sse.broadcast()
    return c.json({ keywords, updatedTickets: result.ticketIds })
  })

  app.get('/api/settings/prompts', async (c) => c.json({ prompts: await readPromptTemplates(boardRoot) }))

  app.put('/api/settings/prompts', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const prompts = parsePromptTemplates(body.prompts)
    if (prompts === null) return c.json({ error: 'prompts.runAll must be a non-empty string containing {ids}' }, 400)

    snapshotBeforeBoardEdit(boardRoot, SETTINGS_FILE)
    await writePromptTemplates(boardRoot, prompts)
    index.rebuild()
    sse.broadcast()
    return c.json({ prompts })
  })

  // The in-app manual — skills (read live from the plugin) + board actions,
  // plus the board-level guidance (composed here; manual.ts stays static).
  app.get('/api/manual', (c) => {
    const guidance = getConfig().guidance
    return c.json({ ...readManual(boardRoot), ...(guidance !== undefined ? { guidance } : {}) })
  })

  // Raw SKILL.md body for the dashboard's skill modal — `?key=flow:idea` (plugin)
  // or `?key=flow-add-test` (the board's project-local `.claude/skills`).
  app.get('/api/skills', (c) => {
    const key = c.req.query('key')
    if (key === undefined || key === '') return c.json({ error: 'missing key' }, 400)
    const body = readSkillBody(key, boardRoot)
    if (body === null) return c.json({ error: `unknown skill: ${key}` }, 404)
    return c.json({ key, body })
  })

  app.get('/api/info', async (c) => {
    const pluginDir = findFlowPluginDir()
    let version: string | undefined
    if (pluginDir !== null) {
      try {
        const manifest = JSON.parse(await readFile(`${pluginDir}/.claude-plugin/plugin.json`, 'utf8')) as { version?: unknown }
        if (typeof manifest.version === 'string') version = manifest.version
      } catch {
        // Version is decorative; keep the rest of /api/info available if the
        // installed plugin manifest is absent or malformed.
      }
    }
    return c.json({ boardRoot, port: getPort(), docsChunksDir, docsSessionsDir, ...(version !== undefined ? { version } : {}) })
  })

  app.get('/api/steps', (c) => {
    const config = getConfig()
    return c.json({
      steps: stepsPayload(config),
      ...(config.guidance !== undefined ? { guidance: config.guidance } : {}),
    })
  })

  // Deprecated alias of /api/steps for pre-rename callers (same payload, `stages` field).
  app.get('/api/stages', (c) => c.json({ stages: stepsPayload(getConfig()) }))

  app.get('/api/board', (c) => {
    const running = runningRegistry.snapshot()
    return c.json({
      tickets: index.all().map((t) => ({
        ...t,
        openInputs: index.openInputs(t.id),
        manualTasks: index.manualTasks(t.id),
        ...(index.dependencies(t.id) !== undefined ? { dependencyState: index.dependencies(t.id) } : {}),
        ...(running.has(t.id) ? { running: running.get(t.id) } : {}),
      })),
    })
  })

  const knownTicketId = (value: string): number | null => {
    const id = Number.parseInt(value, 10)
    return Number.isSafeInteger(id) && (index.get(id) !== undefined || index.parked().some((ticket) => ticket.id === id)) ? id : null
  }

  app.post('/api/tickets/:id/claim', async (c) => {
    const id = knownTicketId(c.req.param('id'))
    if (id === null) return c.json({ error: 'Ticket not found' }, 404)
    const body = await c.req.json().catch(() => ({})) as { force?: unknown, label?: unknown }
    try {
      return c.json(runningRegistry.claim(id, {
        force: body.force === true,
        ...(typeof body.label === 'string' && body.label.trim() !== '' ? { label: body.label.trim() } : {}),
      }))
    } catch (err) {
      if (err instanceof RunningConflictError) return c.json({ error: err.message, holder: err.holder }, 409)
      throw err
    }
  })

  app.post('/api/tickets/:id/heartbeat', async (c) => {
    const id = knownTicketId(c.req.param('id'))
    if (id === null) return c.json({ error: 'Ticket not found' }, 404)
    const body = await c.req.json().catch(() => ({})) as { token?: unknown }
    if (typeof body.token !== 'string') return c.json({ error: 'token is required' }, 400)
    const result = runningRegistry.heartbeat(id, body.token)
    return result === null ? c.json({ error: 'Running claim not found or expired' }, 404) : c.json(result)
  })

  app.post('/api/tickets/:id/release', async (c) => {
    const id = knownTicketId(c.req.param('id'))
    if (id === null) return c.json({ error: 'Ticket not found' }, 404)
    const body = await c.req.json().catch(() => ({})) as { token?: unknown }
    if (typeof body.token !== 'string') return c.json({ error: 'token is required' }, 400)
    return c.json({ released: runningRegistry.release(id, body.token) })
  })

  app.post('/api/tickets/:id/clear-running', (c) => {
    const id = knownTicketId(c.req.param('id'))
    if (id === null) return c.json({ error: 'Ticket not found' }, 404)
    return c.json({ cleared: runningRegistry.clear(id) })
  })

  // The `_archive` cold store — a fresh per-request disk read (browse-only, no
  // in-memory index). Same `{ tickets }` shape as /api/board; archived tickets
  // ship plain (no openInputs — the archive view never opens the question flow).
  app.get('/api/archive', (c) =>
    c.json({ tickets: listArchive(boardRoot, getConfig()) }),
  )

  app.get('/api/parked', (c) => c.json({ tickets: index.parked() }))

  app.get('/api/tickets/:id', (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    let ticket: Ticket
    try {
      ticket = readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }
    const artifacts = readArtifacts(boardRoot, config, id)
    return c.json({
      ticket,
      artifacts,
      dependencyState: evaluateDependencies(ticket, [...index.all(), ...index.parked()], listArchive(boardRoot, config), config),
      inferredDependencyBoundary: inferDependencyBoundary(ticket, config),
      ...detailPayload(artifacts),
    })
  })

  // Raw ticket-folder file bytes (markdown + images) for the drawer's renderer.
  app.get('/api/tickets/:id/files/*', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    let relPath: string
    try {
      relPath = decodeURIComponent(c.req.path.replace(/^\/api\/tickets\/[^/]+\/files\//, ''))
    } catch {
      return c.json({ error: 'Not found' }, 404)
    }
    const resolution = resolveTicketFile(boardRoot, getConfig(), id, relPath)
    if (resolution.kind === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    if (resolution.kind === 'not-found') return c.json({ error: 'Not found' }, 404)
    try {
      const file = await readFile(resolution.path)
      // User-authored html AND svg must stay isolated from the daemon origin:
      // both can embed inline script, so the sandbox keeps them scriptable but
      // origin-less (no XSS reach). Raster images are inert and served as-is.
      const sandboxed = resolution.contentType.startsWith('text/html')
        || resolution.contentType === 'image/svg+xml'
      return c.body(new Uint8Array(file), 200, {
        'content-type': resolution.contentType,
        ...(sandboxed ? { 'content-security-policy': 'sandbox allow-scripts' } : {}),
      })
    } catch {
      return c.json({ error: 'Not found' }, 404)
    }
  })

  // Stores a pasted image beside the artifact named in `?file=` and returns the
  // relative `files/<name>` ref to drop into that artifact's markdown. Body is
  // the raw image bytes; Content-Type names the format (image/* only).
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  app.post('/api/tickets/:id/files', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const file = c.req.query('file') ?? 'Idea'
    if (file !== 'Idea' && !isSafeRelativeName(file)) return c.json({ error: 'Invalid file' }, 400)
    // The image's `files/` subfolder is derived from `file`'s folder — reject the
    // core-owned targets so an upload can't land inside the audit log (`log/…`).
    if (file !== 'Idea' && isReservedArtifactName(file)) {
      return c.json({ error: `Reserved file '${file}': images cannot target 'ticket.md' or the 'log/' audit directory` }, 400)
    }
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim()
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.byteLength === 0) return c.json({ error: 'Empty body' }, 400)
    if (bytes.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'Image too large (max 5MB)' }, 413)
    const result = saveTicketImage(boardRoot, getConfig(), id, file, contentType, bytes, Date.now())
    if (result.kind === 'unsupported') return c.json({ error: `Unsupported image type: ${contentType || 'unknown'}` }, 415)
    if (result.kind === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    if (result.kind === 'not-found') return c.json({ error: 'Ticket not found' }, 404)
    if (result.kind === 'write-failed') return c.json({ error: `Failed to save image: ${result.message}` }, 500)
    return c.json({ ref: result.ref })
  })

  app.post('/api/tickets', async (c) => {
    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    if (title.length === 0) return c.json({ error: 'title is required' }, 400)
    if (!isCategory(payload.category)) {
      return c.json({ error: 'category must be one of ui|bug|logic|business|refactor|hotfix' }, 400)
    }

    const config = getConfig()
    const input: CreateTicketInput = { title, category: payload.category }
    if (typeof payload.body === 'string') input.body = payload.body
    if (Array.isArray(payload.tags)) {
      input.tags = payload.tags.filter((t): t is string => typeof t === 'string')
    }
    if (typeof payload.needsDesign === 'boolean') input.needsDesign = payload.needsDesign
    const entryStep = payload.entryStep ?? payload.entryStage // legacy field alias
    if (entryStep !== undefined) {
      if (!isStep(config, entryStep)) return c.json({ error: 'invalid entryStep' }, 400)
      // Only entry-flagged steps accept direct creation (boards may flag several).
      const stepCfg = config.steps.find((s) => s.key === entryStep)
      if (stepCfg?.entry !== true) return c.json({ error: 'entryStep must be an entry step' }, 400)
      input.entryStep = entryStep
    }

    let ticket: Ticket
    try {
      ticket = createTicket(boardRoot, config, input)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket }, 201)
  })

  app.post('/api/tickets/:id/move', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const config = getConfig()
    const toStep = payload.toStep ?? payload.toStage // legacy field alias
    if (!isStep(config, toStep)) {
      return c.json({ error: 'toStep must be a valid step' }, 400)
    }
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined

    let current: Ticket
    try {
      current = readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }
    // Batch guard: a `batch: true` move is a "Run (N)" / Next-all sweep, which
    // may only advance a ticket that is batch-runnable AT ITS CURRENT STEP
    // (the step it is advanced FROM). A named run (no `batch` flag, or
    // `batch: false`) is unchanged — it may still advance manual tickets,
    // live-running tickets, pending-manual-task tickets, etc. The rule mirrors
    // the UI's board affordance via the shared `@lfad/core` predicate, so it
    // cannot drift from `packages/ui/src/runnable.ts`. Evaluated before the
    // per-move dependency boundary check so the sweep's runnability gate is
    // the decisive, specific reason; named runs still fall through to that
    // check.
    if (payload.batch === true) {
      const currentStepCfg = config.steps.find((s) => s.key === current.status)
      const runnable = isRunnableInBatch({
        stepType: currentStepCfg?.type,
        lateral: current.status === BLOCKED_DIR,
        liveRunning: runningRegistry.isRunning(id),
        automationLevel: current.automationLevel,
        manualTasksPending: index.manualTasks(id).pending,
        openInputs: index.openInputs(id),
        dependencyHeld: index.dependencies(id)?.held ?? false,
      })
      if (!runnable) {
        return c.json({
          error: `Ticket ${id} is not batch-runnable at step '${current.status}' (live-running / manual / pending manual task / dependency-held / open inputs / lateral) — use a named run`,
        }, 409)
      }
    }

    const dependencyState = dependencyHoldForMove(
      current,
      toStep,
      [...index.all(), ...index.parked()],
      listArchive(boardRoot, config),
      config,
    )
    if (dependencyState.held) {
      return c.json({
        error: `Ticket ${id} is held before '${toStep}' by ${dependencyState.blockingTicketIds.map((ticketId) => `#${ticketId}`).join(', ')}`,
        dependencyState,
      }, 409)
    }

    let ticket: Ticket
    try {
      ticket = moveTicket(boardRoot, config, id, toStep, reason !== undefined ? { reason } : undefined)
    } catch (err) {
      const message = errorMessage(err)
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  // Replaces the canonical dependency edge set. Defaults are supplied here so
  // every client authors the same boundary/milestone contract.
  app.put('/api/tickets/:id/dependencies', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    let ticket: Ticket
    try {
      ticket = readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    const body = await c.req.json().catch(() => ({})) as { dependencies?: unknown }
    if (!Array.isArray(body.dependencies)) return c.json({ error: 'dependencies must be an array' }, 400)
    const dependencies: DependencyEdge[] = []
    const seen = new Set<number>()
    for (const raw of body.dependencies) {
      if (!isRecord(raw) || !Number.isSafeInteger(raw.ticketId) || (raw.ticketId as number) <= 0) {
        return c.json({ error: 'each dependency needs a positive integer ticketId' }, 400)
      }
      const ticketId = raw.ticketId as number
      if (seen.has(ticketId)) return c.json({ error: `duplicate dependency #${ticketId}` }, 400)
      seen.add(ticketId)
      const blockAtStage = raw.blockAtStage === undefined ? inferDependencyBoundary(ticket, config) : raw.blockAtStage
      if (!isStep(config, blockAtStage) || blockAtStage === BLOCKED_DIR) {
        return c.json({ error: `invalid blockAtStage '${String(blockAtStage)}'` }, 400)
      }
      const unblockWhen = raw.unblockWhen === undefined ? 'done' : raw.unblockWhen
      if (typeof unblockWhen !== 'string' || !(DEPENDENCY_MILESTONES as readonly string[]).includes(unblockWhen)) {
        return c.json({ error: `invalid unblockWhen '${String(unblockWhen)}'` }, 400)
      }
      dependencies.push({ ticketId, blockAtStage, unblockWhen: unblockWhen as DependencyMilestone })
    }

    const allTickets = [...index.all(), ...index.parked(), ...listArchive(boardRoot, config)]
    const knownIds = new Set(allTickets.map((candidate) => candidate.id))
    const missing = dependencies.find((edge) => !knownIds.has(edge.ticketId))
    if (missing !== undefined) {
      return c.json({ error: `prerequisite ticket #${missing.ticketId} was not found` }, 400)
    }
    const cycle = dependencyCyclePath(id, dependencies, allTickets)
    if (cycle !== null) {
      return c.json({
        error: `dependency cycle: ${cycle.map((ticketId) => `#${ticketId}`).join(' -> ')}`,
        cycle,
      }, 409)
    }

    snapshotBeforeEdit(boardRoot, id, 'ticket.md')
    ticket = updateFrontmatter(boardRoot, config, id, { dependencies })
    index.rebuild()
    sse.broadcast()
    const artifacts = readArtifacts(boardRoot, config, id)
    return c.json({
      ticket,
      artifacts,
      dependencyState: index.dependencies(id) ?? evaluateDependencies(ticket, [...index.all(), ...index.parked()], listArchive(boardRoot, config), config),
      inferredDependencyBoundary: inferDependencyBoundary(ticket, config),
      ...detailPayload(artifacts),
    })
  })

  // Archiving is a MOVE into the `_archive` cold store — like the other move
  // routes it writes NO pre-change snapshot (only content edits snapshot), then
  // rebuilds the index + broadcasts so the ticket leaves the live board. Live
  // tickets are in the index; archived ones are not — so an id absent from the
  // index is either already archived (409) or genuinely unknown (404).
  app.post('/api/tickets/:id/archive', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    const body = await c.req.json().catch(() => ({})) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason : undefined

    const current = index.get(id)
    if (current === undefined) {
      if (listArchive(boardRoot, config).some((t) => t.id === id)) {
        return c.json({ error: `Ticket ${id} is already archived` }, 409)
      }
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    try {
      assertArchivable(config, current)
      archiveTicket(boardRoot, config, id, reason !== undefined ? { reason } : undefined)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
    const ticket = readTicket(boardRoot, config, id)
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  // Reactivating is a MOVE out of `_archive` back onto a live step — no
  // snapshot, then index rebuild + broadcast. `toStep` defaults to the step the
  // ticket was archived from (its preserved `status`). A live (non-archived)
  // ticket is rejected (409); an unknown id 404s. `reason` (when given) lands
  // in the ticket log, mirroring the archive audit trail.
  app.post('/api/tickets/:id/reactivate', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    const body = await c.req.json().catch(() => ({})) as { toStep?: unknown, toStage?: unknown, reason?: unknown }

    const archived = listArchive(boardRoot, config).find((t) => t.id === id)
    if (archived === undefined) {
      if (index.get(id) !== undefined) return c.json({ error: `Ticket ${id} is not archived` }, 409)
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    const requested = body.toStep ?? body.toStage // legacy field alias
    const toStep = requested !== undefined ? requested : archived.status
    if (!isStep(config, toStep)) {
      return c.json({ error: 'toStep must be a valid step' }, 400)
    }
    const reason = typeof body.reason === 'string' ? body.reason : undefined

    let ticket: Ticket
    try {
      ticket = reactivateTicket(boardRoot, config, id, toStep)
    } catch (err) {
      const message = errorMessage(err)
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
    if (reason !== undefined) appendLog(boardRoot, config, id, { event: 'reactivated', toStep, reason })
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  app.post('/api/tickets/:id/park', (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    const current = index.get(id)
    if (current === undefined) {
      if (index.parked().some((ticket) => ticket.id === id)) return c.json({ error: `Ticket ${id} is already parked` }, 409)
      if (listArchive(boardRoot, config).some((ticket) => ticket.id === id)) return c.json({ error: `Ticket ${id} is archived and cannot be parked` }, 409)
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }
    try {
      const ticket = parkTicket(boardRoot, config, id)
      index.rebuild()
      sse.broadcast()
      return c.json({ ticket })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
  })

  app.post('/api/tickets/:id/unpark', (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    if (!index.parked().some((ticket) => ticket.id === id)) {
      if (index.get(id) !== undefined || listArchive(boardRoot, config).some((ticket) => ticket.id === id)) {
        return c.json({ error: `Ticket ${id} is not parked` }, 409)
      }
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }
    try {
      const ticket = unparkTicket(boardRoot, config, id)
      index.rebuild()
      sse.broadcast()
      return c.json({ ticket })
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
  })

  app.put('/api/tickets/:id/artifact', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const name = typeof payload.name === 'string' ? payload.name : ''
    if (name.length === 0) return c.json({ error: 'name is required' }, 400)
    if (typeof payload.content !== 'string') {
      return c.json({ error: 'content must be a string' }, 400)
    }
    const { content } = payload as { content: string }
    // Nested names (`plan/01-x.md`) are allowed; traversal attempts are not.
    if (name !== 'Idea' && !isSafeRelativeName(name)) {
      return c.json({ error: `Invalid artifact name '${name}': must be a relative path inside the ticket folder (no '..', dot-entries, or absolute paths)` }, 400)
    }
    // Core owns the frontmatter spine (`ticket.md`) and the append-only `log/`
    // audit dir; the "Idea" pseudo-artifact routes to setBody (spine-safe), but a
    // literal `ticket.md`/`log/…` here would clobber or tamper them — reject it.
    if (name !== 'Idea' && isReservedArtifactName(name)) {
      return c.json({ error: `Reserved artifact name '${name}': 'ticket.md' (the frontmatter spine) and the 'log/' audit directory cannot be written through this route` }, 400)
    }

    const config = getConfig()
    // Resolve the ticket first so an unknown id 404s before any git/write side-effect.
    try {
      readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    // Optimistic-concurrency guard: when the client sends `baseContent` (the
    // artifact content its rewrite was derived from), a mismatch with the
    // current on-disk content means the file changed between the client's read
    // and this PUT — 409 instead of silently overwriting the newer edit. The
    // compare-then-write below is synchronous, so no other request interleaves.
    if (typeof payload.baseContent === 'string') {
      const before = readArtifacts(boardRoot, config, id).find((a) => a.name === name)
      if (before === undefined || before.content !== payload.baseContent) {
        return c.json({ error: 'The document changed since it was read — refresh and retry' }, 409)
      }
    }

    // SPEC §7: commit a pre-change snapshot of the current board, THEN write.
    snapshotBeforeEdit(boardRoot, id, name)

    let ticket: Ticket
    try {
      // "Idea" is how readArtifacts surfaces the ticket body (the config's
      // `artifact: body` case) — editing it rewrites the body, at any step.
      if (name === 'Idea') {
        ticket = setBody(boardRoot, config, id, content)
      } else {
        appendArtifact(boardRoot, config, id, name, content)
        ticket = readTicket(boardRoot, config, id)
      }
    } catch (err) {
      const message = errorMessage(err)
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
    index.rebuild()
    sse.broadcast()
    const artifacts = readArtifacts(boardRoot, config, id)
    return c.json({
      ticket,
      artifacts,
      dependencyState: evaluateDependencies(ticket, [...index.all(), ...index.parked()], listArchive(boardRoot, config), config),
      inferredDependencyBoundary: inferDependencyBoundary(ticket, config),
      ...detailPayload(artifacts),
    })
  })

  // The fast-pass note: records `stepNotes.<step> = { applicable: false, reason }`
  // so pull-validate sees WHY a step was passed over. Semantics mirror the CLI's
  // noteCommand exactly — validate the step key + `skip:true` (reason optional),
  // resolve the id BEFORE any git side-effect, and — because a note MODIFIES
  // ticket.md — snapshot the pre-change board first (the same rule as the artifact
  // PUT above; moves don't snapshot, content edits do).
  app.post('/api/tickets/:id/note', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const config = getConfig()
    // A note targets a real pipeline step (never the lateral 'blocked'), matching
    // noteCommand's `assertStep(step, stepKeys(config))`.
    if (typeof payload.step !== 'string' || !stepKeys(config).includes(payload.step)) {
      return c.json({ error: `Unknown step '${String(payload.step)}'` }, 400)
    }
    const step: Step = payload.step
    if (payload.skip !== true) {
      return c.json({ error: 'note records a fast-pass marker: pass skip:true (with a reason) to mark the step not applicable' }, 400)
    }
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined

    // Resolve the ticket first so an unknown id 404s before any git/write side-effect.
    try {
      readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    snapshotBeforeEdit(boardRoot, id, 'ticket.md')
    const ticket = setStepNote(boardRoot, config, id, step, reason !== undefined ? { applicable: false, reason } : { applicable: false })
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  // The per-ticket automation level: writes the `automationLevel` frontmatter
  // field (absent = 'normal') through core's frontmatter writer. Like the note
  // route above, this MODIFIES ticket.md — validate the level, resolve the id
  // BEFORE any git side-effect, and snapshot the pre-change board first.
  app.post('/api/tickets/:id/automation-level', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const config = getConfig()
    if (typeof payload.level !== 'string' || !(AUTOMATION_LEVELS as readonly string[]).includes(payload.level)) {
      return c.json({ error: `Unknown automation level '${String(payload.level)}': must be one of normal|express|manual` }, 400)
    }
    const level = payload.level as AutomationLevel

    // Resolve the ticket first so an unknown id 404s before any git/write side-effect.
    try {
      readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    snapshotBeforeEdit(boardRoot, id, 'ticket.md')
    const ticket = updateFrontmatter(boardRoot, config, id, { automationLevel: level })
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  // Worktree primitives — mechanism only; branch naming and lifecycle policy
  // live in the calling skill. The path is recorded on the ticket frontmatter.
  app.post('/api/tickets/:id/worktree', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    let payload: Record<string, unknown>
    try {
      payload = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const branch = typeof payload.branch === 'string' ? payload.branch.trim() : ''
    if (branch.length === 0) return c.json({ error: 'branch is required' }, 400)

    const config = getConfig()
    try {
      readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    let path: string
    try {
      path = createWorktree(runConfig, id, branch)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400)
    }
    const ticket = setWorktree(boardRoot, config, id, { path })
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket, worktree: { path, branch } })
  })

  app.delete('/api/tickets/:id/worktree', (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)

    const config = getConfig()
    let existingTicket: Ticket
    try {
      existingTicket = readTicket(boardRoot, config, id)
    } catch {
      return c.json({ error: `Ticket ${id} not found` }, 404)
    }

    removeWorktree(runConfig, id, existingTicket.worktree)
    const ticket = setWorktree(boardRoot, config, id, {})
    index.rebuild()
    sse.broadcast()
    return c.json({ ticket })
  })

  // The run engine. Enqueue/stop/list agent runs for a ticket; run log +
  // status events ride the same SSE channel as `board-changed`. An optional
  // body `{step}` pulls the ticket into that step before running (the drawer's
  // skill buttons) — valid targets: the current step or the next applicable
  // one, never a queue step.
  app.post('/api/tickets/:id/run', async (c) => {
    const id = Number.parseInt(c.req.param('id'), 10)
    if (!Number.isSafeInteger(id)) return c.json({ error: 'Invalid ticket id' }, 400)
    const config = getConfig()
    const body = await c.req.json().catch(() => ({})) as { step?: unknown, skill?: unknown }
    let opts: { step?: Step, skill?: string } | undefined

    if (body.skill !== undefined) {
      // A skill action from the drawer: valid when the current step lists it
      // (actions), or it is the current/next step's own skill. A skill bound
      // to the current or next step runs AS that step (pull semantics); any
      // other listed skill runs in place and owns its own movement.
      if (typeof body.skill !== 'string' || body.skill === '') {
        return c.json({ error: 'skill must be a non-empty string' }, 400)
      }
      const skill = body.skill
      let ticket: Ticket
      try {
        ticket = readTicket(boardRoot, config, id)
      } catch {
        return c.json({ error: `Ticket ${id} not found` }, 404)
      }
      const current = config.steps.find((s) => s.key === ticket.status)
      const next = nextStep(config, ticket.status, ticket)
      const nextConfig = next !== undefined ? config.steps.find((s) => s.key === next) : undefined
      const allowed = (current?.actions ?? []).includes(skill)
        || current?.skill === skill
        || nextConfig?.skill === skill
      if (!allowed) {
        return c.json({ error: `Skill '${skill}' is not an action for step '${ticket.status}'` }, 400)
      }
      if (current?.skill === skill) opts = {} // run the current step as-is
      else if (nextConfig?.skill === skill && !isQueue(config, nextConfig.key)) opts = { step: nextConfig.key }
      else opts = { skill } // in-place action run; the skill owns movement
    } else if (body.step !== undefined) {
      if (typeof body.step !== 'string' || !stepKeys(config).includes(body.step)) {
        return c.json({ error: `Unknown step '${String(body.step)}'` }, 400)
      }
      const target: Step = body.step
      if (isQueue(config, target)) return c.json({ error: `Queue step '${target}' never runs` }, 400)
      let ticket: Ticket
      try {
        ticket = readTicket(boardRoot, config, id)
      } catch {
        return c.json({ error: `Ticket ${id} not found` }, 404)
      }
      if (target !== ticket.status && target !== nextStep(config, ticket.status, ticket)) {
        return c.json({ error: `Step '${target}' is neither the ticket's current step nor the next applicable one` }, 400)
      }
      opts = { step: target }
    }

    if (opts?.step !== undefined) {
      let ticket: Ticket
      try {
        ticket = readTicket(boardRoot, config, id)
      } catch {
        return c.json({ error: `Ticket ${id} not found` }, 404)
      }
      if (opts.step !== ticket.status) {
        const dependencyState = dependencyHoldForMove(
          ticket,
          opts.step,
          [...index.all(), ...index.parked()],
          listArchive(boardRoot, config),
          config,
        )
        if (dependencyState.held) {
          return c.json({
            error: `Ticket ${id} is held before '${opts.step}' by ${dependencyState.blockingTicketIds.map((ticketId) => `#${ticketId}`).join(', ')}`,
            dependencyState,
          }, 409)
        }
      }
    }

    try {
      const run = runManager.enqueue(id, opts)
      return c.json({ run })
    } catch (err) {
      if (err instanceof RunConflictError) return c.json({ error: err.message }, 409)
      const message = errorMessage(err)
      return c.json({ error: message }, /not found/i.test(message) ? 404 : 400)
    }
  })

  app.post('/api/runs/:id/stop', (c) => {
    const runId = c.req.param('id')
    const result = runManager.stop(runId)
    if (!result.ok) return c.json({ error: `Run ${runId} not found` }, 404)
    return c.json({ ok: true })
  })

  app.get('/api/runs', (c) => c.json({ runs: runManager.list() }))

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = sse.add((message) => {
        void stream.writeSSE(message)
      })
      await stream.writeSSE({ event: 'ready', data: 'connected' })
      await new Promise<void>((resolve) => {
        const heartbeat = setInterval(() => {
          void stream.writeSSE({ event: 'ping', data: String(Date.now()) })
        }, 15000)
        stream.onAbort(() => {
          clearInterval(heartbeat)
          unsubscribe()
          resolve()
        })
      })
    }),
  )

  app.get('*', createStaticHandler(uiDir))

  return app
}
