import type { Category, Ticket } from './types'

export interface ArchiveFilters {
  selected: ReadonlySet<Category>
  q: string
  from: string
  to: string
}

/** The archived date displayed by the UI and used by its date filter. */
export function archivedDate(ticket: Ticket): string {
  return ticket.updatedAt.slice(0, 10)
}

/** Returns the filtered Archive tickets newest-first without mutating input. */
export function filterArchive(tickets: readonly Ticket[], filters: ArchiveFilters): Ticket[] {
  const query = filters.q.trim().toLowerCase()

  return tickets
    .filter((ticket) => {
      if (filters.selected.size > 0 && !filters.selected.has(ticket.category)) return false
      if (
        query.length > 0
        && !`#${ticket.id} ${ticket.title} ${ticket.tags.join(' ')}`.toLowerCase().includes(query)
      ) return false

      const date = archivedDate(ticket)
      if (filters.from && date < filters.from) return false
      if (filters.to && date > filters.to) return false
      return true
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
}
