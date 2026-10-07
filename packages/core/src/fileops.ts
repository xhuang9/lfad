/**
 * Filesystem ticket operations for @lfad/core.
 *
 * Every public function takes the board-root path plus the board's parsed
 * `BoardConfig` (signature convention: `(root, config, ...rest)`) and performs
 * pure filesystem work: a ticket is a `NNNN-slug` folder living inside exactly
 * one step folder (or `blocked`/`parked`/`_archive`), holding a `ticket.md` (YAML
 * frontmatter + body), optional artifacts, and a `log/` dir. A step's folder
 * name IS its config key. Mutations that touch `ticket.md` re-validate the
 * frontmatter contract and persist through crash-safe atomic writes; folder
 * moves use `fs.rename`. This module does no git and no I/O beyond the board.
 */

import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import type { BoardConfig } from './config.js'
import { defaultEntryStep, stepKeys } from './config.js'
import { readTicketFile, writeTicketFile } from './frontmatter.js'
import { atomicWriteFileSync } from './fs-atomic.js'
import { allocateId, parseTicketFolder, ticketFolderName } from './ids.js'
import { ARCHIVE_DIR, BLOCKED_DIR, PARKED_DIR } from './steps.js'
import type {
  CreateTicketInput,
  MoveOpts,
  Step,
  StepNote,
  Ticket,
} from './types.js'
import { assertValidTicket } from './validation.js'

/** Worktree locator passed to {@link setWorktree}; collapsed into the single `worktree` string. */
export interface WorktreeInfo {
  path?: string
  branch?: string
}

/** Structured payload recorded by {@link setBlocked} as `blocked.md` + a log entry. */
export interface BlockPayload {
  question?: string
  context?: string
  options?: string[]
  recommendation?: string
}

/** Resolution payload accepted by {@link resolveBlock}. */
export interface ResolveBlockOpts {
  choice?: string
  guidance?: string
}

/** One case-insensitive exact tag rename applied to every live ticket. */
export interface TagRename {
  from: string
  to: string
}

/** Summary returned by {@link renameActiveTicketTags}. */
export interface RenameActiveTagsResult {
  updated: number
  ticketIds: number[]
}

/** Options accepted by {@link archiveTicket}. */
export interface ArchiveOpts {
  reason?: string
}

/** A single {@link appendLog} entry: a raw line, or a record merged into the log object. */
export type LogEntry = string | Record<string, unknown>

/** Current time as an ISO 8601 string. */
function nowIso(): string {
  return new Date().toISOString()
}

/** Derives a filesystem-safe, lowercase, hyphenated slug from a title (never empty). */
function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return base.length > 0 ? base : 'untitled'
}

/**
 * Scans every config step folder, `blocked`, `parked`, and `_archive` under the board
 * root for the ticket folder whose id matches, returning its absolute path or
 * throwing when absent.
 */
function locateTicketDir(root: string, config: BoardConfig, id: number): string {
  const parents = [...stepKeys(config), BLOCKED_DIR, PARKED_DIR, ARCHIVE_DIR]
  for (const parent of parents) {
    const parentPath = join(root, parent)
    let entries
    try {
      entries = readdirSync(parentPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const parsed = parseTicketFolder(entry.name)
      if (parsed !== undefined && parsed.id === id) {
        return join(parentPath, entry.name)
      }
    }
  }
  throw new Error(`Ticket ${id} not found`)
}

/**
 * Natural-sort comparator for artifact file/folder names: numeric on a leading
 * `NN-` prefix when both names carry one, then localeCompare.
 */
function compareArtifactNames(a: string, b: string): number {
  const na = /^(\d+)-/.exec(a)
  const nb = /^(\d+)-/.exec(b)
  if (na !== null && nb !== null) {
    const diff = Number.parseInt(na[1], 10) - Number.parseInt(nb[1], 10)
    if (diff !== 0) return diff
  }
  return a.localeCompare(b)
}

/**
 * Validates a relative artifact name against traversal — absolute paths and
 * `..`/dot/empty segments are rejected, and the resolved path must stay inside
 * the ticket dir — returning the absolute target path.
 */
function resolveArtifactPath(dir: string, name: string): string {
  if (isAbsolute(name)) {
    throw new Error(`Invalid artifact name '${name}': absolute paths are not allowed`)
  }
  const segments = name.split(/[/\\]/)
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) {
    throw new Error(`Invalid artifact name '${name}': segments must be plain names (no '..', dot-entries, or empty segments)`)
  }
  const full = resolve(dir, name)
  if (!full.startsWith(resolve(dir) + sep)) {
    throw new Error(`Invalid artifact name '${name}': escapes the ticket folder`)
  }
  return full
}

