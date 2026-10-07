/**
 * `flow create|move|show|note` command bodies — thin, config-loaded wrappers
 * over `@lfad/core`, shared by the CLI and tests (the same pattern as
 * worktree.ts). These are the daemon-down fallback path: the daemon's REST API
 * is the primary movement surface, so the board git snapshot semantics here
 * mirror app.ts exactly — moves and additions write NO snapshot; modifying
 * existing ticket content (`flow note` rewrites ticket.md frontmatter) commits
 * a pre-change snapshot first via git.ts.
 */

import {
  appendLog,
  archiveTicket,
  BLOCKED_DIR,
  createTicket,
  listArchive,
  listParked,
  loadBoardConfig,
  moveTicket,
  parkTicket,
  reactivateTicket,
  readTicket,
  setStepNote,
  stepKeys,
  unparkTicket,
  type BoardConfig,
  type Category,
  type CreateTicketInput,
  type Step,
  type Ticket,
} from '@lfad/core'

import { readArtifacts, type Artifact } from './artifacts.js'
import { assertArchivable } from './archive.js'
import { snapshotBeforeEdit } from './git.js'

/** The six valid ticket categories (kept in sync with the app.ts REST guard). */
const CATEGORIES: readonly Category[] = ['ui', 'bug', 'logic', 'business', 'refactor', 'hotfix']

/** Narrows an unknown value to a valid {@link Category}. */
function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

/** Every step a ticket may be moved to: the config steps plus the lateral 'blocked'. */
function movableSteps(config: BoardConfig): string[] {
  return [...stepKeys(config), BLOCKED_DIR]
}

/** Throws a readable error naming the valid step keys when `step` is unknown. */
function assertStep(step: string, valid: string[]): void {
  if (!valid.includes(step)) {
    throw new Error(`Unknown step '${step}' (valid: ${valid.join(', ')})`)
  }
}

/** Splits a `--tags a,b` value into trimmed, non-empty tag strings. */
export function parseTags(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined
  const tags = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  return tags.length > 0 ? tags : undefined
}

/** Input accepted by {@link createCommand} (the parsed `flow create` flags). */
export interface CreateCommandInput {
  title: string
  category: string
  body?: string
  tags?: string[]
  /** Entry step; defaults to the board's first `entry: true` step. */
  step?: string
}

/**
 * The `flow create` command body: validates category/step against the board
 * config and creates the ticket (an addition — never snapshotted, mirroring
 * the daemon's POST /api/tickets).
 */
export function createCommand(boardRoot: string, input: CreateCommandInput): Ticket {
  const config = loadBoardConfig(boardRoot)
  if (!isCategory(input.category)) {
    throw new Error(`category must be one of ${CATEGORIES.join('|')} (got '${input.category}')`)
  }
  const create: CreateTicketInput = { title: input.title, category: input.category }
  if (input.body !== undefined) create.body = input.body
  if (input.tags !== undefined) create.tags = input.tags
  if (input.step !== undefined) {
    assertStep(input.step, stepKeys(config))
    create.entryStep = input.step
  }
  return createTicket(boardRoot, config, create)
}

/**
 * The `flow move` command body: moves the ticket to `toStep`, recording the
 * reason in the ticket log. Moves are never snapshotted — this mirrors the
 * daemon's POST /api/tickets/:id/move exactly (only modifications/deletions of
 * existing content snapshot; see app.ts).
 */
export function moveCommand(boardRoot: string, id: number, toStep: string, reason?: string): Ticket {
  const config = loadBoardConfig(boardRoot)
  assertStep(toStep, movableSteps(config))
  return moveTicket(boardRoot, config, id, toStep as Step, reason !== undefined ? { reason } : undefined)
}

/** The `flow show` payload: the ticket frontmatter plus its markdown artifacts. */
export interface ShowResult {
  ticket: Ticket
  /** 'Idea' (the ticket body) first, then every other `*.md` file in the folder. */
  artifacts: Artifact[]
}

/** The `flow show` command body: reads one ticket and its artifacts. */
export function showCommand(boardRoot: string, id: number): ShowResult {
  const config = loadBoardConfig(boardRoot)
  const ticket = readTicket(boardRoot, config, id) // throws 'Ticket <id> not found'
  return { ticket, artifacts: readArtifacts(boardRoot, config, id) }
}

