/**
 * Frontmatter (de)serialization for ticket.md files.
 *
 * A ticket.md is YAML frontmatter (the `Ticket` spine) plus a markdown body.
 * This module is the single canonical gateway for turning that file into a
 * `Ticket` and back, with crash-safe writes and stable, lossless round-trips.
 * Legacy tickets written before the step rename (`stageNotes`, `history[].stage`,
 * `returnStage`) are normalized to the new keys on read; writes emit the new
 * keys only.
 */

import { readFileSync } from 'node:fs'
import matter from 'gray-matter'

import { atomicWriteFileSync } from './fs-atomic.js'
import type {
  Category,
  DependencyMilestone,
  HistoryEntry,
  Step,
  StepNote,
  Ticket,
} from './types.js'

/** True for a non-null, non-array object — the shape of YAML maps. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce an unknown YAML scalar into a string (null/undefined → ''). */
function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Coerce an unknown YAML scalar into a number. */
function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * Coerce a YAML timestamp back to an ISO 8601 string. YAML's default schema
 * parses unquoted ISO dates into `Date` objects; this normalizes them (and
 * already-quoted strings) so the `Ticket` always holds plain ISO strings.
 */
function toISO(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return asString(value)
}

/** Normalize one raw history entry into a typed `HistoryEntry` (legacy `stage` key accepted). */
function normalizeHistory(entry: unknown): HistoryEntry {
  const raw = isRecord(entry) ? entry : {}
  return { step: asString(raw.step ?? raw.stage) as Step, at: toISO(raw.at) }
}

/** Normalize the raw stepNotes map into typed per-step notes. */
function normalizeStepNotes(
  raw: Record<string, unknown>,
): Partial<Record<Step, StepNote>> {
  const out: Partial<Record<Step, StepNote>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const note: StepNote = { applicable: Boolean(value.applicable) }
    if (value.reason !== undefined) note.reason = asString(value.reason)
    out[key as Step] = note
  }
  return out
}

/**
 * Every frontmatter key with reserved meaning: the canonical `Ticket` fields,
 * the legacy pre-rename aliases (normalized on read, never re-emitted), and
 * the `extras` bag itself. Any raw key OUTSIDE this set is an unknown key,
 * preserved verbatim in `ticket.extras`; on write, an extras key inside this
 * set is skipped so it can never shadow or resurrect a reserved key.
 */
const RESERVED_FRONTMATTER_KEYS = new Set([
  'id',
  'slug',
  'title',
  'status',
  'category',
  'tags',
  'needsDesign',
  'automationLevel',
  'worktree',
  'sessionId',
  'returnStep',
  'dependencies',
  'dependsOn',
  'createdAt',
  'updatedAt',
  'history',
  'stepNotes',
  'extras',
  // Legacy aliases — normalized into the new keys on read; never resurrected.
  'stage',
  'stageNotes',
  'returnStage',
])

/**
 * Coerce a raw gray-matter `data` object into a fully-typed `Ticket`.
 * Optional fields are included only when present, preserving losslessness;
 * this does not validate (see `validateTicket`), only normalizes shapes
 * (including the legacy `stageNotes`/`history[].stage`/`returnStage` keys).
 * Unknown keys are collected verbatim into `ticket.extras` (round-trip
 * preservation); `extras` is omitted entirely when there are none.
 */