/**
 * Core relocate primitive: locate the ticket, apply `mutate` to its data,
 * re-validate, then rewrite `ticket.md` (still in the OLD folder) and finally
 * move the folder into `targetFolder` (renaming to the canonical `NNNN-slug`
 * name). Returns the mutated `Ticket` AND the ticket's NEW absolute directory
 * (the rename target), so multi-step callers can append further artifacts/log
 * entries into it without re-scanning the board. Validation runs before any
 * filesystem change.
 *
 * Crash safety: the folder rename is deliberately the TRAILING edge. If the
 * write succeeds but the rename fails (crash, ENOSPC, collision), the caller
 * still sees the exception — the move "failed" — and the tear direction is
 * "content says the new step, folder still the old one", which a folder-wins
 * reconcile (see {@link reconcileStatus}) correctly rolls back. Because the
 * rename is the last step before returning, the reported `dir` is always a
 * successfully-renamed, on-disk directory.
 */
function relocateTicket(
  root: string,
  config: BoardConfig,
  id: number,
  targetFolder: string,
  mutate: (data: Ticket) => void,
): { data: Ticket, dir: string } {
  const dir = locateTicketDir(root, config, id)
  const { data, body } = readTicketFile(join(dir, 'ticket.md'))
  mutate(data)
  assertValidTicket(config, data)
  const parentPath = join(root, targetFolder)
  mkdirSync(parentPath, { recursive: true })
  const newDir = join(parentPath, ticketFolderName(data.id, data.slug))
  writeTicketFile(join(dir, 'ticket.md'), data, body)
  if (newDir !== dir) renameSync(dir, newDir)
  return { data, dir: newDir }
}

/**
 * Synthesizes the Ticket-shaped degraded entry board listings emit for a
 * folder that parses as a ticket folder but whose `ticket.md` cannot be read
 * or parsed: id + slug from the folder name, `status` = the physical parent
 * folder, placeholder title/category/timestamps, and the `unreadable` marker
 * carrying the error. Never written to disk — mutations re-read `ticket.md`
 * themselves and keep failing loudly on such an id.
 */
