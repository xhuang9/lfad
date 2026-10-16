/**
 * The `/api/steps` payload shape. Steps are per-board data: keys, labels,
 * order, and engine classification all come from the board's parsed
 * {@link BoardConfig}; the runtime only appends the system `blocked` column so
 * existing UIs keep their lateral row.
 */

import { BLOCKED_DIR, type BoardConfig, type StepRow, type StepType } from '@lfad/core'

/** One step as exposed over the API. */
export interface StepPayload {
  key: string
  label: string
  /** On-disk folder — identical to `key` under the config-driven model. */
  folder: string
  /** True only for the system `blocked` column (not part of the pipeline). */
  lateral: boolean
  type: StepType
  row: StepRow
  /** 0-based index in the config array; the UI renders headers as `${position}-${key}`. */
  position: number
  /** True when tickets may be created directly into this step. */
  entry: boolean
  /** When a new ticket should start here (entry steps only). */
  entryWhen?: string
  /** The skill bound to this step (drives the drawer's run-action buttons). */
  skill?: string
  /** Skills that can process a ticket sitting here — the drawer's buttons, in order. */
  actions?: string[]
  /** Free-form per-step guidance from board.yml (injected into step prompts). */
  guidance?: string
  /** Ticket frontmatter flag gating this step — the step is skipped for tickets
   *  whose flag is falsy (mirrors core's `nextStep` skip rule). */
  skipUnless?: string
}

/**
 * Builds the ordered `/api/steps` payload from the board config, with the
 * system `blocked` column appended last (lateral, needs-you; typed 'gate'
 * since resolving a block is human work).
 */
export function stepsPayload(config: BoardConfig): StepPayload[] {
  const steps: StepPayload[] = config.steps.map((s, i) => ({
    key: s.key,
    label: s.label,
    folder: s.key,
    lateral: false,
    type: s.type,
    row: s.row,
    position: i,
    entry: s.entry === true,
    ...(s.entryWhen !== undefined ? { entryWhen: s.entryWhen } : {}),
    ...(s.skill !== undefined ? { skill: s.skill } : {}),
    ...(s.actions !== undefined ? { actions: s.actions } : {}),
    ...(s.guidance !== undefined ? { guidance: s.guidance } : {}),
    ...(s.skipUnless !== undefined ? { skipUnless: s.skipUnless } : {}),
  }))
  steps.push({
    key: BLOCKED_DIR,
    label: 'Blocked',
    folder: BLOCKED_DIR,
    lateral: true,
    type: 'gate',
    row: 'needs-you',
    position: config.steps.length,
    entry: false,
  })
  return steps
}
