import { useMemo, useState } from 'react'

import type { Ticket } from '../../../../types'

export type CandidateScope = 'board' | 'archive' | 'all'

interface CandidatePickerProps {
  ticketId: number
  selectedId: number | null
  candidates: Ticket[]
  archivedCandidates: Ticket[]
  onSelect: (id: number) => void
}

export function CandidatePicker({ ticketId, selectedId, candidates, archivedCandidates, onSelect }: CandidatePickerProps) {
  const [scope, setScope] = useState<CandidateScope>('all')
  const [query, setQuery] = useState('')
  const options = useMemo(() => {
    const live = candidates.map((ticket) => ({ ticket, archived: false }))
    const archived = archivedCandidates.map((ticket) => ({ ticket, archived: true }))
    const source = scope === 'board' ? live : scope === 'archive' ? archived : [...live, ...archived]
    const normalized = query.trim().toLowerCase()
    return source
      .filter(({ ticket }) => ticket.id !== ticketId)
      .filter(({ ticket }) => normalized === '' || `#${ticket.id} ${ticket.title}`.toLowerCase().includes(normalized))
      .slice(0, 40)
  }, [archivedCandidates, candidates, query, scope, ticketId])

  return (
    <div className="dependency-picker">
      <div className="dependency-picker-tools">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by id or title…"
          aria-label="Search prerequisite tickets"
        />
        <div className="dependency-scopes" role="group" aria-label="Prerequisite search scope">
          {(['board', 'archive', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={scope === value ? 'active' : ''}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {value[0]!.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="dependency-options" role="listbox" aria-label="Prerequisite tickets">
        {options.map(({ ticket, archived }) => (
          <button
            key={`${archived ? 'archive' : 'board'}-${ticket.id}`}
            type="button"
            role="option"
            aria-selected={selectedId === ticket.id}
            className={selectedId === ticket.id ? 'selected' : ''}
            onClick={() => onSelect(ticket.id)}
          >
            <span>{ticket.title}</span>
            <small>{archived ? <em>archived</em> : ticket.status} · #{ticket.id}</small>
          </button>
        ))}
        {options.length === 0 ? <p>No matching tickets.</p> : null}
      </div>
    </div>
  )
}