function degradedTicket(id: number, slug: string, parentFolder: string, error: unknown): Ticket {
  const epoch = new Date(0).toISOString()
  return {
    id,
    slug,
    title: '(unreadable ticket.md)',
    status: parentFolder as Step,
    category: 'bug',
    tags: [],
    createdAt: epoch,
    updatedAt: epoch,
    history: [],
    unreadable: true,
    unreadableError: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Reads every ticket directly inside one step/archive folder, sorted by id.
 * A ticket folder whose `ticket.md` is missing, unparsable, or carries no
 * usable id surfaces as a degraded {@link degradedTicket} entry instead of
 * being silently dropped (hand-editing in Obsidian is a supported workflow).
 */
function readStepFolder(root: string, parentFolder: string): Ticket[] {
  const parentPath = join(root, parentFolder)
  let entries
  try {
    entries = readdirSync(parentPath, { withFileTypes: true })
  } catch {
    return []
  }
  const tickets: Ticket[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTicketFolder(entry.name)
    if (parsed === undefined) continue
    let data: Ticket
    try {
      data = readTicketFile(join(parentPath, entry.name, 'ticket.md')).data
    } catch (error) {
      tickets.push(degradedTicket(parsed.id, parsed.slug, parentFolder, error))
      continue
    }
    if (!Number.isSafeInteger(data.id)) {
      // The unvalidated read path must never emit NaN-id tickets: valid YAML
      // with a missing/garbage id degrades under the folder-name id instead.
      tickets.push(degradedTicket(parsed.id, parsed.slug, parentFolder, new Error('ticket.md frontmatter has no usable id')))
      continue
    }
    tickets.push(data)
  }
  tickets.sort((a, b) => a.id - b.id)
  return tickets
}

/** Renders a {@link BlockPayload} into the markdown body of a `blocked.md` artifact. */
function renderBlocked(payload: BlockPayload): string {
  const lines: string[] = ['# Blocked', '']
  if (payload.question) lines.push(`**Question:** ${payload.question}`, '')
  if (payload.context) lines.push('## Context', '', payload.context, '')
  if (payload.options && payload.options.length > 0) {
    lines.push('## Options', '')
    for (const option of payload.options) lines.push(`- ${option}`)
    lines.push('')
  }
  if (payload.recommendation) lines.push(`**Recommendation:** ${payload.recommendation}`, '')
  // Agent escalations are answerable through the same plain-markdown input
  // contract as every other human gate. A reason-only block deliberately has
  // no Decision slot, so it cannot manufacture an empty question.
  if (payload.question) lines.push('**Decision:**', '')
  return `${lines.join('\n').trimEnd()}\n`
}

/** Reads and returns the ticket with the given id from any step or system holding folder. */
export function readTicket(root: string, config: BoardConfig, id: number): Ticket {
  return readTicketFile(join(locateTicketDir(root, config, id), 'ticket.md')).data
}

/** Reads every live ticket across all step folders and `blocked` (excluding `_archive`), sorted by id. */
export function readBoard(root: string, config: BoardConfig): Ticket[] {
  const tickets: Ticket[] = []
  for (const folder of [...stepKeys(config), BLOCKED_DIR]) {
    tickets.push(...readStepFolder(root, folder))
  }
  tickets.sort((a, b) => a.id - b.id)
  return tickets
}

/** Lists every ticket currently in the given step folder, sorted by id. Throws on unknown steps. */
export function listStep(root: string, config: BoardConfig, step: Step): Ticket[] {
  if (step !== BLOCKED_DIR && !stepKeys(config).includes(step)) {
    throw new Error(`Unknown step: ${step}`)
  }
  return readStepFolder(root, step)
}

/**
 * Lists every ticket in the `_archive` cold store, sorted by id. A fresh
 * per-request disk read (matching {@link readBoard}/{@link listStep}); the
 * archive is browse-only and low-traffic, so no in-memory index is kept. Takes
 * `config` for signature parity with the other list functions even though the
 * archive folder is fixed. Returns `[]` when nothing has been archived yet.
 */
export function listArchive(root: string, _config: BoardConfig): Ticket[] {
  return readStepFolder(root, ARCHIVE_DIR)
}

/** Lists every ticket in the resumable `parked/` holding store, sorted by id. */
export function listParked(root: string, _config: BoardConfig): Ticket[] {
  return readStepFolder(root, PARKED_DIR)
}

/** One repair performed by {@link reconcileStatus}: ticket `id` physically lives in `folder` but its frontmatter said `fromStatus`. */
export interface StatusRepair {
  id: number
  folder: Step
  fromStatus: Step
}

/**
 * Self-heals the "`status` ALWAYS matches the step folder" invariant across
 * every configured step folder plus `blocked` and `parked` — never `_archive`, whose
 * entries keep their last live status by design. The FOLDER is the physical
 * source of truth ({@link locateTicketDir} scans folders): any ticket whose
 * frontmatter `status` differs from its parent folder gets `ticket.md`
 * rewritten with `status` = folder. Under {@link relocateTicket}'s
 * write-then-rename order this rolls a torn (crashed/failed) move back to the
 * folder the ticket never left, restoring the blocked `returnStep` invariant
 * as it goes:
 *
 * - repaired INTO a regular step → `returnStep` is dropped (a torn move/block
 *   never happened);
 * - repaired back INTO `blocked` with no `returnStep` (a torn resolveBlock,
 *   whose frontmatter already carried the resolve target) → the torn status
 *   becomes `returnStep`, so a retried resolve lands on the same step.
 *
 * Idempotent by construction: healthy tickets are never rewritten, so a
 * watcher-triggered rebuild that calls this converges after one extra cycle
 * instead of looping.
 */
export function reconcileStatus(root: string, config: BoardConfig): StatusRepair[] {
  const repairs: StatusRepair[] = []
  for (const folder of [...stepKeys(config), BLOCKED_DIR, PARKED_DIR]) {
    const parentPath = join(root, folder)
    let entries
    try {
      entries = readdirSync(parentPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (parseTicketFolder(entry.name) === undefined) continue
      const path = join(parentPath, entry.name, 'ticket.md')
      let parsed
      try {
        parsed = readTicketFile(path)
      } catch {
        continue // not a readable ticket folder; skip (matches readStepFolder)
      }
      const { data, body } = parsed
      if (data.status === folder) continue
      const fromStatus = data.status
      data.status = folder
      if (folder === BLOCKED_DIR || folder === PARKED_DIR) {
        if (data.returnStep === undefined) data.returnStep = fromStatus
      } else {
        delete data.returnStep
      }
      writeTicketFile(path, data, body)
      repairs.push({ id: data.id, folder, fromStatus })
    }
  }
  return repairs
}

/**
 * Creates a new ticket: allocates an id, slugifies the title, seeds history with
 * the entry step (default: the board's first `entry: true` step, else the
 * first step), validates, and writes the ticket folder + `ticket.md` (body
 * from `input.body`). Returns the created `Ticket`.
 */
export function createTicket(root: string, config: BoardConfig, input: CreateTicketInput): Ticket {
  const status: Step = input.entryStep ?? defaultEntryStep(config)
  if (status === 'blocked') {
    throw new Error("createTicket cannot create a ticket directly in 'blocked'")
  }
  const id = allocateId(root, config)
  const slug = slugify(input.title)
  const now = nowIso()
  const ticket: Ticket = {
    id,
    slug,
    title: input.title,
    status,
    category: input.category,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: status, at: now }],
  }
  if (input.needsDesign !== undefined) ticket.needsDesign = input.needsDesign
  assertValidTicket(config, ticket)
  const dir = join(root, status, ticketFolderName(id, slug))
  mkdirSync(dir, { recursive: true })
  writeTicketFile(join(dir, 'ticket.md'), ticket, input.body ?? '')
  return ticket
}

/**
 * Moves a ticket to `toStep`: renames the folder into the target step, sets
 * `status`, pushes a history entry, and bumps `updatedAt` (clearing/setting
 * `returnStep` to preserve the blocked invariant). An optional reason/actor is
 * recorded to the ticket log.
 */
export function moveTicket(root: string, config: BoardConfig, id: number, toStep: Step, opts?: MoveOpts): Ticket {
  const { data, dir } = relocateTicket(root, config, id, toStep, (d) => {
    const from = d.status
    d.status = toStep
    if (toStep === 'blocked') {
      if (d.returnStep === undefined && from !== 'blocked') d.returnStep = from
    } else {
      delete d.returnStep
    }
    d.history.push({ step: toStep, at: nowIso() })
    d.updatedAt = nowIso()
  })
  if (opts?.reason !== undefined || opts?.actor !== undefined) {
    appendLogAt(dir, id, { event: 'move', to: toStep, reason: opts.reason, actor: opts.actor })
  }
  return data
}

/**
 * Merges a frontmatter patch into a ticket and rewrites `ticket.md` in place
 * (self-healing the folder name if `slug` changed), bumping `updatedAt`. Cannot
 * change `id` or `status` — use {@link moveTicket} to change step.
 */
export function updateFrontmatter(root: string, config: BoardConfig, id: number, patch: Partial<Ticket>): Ticket {
  const dir = locateTicketDir(root, config, id)
  const { data, body } = readTicketFile(join(dir, 'ticket.md'))
  if (patch.id !== undefined && patch.id !== data.id) {
    throw new Error('updateFrontmatter cannot change a ticket id')
  }
  if (patch.status !== undefined && patch.status !== data.status) {
    throw new Error('updateFrontmatter cannot change status; use moveTicket')
  }
  const next: Ticket = { ...data, ...patch }
  next.updatedAt = patch.updatedAt ?? nowIso()
  assertValidTicket(config, next)
  const newDir = join(dirname(dir), ticketFolderName(next.id, next.slug))
  if (newDir !== dir) renameSync(dir, newDir)
  writeTicketFile(join(newDir, 'ticket.md'), next, body)
  return next
}

/**
 * Renames matching tags across every LIVE ticket, excluding `_archive`.
 * Matching is case-insensitive and exact. All replacements are derived from
 * the original tag value in one pass, so simultaneous renames cannot cascade
 * through one another (for example `a → b` and `b → c`).
 */
export function renameActiveTicketTags(
  root: string,
  config: BoardConfig,
  renames: TagRename[],
): RenameActiveTagsResult {
  const renameByWord = new Map(renames.map(({ from, to }) => [from.toLocaleLowerCase(), to]))
  const ticketIds: number[] = []

  for (const ticket of readBoard(root, config)) {
    let changed = false
    const tags = ticket.tags.map((tag) => {
      const replacement = renameByWord.get(tag.toLocaleLowerCase())
      if (replacement === undefined || replacement === tag) return tag
      changed = true
      return replacement
    })
    if (!changed) continue
    updateFrontmatter(root, config, ticket.id, { tags })
    ticketIds.push(ticket.id)
  }

  return { updated: ticketIds.length, ticketIds }
}

/**
 * Replaces ONLY the markdown body of a ticket's `ticket.md`, preserving the
 * entire frontmatter spine and bumping `updatedAt`. The new body is written
 * through the same crash-safe atomic path as every other `ticket.md` mutation;
 * the frontmatter is re-validated before the write. Returns the updated `Ticket`.
 */
export function setBody(root: string, config: BoardConfig, id: number, body: string): Ticket {
  const dir = locateTicketDir(root, config, id)
  const { data } = readTicketFile(join(dir, 'ticket.md'))
  data.updatedAt = nowIso()
  assertValidTicket(config, data)
  writeTicketFile(join(dir, 'ticket.md'), data, body)
  return data
}

/**
 * Internal dir-taking core of {@link appendArtifact}: writes a named artifact
 * into an ALREADY-RESOLVED ticket dir, skipping the board scan. Same traversal
 * guards and crash-safe atomic write. Kept module-internal — multi-step
 * mutations reuse the dir their relocate step produced; the public
 * {@link appendArtifact} is the board-scanning entry point.
 */
function appendArtifactAt(dir: string, name: string, content: string): void {
  const path = resolveArtifactPath(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, content)
}

/**
 * Writes (creating or overwriting) a named artifact file in the ticket folder.
 * `name` may be a nested relative path (`plan/01-x.md`) — parent folders are
 * created on demand; traversal attempts (absolute paths, `..`/dot segments)
 * throw. The write itself stays crash-safe atomic.
 */
export function appendArtifact(root: string, config: BoardConfig, id: number, name: string, content: string): void {
  appendArtifactAt(locateTicketDir(root, config, id), name, content)
}

/**
 * Lists a ticket folder's human-facing markdown files as relative paths:
 * root-level `*.md` (excluding `ticket.md`) followed by the files of each
 * first-level subfolder (skipping `log/`, `images/`, and dot-entries), every
 * group natural-sorted (numeric on a leading `NN-` prefix, then localeCompare).
 * Ordering subfolder groups by pipeline position is the caller's concern —
 * core stays config-order-agnostic.
 */
export function listTicketFiles(root: string, config: BoardConfig, id: number): string[] {
  const dir = locateTicketDir(root, config, id)
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'ticket.md')
    .map((entry) => entry.name)
    .sort(compareArtifactNames)

  const folders = entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'log' && entry.name !== 'images')
    .map((entry) => entry.name)
    .sort(compareArtifactNames)
  for (const folder of folders) {
    const subFiles = readdirSync(join(dir, folder), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort(compareArtifactNames)
    files.push(...subFiles.map((name) => `${folder}/${name}`))
  }
  return files
}

