/**
 * Runtime validation for ticket frontmatter — a config-driven zod schema plus
 * helpers that enforce the full data contract (including the cross-field rule
 * that `returnStep` is present if and only if status is blocked or parked).
 * Step keys are per-board data, so the schema is built from a `BoardConfig`.
 */

import { z } from 'zod'

import type { BoardConfig } from './config.js'
import { stepKeys } from './config.js'
import { BLOCKED_DIR, PARKED_DIR } from './steps.js'
import type { Issue, Ticket } from './types.js'

/** True when `value` is a non-empty, Date-parseable ISO 8601 string. */
function isParseableIso(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value))
}

/** zod enum over the six ticket categories. */
const categoryEnum = z.enum(['ui', 'bug', 'logic', 'business', 'refactor', 'hotfix'])

/** zod schema for a single per-step applicability note. */
const stepNoteSchema = z.object({
  applicable: z.boolean(),
  reason: z.string().optional(),
})

/**
 * Builds the full ticket frontmatter schema for one board. Current routing
 * fields (`status` and `returnStep`) validate against the board's config step
 * keys plus the system holding statuses; immutable history and note keys remain
 * valid after a board step is renamed or removed.
 */
function makeTicketSchema(config: BoardConfig) {
  const keys: string[] = [...stepKeys(config), BLOCKED_DIR, PARKED_DIR]
  const stepEnum = z.enum(keys as [string, ...string[]])

  const historyEntrySchema = z.object({
    step: z.string().min(1),
    at: z.string().refine(isParseableIso, { message: 'at must be a parseable ISO 8601 string' }),
  })

  const dependencySchema = z.object({
    ticketId: z.number().int().positive(),
    // Keep removed/renamed boundaries loadable so the dependency evaluator can
    // surface them as visible invalid edges instead of bricking the ticket.
    blockAtStage: z.string().min(1),
    unblockWhen: z.enum(['design-approved', 'done', 'archived']),
  })

  return z
    .object({
      id: z.number().int().positive(),
      slug: z.string().min(1),
      title: z.string().min(1),
      status: stepEnum,
      category: categoryEnum,
      tags: z.array(z.string()),
      needsDesign: z.boolean().optional(),
      automationLevel: z.enum(['normal', 'express', 'manual']).optional(),
      worktree: z.string().optional(),
      sessionId: z.string().optional(),
      returnStep: stepEnum.optional(),
      dependencies: z.array(dependencySchema).optional(),
      createdAt: z.string().refine(isParseableIso, { message: 'createdAt must be a parseable ISO 8601 string' }),
      updatedAt: z.string().refine(isParseableIso, { message: 'updatedAt must be a parseable ISO 8601 string' }),
      history: z.array(historyEntrySchema),
      stepNotes: z.record(z.string().min(1), stepNoteSchema).optional(),
      // Unknown frontmatter keys preserved verbatim (see Ticket.extras).
      extras: z.record(z.unknown()).optional(),
    })
    .superRefine((data, ctx) => {
      const isHolding = data.status === BLOCKED_DIR || data.status === PARKED_DIR
      const hasReturnStep = data.returnStep !== undefined
      if (isHolding && !hasReturnStep) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['returnStep'],
          message: "returnStep is required when status is 'blocked' or 'parked'",
        })
      }
      if (!isHolding && hasReturnStep) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['returnStep'],
          message: "returnStep must be absent unless status is 'blocked' or 'parked'",
        })
      }
    })
}

/** The schema type returned by {@link buildTicketSchema}. */
export type TicketSchema = ReturnType<typeof makeTicketSchema>

/** Per-config schema cache: building the enum schema once per BoardConfig instance. */
const schemaCache = new WeakMap<BoardConfig, TicketSchema>()

/** Returns the (cached) ticket schema for one board's config. */
export function buildTicketSchema(config: BoardConfig): TicketSchema {
  const cached = schemaCache.get(config)
  if (cached !== undefined) return cached
  const schema = makeTicketSchema(config)
  schemaCache.set(config, schema)
  return schema
}

/** Maps a zod issue path to a non-empty `Issue.field` label. */
function pathToField(path: ReadonlyArray<string | number | symbol>): string {
  return path.length > 0 ? path.map((segment) => String(segment)).join('.') : 'ticket'
}

/**
 * Validates an unknown value against the board's ticket contract, returning an
 * empty array when valid or a list of `Issue` findings describing each violation.
 */
export function validateTicket(config: BoardConfig, t: unknown): Issue[] {
  const result = buildTicketSchema(config).safeParse(t)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    field: pathToField(issue.path),
    message: issue.message,
  }))
}

/**
 * Parses and validates `t`, returning a typed `Ticket` on success or throwing
 * an `Error` (with all findings in the message) when the contract is violated.
 */
export function assertValidTicket(config: BoardConfig, t: unknown): Ticket {
  const result = buildTicketSchema(config).safeParse(t)
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${pathToField(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid ticket: ${detail}`)
  }
  return result.data as Ticket
}