function normalizeTicket(raw: Record<string, unknown>): Ticket {
  const ticket: Ticket = {
    id: asNumber(raw.id),
    slug: asString(raw.slug),
    title: asString(raw.title),
    status: asString(raw.status) as Step,
    category: asString(raw.category) as Category,
    tags: Array.isArray(raw.tags) ? raw.tags.map(asString) : [],
    createdAt: toISO(raw.createdAt),
    updatedAt: toISO(raw.updatedAt),
    history: Array.isArray(raw.history) ? raw.history.map(normalizeHistory) : [],
  }
  if (raw.needsDesign !== undefined) ticket.needsDesign = Boolean(raw.needsDesign)
  if (raw.automationLevel !== undefined) ticket.automationLevel = asString(raw.automationLevel) as Ticket['automationLevel']
  if (raw.worktree !== undefined) ticket.worktree = asString(raw.worktree)
  if (raw.sessionId !== undefined) ticket.sessionId = asString(raw.sessionId)
  const returnStep = raw.returnStep ?? raw.returnStage
  if (returnStep !== undefined) ticket.returnStep = asString(returnStep) as Step
  if (Array.isArray(raw.dependencies)) {
    ticket.dependencies = raw.dependencies.map((value) => {
      const edge = isRecord(value) ? value : {}
      return {
        ticketId: asNumber(edge.ticketId),
        blockAtStage: asString(edge.blockAtStage) as Step,
        unblockWhen: asString(edge.unblockWhen) as DependencyMilestone,
      }
    })
  } else if (Array.isArray(raw.dependsOn)) {
    // Legacy numeric dependencies had no stage/milestone semantics. Normalize
    // them to the default build boundary on read so the next write is canonical.
    ticket.dependencies = raw.dependsOn.map((ticketId) => ({
      ticketId: asNumber(ticketId),
      blockAtStage: 'doing',
      unblockWhen: 'done',
    }))
  }
  const stepNotes = isRecord(raw.stepNotes) ? raw.stepNotes : raw.stageNotes
  if (isRecord(stepNotes)) ticket.stepNotes = normalizeStepNotes(stepNotes)
  const extras: Record<string, unknown> = {}
  // A literal `extras:` map (from an older serializer or a hand edit) is
  // flattened into the bag rather than nested or dropped.
  if (isRecord(raw.extras)) {
    for (const [key, value] of Object.entries(raw.extras)) {
      if (!RESERVED_FRONTMATTER_KEYS.has(key)) extras[key] = value
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!RESERVED_FRONTMATTER_KEYS.has(key)) extras[key] = value
  }
  if (Object.keys(extras).length > 0) ticket.extras = extras
  return ticket
}

/**
 * Build a plain object with a fixed, canonical key order (matching the `Ticket`
 * interface) so serialized frontmatter is deterministic. Optional fields are
 * emitted only when defined.
 */
function orderFrontmatter(ticket: Ticket): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: ticket.id,
    slug: ticket.slug,
    title: ticket.title,
    status: ticket.status,
    category: ticket.category,
    tags: ticket.tags,
  }
  if (ticket.needsDesign !== undefined) out.needsDesign = ticket.needsDesign
  if (ticket.automationLevel !== undefined) out.automationLevel = ticket.automationLevel
  if (ticket.worktree !== undefined) out.worktree = ticket.worktree
  if (ticket.sessionId !== undefined) out.sessionId = ticket.sessionId
  if (ticket.returnStep !== undefined) out.returnStep = ticket.returnStep
  if (ticket.dependencies !== undefined) out.dependencies = ticket.dependencies
  out.createdAt = ticket.createdAt
  out.updatedAt = ticket.updatedAt
  out.history = ticket.history.map((h) => ({ step: h.step, at: h.at }))
  if (ticket.stepNotes !== undefined) out.stepNotes = ticket.stepNotes
  // Unknown keys ride after the canonical spine, flattened (never a literal
  // `extras:` map). Reserved keys are skipped so extras can never shadow a
  // canonical field or resurrect a legacy alias.
  if (ticket.extras !== undefined) {
    for (const [key, value] of Object.entries(ticket.extras)) {
      if (!RESERVED_FRONTMATTER_KEYS.has(key)) out[key] = value
    }
  }
  return out
}

/** Parse a ticket.md string into a normalized `Ticket` plus its markdown body. */
export function parseTicketFile(raw: string): { data: Ticket; body: string } {
  // The `{}` options bypass gray-matter's module-level cache. That cache
  // stores the file object BEFORE parsing, so a ticket.md whose YAML throws
  // poisons it: the first read throws, every later read of the same content
  // silently returns `data: {}` — a garbage NaN-id ticket. Bypassing keeps
  // broken files deterministically broken (and avoids unbounded cache growth).
  const parsed = matter(raw, {})
  return {
    data: normalizeTicket(parsed.data as Record<string, unknown>),
    body: parsed.content,
  }
}

/**
 * Serialize a `Ticket` and body back into a ticket.md string with stable key
 * order and ISO dates preserved (YAML quotes timestamp-like strings).
 */
export function serializeTicketFile(data: Ticket, body: string): string {
  return matter.stringify(body, orderFrontmatter(data))
}

/** Read and parse a ticket.md from disk into a `Ticket` plus its body. */
export function readTicketFile(path: string): { data: Ticket; body: string } {
  return parseTicketFile(readFileSync(path, 'utf8'))
}

/**
 * Atomically write a ticket.md: serialize, write+fsync a temp file in the same
 * directory, then `rename` it into place so a crash never leaves a torn file.
 */
export function writeTicketFile(path: string, data: Ticket, body: string): void {
  atomicWriteFileSync(path, serializeTicketFile(data, body))
}