/**
 * Dir-taking core of {@link appendLog}: appends one NDJSON record to
 * `<dir>/log/<id>.ndjson` (creating `log/` on demand) given an ALREADY-RESOLVED
 * ticket dir, skipping the board scan. A string entry is wrapped as
 * `{ at, line }`; a record is merged with `{ at, ... }`. Uses an O_APPEND write
 * so concurrent appends don't tear. Exported for hot per-line logging (e.g. the
 * run engine caches the ticket dir once and appends every output line here
 * instead of re-scanning the board per line); callers holding a stale dir must
 * detect that themselves — `recursive` mkdir would otherwise recreate a moved
 * ticket's old folder.
 */
export function appendLogAt(dir: string, id: number, entry: LogEntry): void {
  const logDir = join(dir, 'log')
  mkdirSync(logDir, { recursive: true })
  const record = typeof entry === 'string'
    ? { at: nowIso(), line: entry }
    : { at: nowIso(), ...entry }
  appendFileSync(join(logDir, `${id}.ndjson`), `${JSON.stringify(record)}\n`, 'utf8')
}

/**
 * Appends one NDJSON record to `<ticket>/log/<id>.ndjson` (creating `log/` on
 * demand). A string entry is wrapped as `{ at, line }`; a record is merged with
 * `{ at, ... }`. Uses an O_APPEND write so concurrent appends don't tear.
 */
