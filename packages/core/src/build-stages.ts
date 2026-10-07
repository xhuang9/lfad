/**
 * Canonical staged-build marker contract. This module is browser-safe so the
 * UI can share runtime enum data without importing core's filesystem surface.
 */

import { z } from 'zod'

import type { Issue } from './types.js'

/** Canonical statuses for one reviewable stage in a staged build. */
export const BUILD_STAGE_STATUSES = [
  'pending',
  'building',
  'review',
  'approved',
  'changes',
] as const

/** Runtime schema for the canonical staged-build status enum. */
export const buildStageStatusSchema = z.enum(BUILD_STAGE_STATUSES)

/** Canonical shape of one item in `extras.buildStages`. */
export const buildStageSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  status: buildStageStatusSchema,
})

/** Canonical shape of the optional `extras.buildStages` marker. */
export const buildStagesSchema = z
  .object({
    total: z.number().int().nonnegative(),
    current: z.number().int(),
    items: z.array(buildStageSchema),
  })
  .superRefine((stages, ctx) => {
    if (stages.total !== stages.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total'],
        message: `total must match items.length (${stages.items.length})`,
      })
    }
    if (stages.current < 1 || stages.current > stages.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['current'],
        message: `current must be between 1 and total (${stages.total})`,
      })
    }
  })

/** One reviewable stage in a staged build. */
export type BuildStage = z.infer<typeof buildStageSchema>

/** A ticket's staged-build progress, carried in `extras.buildStages`. */
export type BuildStages = z.infer<typeof buildStagesSchema>

/** Maps a zod issue path to a non-empty `Issue.field` label. */
function pathToField(path: ReadonlyArray<string | number | symbol>): string {
  return path.length > 0 ? path.map((segment) => String(segment)).join('.') : 'buildStages'
}

/**
 * Non-blockingly checks an optional `extras.buildStages` marker. An absent
 * marker means a single-pass build and is valid; malformed markers return
 * diagnostics only and are never parsed into, removed from, or written back
 * to ticket frontmatter.
 */
export function validateBuildStages(value: unknown): Issue[] {
  if (value === undefined) return []
  try {
    const result = buildStagesSchema.safeParse(value)
    if (result.success) return []
    const issues = result.error.issues.map((issue) => ({
      field: pathToField(issue.path),
      message: issue.message,
    }))
    // Zod does not run object-level refinements when a child field fails its
    // base schema. Preserve useful independent cross-field diagnostics even
    // when the same marker also has a missing key or invalid status.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const marker = value as Record<string, unknown>
      if (
        typeof marker.total === 'number'
        && Array.isArray(marker.items)
        && marker.total !== marker.items.length
        && !issues.some((issue) => issue.field === 'total')
      ) {
        issues.push({
          field: 'total',
          message: `total must match items.length (${marker.items.length})`,
        })
      }
      if (
        typeof marker.current === 'number'
        && typeof marker.total === 'number'
        && (marker.current < 1 || marker.current > marker.total)
        && !issues.some((issue) => issue.field === 'current')
      ) {
        issues.push({
          field: 'current',
          message: `current must be between 1 and total (${marker.total})`,
        })
      }
    }
    return issues
  } catch (error) {
    return [{
      field: 'buildStages',
      message: `could not inspect marker: ${error instanceof Error ? error.message : String(error)}`,
    }]
  }
}
