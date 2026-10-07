import type { Ticket } from './types'

export const DEPENDENCIES_SECTION_SLUG = 'dependencies'

/** True only while the server says the ticket is held at its active boundary. */
export function isDependencyHeld(ticket: Ticket): boolean {
  return ticket.dependencyState?.held === true
}

/** Compact card copy from the server's active blocker ids. */
export function dependencyBadge(ticket: Ticket): string | null {
  const ids = ticket.dependencyState?.blockingTicketIds ?? []
  if (!isDependencyHeld(ticket) || ids.length === 0) return null
  return `blocked by #${ids[0]}${ids.length > 1 ? ` +${ids.length - 1}` : ''}`
}