export function appendLog(root: string, config: BoardConfig, id: number, entry: LogEntry): void {
  appendLogAt(locateTicketDir(root, config, id), id, entry)
}

/** Records a per-step applicability note on the ticket and bumps `updatedAt`. */
export function setStepNote(root: string, config: BoardConfig, id: number, step: Step, note: StepNote): Ticket {
  const dir = locateTicketDir(root, config, id)
  const { data, body } = readTicketFile(join(dir, 'ticket.md'))
  data.stepNotes = { ...(data.stepNotes ?? {}), [step]: note }
  data.updatedAt = nowIso()
  assertValidTicket(config, data)
  writeTicketFile(join(dir, 'ticket.md'), data, body)
  return data
}

/**
 * Stores worktree info in the single `worktree` frontmatter field, preferring
 * `info.path` and falling back to `info.branch` (clearing the field when both
 * are absent).
 */
export function setWorktree(root: string, config: BoardConfig, id: number, info: WorktreeInfo): Ticket {
  return updateFrontmatter(root, config, id, { worktree: info.path ?? info.branch })
}

/** Persists the agent SDK `sessionId` on the ticket for resume/fork. */
export function setSession(root: string, config: BoardConfig, id: number, sessionId: string): Ticket {
  return updateFrontmatter(root, config, id, { sessionId })
}

