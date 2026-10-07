import type { StepPayload, Ticket } from './types'
import { isRunnableInBatch as coreIsRunnableInBatch } from '@lfad/core/runnable'
import { isDependencyHeld } from './dependencies'

/**
 * True when a batch run ("Run (N)" / Next-all) may advance this ticket: its
 * step is agent-typed, or a gate with no open questions. Tickets with a live
 * official-session claim (`ticket.running`) and Manual tickets
 * (`automationLevel: 'manual'`) are always excluded — only a named run
 * advances them. Pending manual tasks also stop every Next path. Lateral
 * (blocked), terminal, and queue steps never qualify.
 *
 * The decision itself lives in `@lfad/core`'s `isRunnableInBatch` — the
 * single source of truth the daemon's `/move` batch gate also consumes. This
 * function only projects the enriched UI `Ticket`/`StepPayload` onto that
 * predicate's primitive signals; the branch logic is NOT duplicated here.
 */
export function isRunnableInBatch(ticket: Ticket, step: StepPayload | undefined): boolean {
  return coreIsRunnableInBatch({
    stepType: step?.type,
    lateral: step?.lateral ?? false,
    liveRunning: ticket.running !== undefined,
    automationLevel: ticket.automationLevel,
    manualTasksPending: ticket.manualTasks?.pending ?? 0,
    openInputs: ticket.openInputs ?? 0,
    dependencyHeld: isDependencyHeld(ticket),
  })
}
