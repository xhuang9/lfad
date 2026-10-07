import type { BoardConfig, StepConfig, Ticket } from '@lfad/core'

/** True when a configured step applies to this ticket's flags and fast-pass notes. */
function stepApplies(step: StepConfig, ticket: Ticket): boolean {
  if (ticket.stepNotes?.[step.key]?.applicable === false) return false
  if (step.skipUnless === undefined) return true

  const fields = ticket as unknown as Record<string, unknown>
  return Boolean(fields[step.skipUnless] ?? ticket.extras?.[step.skipUnless])
}

/**
 * Enforces the pipeline invariant that only the last applicable live step may
 * move a ticket into `_archive`. The filesystem relocation primitive remains
 * policy-free; daemon and CLI archive entry points share this boundary check.
 */
export function assertArchivable(config: BoardConfig, ticket: Ticket): void {
  const lastApplicable = [...config.steps].reverse().find((step) => stepApplies(step, ticket))
  if (lastApplicable === undefined) {
    throw new Error(`Ticket ${ticket.id} cannot be archived because it has no applicable configured step`)
  }
  if (ticket.status !== lastApplicable.key) {
    throw new Error(
      `Ticket ${ticket.id} cannot be archived from '${ticket.status}'; archive is only allowed from last applicable step '${lastApplicable.key}'`,
    )
  }
}