/**
 * Blocks a ticket: moves it to the `blocked` folder, sets `status='blocked'`
 * and `returnStep` to the origin step, then records the payload as a
 * `blocked.md` artifact and a log entry.
 */
export function setBlocked(root: string, config: BoardConfig, id: number, payload: BlockPayload): Ticket {
  const { data, dir } = relocateTicket(root, config, id, BLOCKED_DIR, (d) => {
    if (d.status !== 'blocked') d.returnStep = d.status
    d.status = 'blocked'
    d.history.push({ step: 'blocked', at: nowIso() })
    d.updatedAt = nowIso()
  })
  appendArtifactAt(dir, 'blocked.md', renderBlocked(payload))
  appendLogAt(dir, id, { event: 'blocked', ...payload })
  return data
}

/**
 * Resolves a blocked ticket: moves it back to its `returnStep`, clears
 * `returnStep`, pushes a history entry, and logs the resolution. Throws when
 * the ticket is not blocked.
 */
export function resolveBlock(root: string, config: BoardConfig, id: number, opts?: ResolveBlockOpts): Ticket {
  const target = readTicket(root, config, id).returnStep
  if (target === undefined) throw new Error(`Ticket ${id} is not blocked`)
  const { data, dir } = relocateTicket(root, config, id, target, (d) => {
    d.status = target
    delete d.returnStep
    d.history.push({ step: target, at: nowIso() })
    d.updatedAt = nowIso()
  })
  appendLogAt(dir, id, { event: 'resolve', choice: opts?.choice, guidance: opts?.guidance })
  return data
}

