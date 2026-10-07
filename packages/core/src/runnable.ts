import type { StepType } from './config.js'
import type { AutomationLevel } from './types.js'

/**
 * The primitive signals a batch-runnability decision reads, decoupled from any
 * enriched UI `Ticket` or daemon index. Both `packages/ui` (the board's "Run
 * (N)" affordance) and the daemon (`POST /api/tickets/:id/move` with
 * `batch: true`) project their own shapes onto this object and consume the one
 * predicate below — so the rule has a single source of truth and cannot drift.
 */
export interface BatchRunnabilitySignals {
  /** The ticket's CURRENT step type (the step it is being advanced FROM); undefined when the step is unknown. */
  stepType?: StepType
  /** True only for the lateral `blocked` lane. */
  lateral: boolean
  /** True while the current daemon reports a live official-session claim. */
  liveRunning: boolean
  /** The ticket's automation level; absent = 'normal'. */
  automationLevel?: AutomationLevel
  /** Count of pending (not-done) manual tasks on the ticket. */
  manualTasksPending: number
  /** Count of open question inputs across the ticket's artifacts. */
  openInputs: number
  /** True while the ticket is held at its active dependency boundary. */
  dependencyHeld: boolean
}

/**
 * True when a batch run ("Run (N)" / Next-all) may advance a ticket at its
 * current step. A batch run may advance a ticket only when ALL hold:
 * its step is defined and NOT lateral; it has no live claim; it is not
 * `manual`; it has no pending manual task; it is not dependency-held; and the
 * step is `agent` (always) or a `gate` with no open inputs. Live-running or
 * manual tickets, terminal/queue steps, and any open human gate are excluded
 * — only a named run (`/flow:next <id>`, i.e. a move WITHOUT `batch: true`)
 * advances those.
 */
export function isRunnableInBatch(signals: BatchRunnabilitySignals): boolean {
  if (signals.stepType === undefined || signals.lateral) return false
  if (signals.liveRunning) return false
  if (signals.automationLevel === 'manual') return false
  if (signals.manualTasksPending > 0) return false
  if (signals.dependencyHeld) return false
  if (signals.stepType === 'agent') return true
  if (signals.stepType === 'gate') return signals.openInputs === 0
  return false
}
