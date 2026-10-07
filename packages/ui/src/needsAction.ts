import { isDependencyHeld } from './dependencies'
import type { StepPayload, Ticket } from './types'

/** True when a ticket is waiting for human input rather than agent advancement. */
export function isNeedsAction(ticket: Ticket, step: StepPayload | undefined): boolean {
  return step !== undefined && (step.lateral || (step.type === 'gate' && (ticket.openInputs ?? 0) > 0))
}

/**
 * True when a ticket needs human attention for either reason the top-bar
 * "Needs action" button surfaces: it is waiting for human input, or it is held
 * at a dependency boundary. The two sets are disjoint today but the union is
 * deduped by ticket id at the call site.
 */
export function isNeedsActionOrHeld(ticket: Ticket, step: StepPayload | undefined): boolean {
  return isNeedsAction(ticket, step) || isDependencyHeld(ticket)
}