/** Moves a configured-step ticket into `parked/`, recording its origin. */
export function parkTicket(root: string, config: BoardConfig, id: number): Ticket {
  const currentDir = locateTicketDir(root, config, id)
  const current = readTicketFile(join(currentDir, 'ticket.md')).data
  const parent = basename(dirname(currentDir))
  if (parent === PARKED_DIR || current.status === PARKED_DIR) throw new Error(`Ticket ${id} is already parked`)
  if (parent === ARCHIVE_DIR) throw new Error(`Ticket ${id} is archived and cannot be parked`)
  if (current.status === BLOCKED_DIR) throw new Error(`Ticket ${id} is blocked and cannot be parked`)

  const { data, dir } = relocateTicket(root, config, id, PARKED_DIR, (d) => {
    d.returnStep = d.status
    d.status = PARKED_DIR
    d.history.push({ step: PARKED_DIR, at: nowIso() })
    d.updatedAt = nowIso()
  })
  appendLogAt(dir, id, { event: 'parked', fromStep: data.returnStep })
  return data
}

/** Restores a parked ticket to its origin, falling back to the board entry step. */
export function unparkTicket(root: string, config: BoardConfig, id: number): Ticket {
  const currentDir = locateTicketDir(root, config, id)
  const current = readTicketFile(join(currentDir, 'ticket.md')).data
  if (basename(dirname(currentDir)) !== PARKED_DIR || current.status !== PARKED_DIR || current.returnStep === undefined) {
    throw new Error(`Ticket ${id} is not parked`)
  }
  const origin = current.returnStep
  const target = stepKeys(config).includes(origin) ? origin : defaultEntryStep(config)
  const { data, dir } = relocateTicket(root, config, id, target, (d) => {
    d.status = target
    delete d.returnStep
    d.history.push({ step: target, at: nowIso() })
    d.updatedAt = nowIso()
  })
  appendLogAt(dir, id, {
    event: 'unparked',
    fromStep: origin,
    toStep: target,
    ...(target !== origin ? { warning: `Recorded origin '${origin}' no longer exists; restored to entry step '${target}'` } : {}),
  })
  return data
}

/**
 * Archives a ticket into the cold-store `_archive/` folder, preserving its last
 * `status`, bumping `updatedAt`, and logging the reason.
 */
export function archiveTicket(root: string, config: BoardConfig, id: number, opts?: ArchiveOpts): void {
  const { dir } = relocateTicket(root, config, id, ARCHIVE_DIR, (d) => {
    d.updatedAt = nowIso()
  })
  appendLogAt(dir, id, { event: 'archived', reason: opts?.reason })
}

/**
 * Reactivates an archived ticket back into a live step: moves it out of
 * `_archive/`, sets `status` to `toStep`, pushes a history entry, and bumps
 * `updatedAt`.
 */
export function reactivateTicket(root: string, config: BoardConfig, id: number, toStep: Step): Ticket {
  return relocateTicket(root, config, id, toStep, (d) => {
    d.status = toStep
    if (toStep === 'blocked') {
      if (d.returnStep === undefined) {
        throw new Error('Cannot reactivate directly into blocked without a returnStep')
      }
    } else {
      delete d.returnStep
    }
    d.history.push({ step: toStep, at: nowIso() })
    d.updatedAt = nowIso()
  }).data
}
