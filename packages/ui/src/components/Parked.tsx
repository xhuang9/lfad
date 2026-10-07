import { useMemo, useState } from 'react'

import type { Category, Ticket } from '../types'
import { CATEGORIES, CATEGORY_COLORS } from '../types'

interface ParkedProps {
  tickets: Ticket[]
  onOpen: (id: number) => void
  onRestore: (id: number) => Promise<void>
}

export function filterParked(tickets: readonly Ticket[], query: string, categories: ReadonlySet<Category>): Ticket[] {
  const q = query.trim().toLowerCase()
  return tickets
    .filter((ticket) => categories.size === 0 || categories.has(ticket.category))
    .filter((ticket) => q.length === 0 || `#${ticket.id} ${ticket.title} ${ticket.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
}

export function Parked({ tickets, onOpen, onRestore }: ParkedProps) {
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<Set<Category>>(new Set())
  const [restoring, setRestoring] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = useMemo(() => filterParked(tickets, query, categories), [tickets, query, categories])

  function toggle(category: Category) {
    setCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  async function restore(id: number) {
    setRestoring(id)
    setError(null)
    try {
      await onRestore(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div className="arc-page">
      <div className="arc-inner">
        <div className="arc-head">
          <h1 className="arc-title">Parked</h1>
          <span className="arc-sub">Tickets set aside for later, restored to their recorded origin step.</span>
        </div>
        <section className="arc-filters" aria-label="Parked filters">
          <div className="arc-filter arc-filter-cat">
            <span className="arc-filter-label">Category</span>
            <div className="arc-cat-row">
              <button type="button" className={`arc-cat-pill arc-cat-all ${categories.size === 0 ? 'on' : ''}`} onClick={() => setCategories(new Set())}>All</button>
              {CATEGORIES.map((category) => (
                <button key={category} type="button" className={`arc-cat-pill ${categories.has(category) ? 'on' : ''}`} onClick={() => toggle(category)}>{category}</button>
              ))}
            </div>
          </div>
          <div className="arc-filter">
            <label className="arc-filter-label" htmlFor="parked-q">Search</label>
            <input id="parked-q" className="arc-search" type="search" placeholder="#id, title, tags…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </section>
        <div className="arc-count-line">Showing <b>{shown.length}</b> of <b>{tickets.length}</b> parked ticket{tickets.length === 1 ? '' : 's'}</div>
        {error && <p className="drawer-error" role="alert">{error}</p>}
        {shown.length > 0 ? (
          <div className="arc-list">
            <div className="arc-list-head park-grid" aria-hidden="true"><span /><span>Title</span><span>Category</span><span>Origin</span><span>Action</span></div>
            {shown.map((ticket) => (
              <div key={ticket.id} className="arc-row park-grid">
                <span className="arc-r-id">#{ticket.id}</span>
                <button type="button" className="park-open" onClick={() => onOpen(ticket.id)}>
                  <span className="arc-r-title">{ticket.title}</span>
                  <span className="arc-r-meta">{ticket.tags.join(' · ')}</span>
                </button>
                <span className="arc-r-cat"><span className="arc-dot" style={{ background: CATEGORY_COLORS[ticket.category] }} aria-hidden="true" />{ticket.category}</span>
                <span className="park-origin">{ticket.returnStep ?? 'unknown'}</span>
                <button type="button" className="btn park-restore" disabled={restoring === ticket.id} onClick={() => void restore(ticket.id)}>{restoring === ticket.id ? 'Restoring…' : 'Restore'}</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="arc-empty"><span className="arc-empty-title">{tickets.length === 0 ? 'Nothing parked' : 'No parked tickets match these filters'}</span></div>
        )}
      </div>
    </div>
  )
}