/** Renders a {@link ShowResult} as the human-readable `flow show` output. */
export function renderShow(result: ShowResult): string {
  const { ticket, artifacts } = result
  const lines: string[] = []
  lines.push(`#${ticket.id} ${ticket.title}`)
  lines.push(`step: ${ticket.status}  category: ${ticket.category}`)
  if (ticket.tags.length > 0) lines.push(`tags: ${ticket.tags.join(', ')}`)
  if (ticket.needsDesign !== undefined) lines.push(`needsDesign: ${ticket.needsDesign}`)
  if (ticket.worktree !== undefined) lines.push(`worktree: ${ticket.worktree}`)
  if (ticket.returnStep !== undefined) lines.push(`returnStep: ${ticket.returnStep}`)
  const notes = Object.entries(ticket.stepNotes ?? {})
  if (notes.length > 0) {
    const rendered = notes
      .map(([step, note]) => `${step}: ${note?.applicable === false ? 'skipped' : 'applicable'}${note?.reason !== undefined ? ` (${note.reason})` : ''}`)
      .join('; ')
    lines.push(`stepNotes: ${rendered}`)
  }
  lines.push(`created: ${ticket.createdAt}  updated: ${ticket.updatedAt}`)
  lines.push('')
  const files = artifacts.filter((a) => a.name !== 'Idea').map((a) => a.name)
  lines.push('artifacts:')
  if (files.length > 0) {
    for (const name of files) lines.push(`  - ${name}`)
  } else {
    lines.push('  (none)')
  }
  lines.push('')
  lines.push('body:')
  const body = artifacts.find((a) => a.name === 'Idea')?.content.trim() ?? ''
  lines.push(body.length > 0 ? body : '(empty)')
  return `${lines.join('\n')}\n`
}

/**
 * The `flow archive` command body: cold-stores a ticket into `_archive/`
 * (a move — never snapshotted, mirroring the daemon's POST .../archive) and
 * logs the reason. Rejects an unknown id and an already-archived ticket with
 * readable messages, then returns the archived ticket.
 */
export function archiveCommand(boardRoot: string, id: number, reason?: string): Ticket {
  const config = loadBoardConfig(boardRoot)
  const current = readTicket(boardRoot, config, id) // resolve the id first: throws 'Ticket <id> not found'
  if (listArchive(boardRoot, config).some((t) => t.id === id)) {
    throw new Error(`Ticket ${id} is already archived`)
  }
  assertArchivable(config, current)
  archiveTicket(boardRoot, config, id, reason !== undefined ? { reason } : undefined)
  return readTicket(boardRoot, config, id)
}

/**
 * The `flow reactivate` command body: moves an archived ticket back onto a live
 * step (a move — never snapshotted, mirroring the daemon's POST .../reactivate).
 * `toStep` defaults to the step the ticket was archived from (its preserved
 * `status`); a provided step is validated against the board config. Rejects an
 * unknown id and a live (non-archived) ticket with readable messages, and
 * records the reason in the ticket log when given.
 */
export function reactivateCommand(boardRoot: string, id: number, toStep?: string, reason?: string): Ticket {
  const config = loadBoardConfig(boardRoot)
  const current = readTicket(boardRoot, config, id) // throws 'Ticket <id> not found'
  if (!listArchive(boardRoot, config).some((t) => t.id === id)) {
    throw new Error(`Ticket ${id} is not archived`)
  }
  const target = toStep ?? current.status
  assertStep(target, movableSteps(config))
  const ticket = reactivateTicket(boardRoot, config, id, target as Step)
  if (reason !== undefined) appendLog(boardRoot, config, id, { event: 'reactivated', toStep: target, reason })
  return ticket
}

/** Moves any configured-step ticket into the resumable parked store. */
export function parkCommand(boardRoot: string, id: number): Ticket {
  const config = loadBoardConfig(boardRoot)
  readTicket(boardRoot, config, id)
  if (listParked(boardRoot, config).some((ticket) => ticket.id === id)) {
    throw new Error(`Ticket ${id} is already parked`)
  }
  return parkTicket(boardRoot, config, id)
}

/** Restores a parked ticket to its recorded origin, or the current entry step. */
export function unparkCommand(boardRoot: string, id: number): Ticket {
  const config = loadBoardConfig(boardRoot)
  readTicket(boardRoot, config, id)
  if (!listParked(boardRoot, config).some((ticket) => ticket.id === id)) {
    throw new Error(`Ticket ${id} is not parked`)
  }
  return unparkTicket(boardRoot, config, id)
}

/** Input accepted by {@link noteCommand} (the parsed `flow note` flags). */
export interface NoteCommandInput {
  step: string
  /** The fast-pass marker: records the step as not applicable to this ticket. */
  skip: boolean
  reason?: string
}

/**
 * The `flow note` command body: records the stepNotes fast-pass marker
 * (`{ applicable: false, reason }`) on the ticket. This MODIFIES existing
 * ticket.md content, so — mirroring the daemon's PUT artifact route — a
 * pre-change git snapshot of the board is committed first.
 */
export function noteCommand(boardRoot: string, id: number, input: NoteCommandInput): Ticket {
  const config = loadBoardConfig(boardRoot)
  assertStep(input.step, stepKeys(config))
  if (!input.skip) {
    throw new Error("note records a fast-pass marker: pass --skip (with --reason <why>) to mark the step not applicable")
  }
  readTicket(boardRoot, config, id) // resolve the id BEFORE any git side-effect (mirrors app.ts)
  snapshotBeforeEdit(boardRoot, id, 'ticket.md')
  const note = input.reason !== undefined
    ? { applicable: false, reason: input.reason }
    : { applicable: false }
  return setStepNote(boardRoot, config, id, input.step as Step, note)
}
