// The read-only Archive page: browse every ticket in the `_archive` cold store
// with three client-side filters (Category · Text search · Archived-date range).
// Filter state is mirrored into the URL query string (?cat=&q=&from=&to=) so a
// filtered view is shareable/bookmarkable; it is read once on mount and written
// back live via history.replaceState. Clicking a row opens the existing ticket
// drawer (via onOpen -> /t/:id) in read-only mode — no mutation happens here.

import { useEffect, useMemo, useState } from 'react'

import { filterArchive } from '../archive'
import type { Category, Ticket } from '../types'
import { CATEGORIES, CATEGORY_COLORS } from '../types'

interface ArchiveProps {
  tickets: Ticket[]
  onOpen: (id: number) => void
}

interface FilterState {
  selected: Set<Category>
  q: string
  from: string
  to: string
}

/** Reads the initial filter state from the current URL query string. Empty
 *  selected set == ALL (the default). Unknown categories are dropped. */
function parseSearch(): FilterState {
  const p = new URLSearchParams(window.location.search)
  const cat = (p.get('cat') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Category => (CATEGORIES as string[]).includes(s))
  return { selected: new Set(cat), q: p.get('q') ?? '', from: p.get('from') ?? '', to: p.get('to') ?? '' }
}

const archiveDateFormatter = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const archiveTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

function archivedDateTime(t: Ticket): { date: string; time: string } {
  const archivedAt = new Date(t.updatedAt)
  return {
    date: archiveDateFormatter.format(archivedAt),
    time: archiveTimeFormatter.format(archivedAt),
  }
}
export function Archive({ tickets, onOpen }: ArchiveProps) {
  const init = useMemo(() => parseSearch(), [])
  const [selected, setSelected] = useState<Set<Category>>(init.selected)
  const [q, setQ] = useState(init.q)
  const [from, setFrom] = useState(init.from)
  const [to, setTo] = useState(init.to)

  // URL is the source of truth for all three filters: write back on every
  // change. Guarded to /archive so an open drawer's /t/:id URL is never
  // clobbered while this page stays mounted underneath it.
  useEffect(() => {
    const p = new URLSearchParams()
    if (selected.size > 0) p.set('cat', [...selected].join(','))
    if (q) p.set('q', q)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    const qs = p.toString()
    if (window.location.pathname === '/archive') {
      window.history.replaceState(null, '', `/archive${qs ? `?${qs}` : ''}`)
    }
  }, [selected, q, from, to])

  const allOn = selected.size === 0

  // ALL-checkbox logic: All == no category filter (empty set). Clicking a
  // category clears All and toggles that category; multiple stay OR-ed;
  // unchecking the last one returns to All.
  function toggleCategory(c: Category) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }
  function selectAll() {
    setSelected(new Set())
  }
  function clearFilters() {
    setSelected(new Set())
    setQ('')
    setFrom('')
    setTo('')
  }

  const shown = useMemo(
    () => filterArchive(tickets, { selected, q, from, to }),
    [tickets, selected, q, from, to],
  )

  const active = selected.size > 0 || q !== '' || from !== '' || to !== ''

  return (
    <div className="arc-page">
      <div className="arc-inner">
        <div className="arc-head">
          <h1 className="arc-title">Archive</h1>
          <span className="arc-ro-tag">read-only</span>
          <span className="arc-sub">
            Browse past tickets from the <code>_archive</code> cold store.
          </span>
        </div>

        <section className="arc-filters" aria-label="Archive filters">
          <div className="arc-filter arc-filter-cat">
            <span className="arc-filter-label">Category</span>
            <div className="arc-cat-row">
              <button
                type="button"
                className={`arc-cat-pill arc-cat-all ${allOn ? 'on' : ''}`}
                onClick={selectAll}
                aria-pressed={allOn}
              >
                <span className="arc-cat-box" aria-hidden="true">
                  ✓
                </span>
                <span>All</span>
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`arc-cat-pill ${selected.has(c) ? 'on' : ''}`}
                  onClick={() => toggleCategory(c)}
                  aria-pressed={selected.has(c)}
                >
                  <span className="arc-cat-box" aria-hidden="true">
                    ✓
                  </span>
                  <span>{c}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="arc-filter">
            <label className="arc-filter-label" htmlFor="arc-q">
              Search
            </label>
            <input
              id="arc-q"
              className="arc-search"
              type="search"
              placeholder="#id, title, tags…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div className="arc-filter">
            <span className="arc-filter-label">Archived date</span>
            <div className="arc-date-range">
              <input
                className="arc-date-in"
                type="date"
                aria-label="Archived from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="arc-date-arrow" aria-hidden="true">
                →
              </span>
              <input
                className="arc-date-in"
                type="date"
                aria-label="Archived to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        </section>

        <div className="arc-count-line">
          <span>
            Showing <b>{shown.length}</b> of <b>{tickets.length}</b> archived ticket{tickets.length === 1 ? '' : 's'}
          </span>
          {active && (
            <button type="button" className="arc-clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {shown.length > 0 ? (
          <div className="arc-list">
            <div className="arc-list-head" aria-hidden="true">
              <span />
              <span>Title</span>
              <span>Category</span>
              <span style={{ textAlign: 'right' }}>Archived</span>
            </div>
            {shown.map((t) => {
              const archived = archivedDateTime(t)
              return (
                <button key={t.id} type="button" className="arc-row" onClick={() => onOpen(t.id)}>
                  <span className="arc-r-id">#{t.id}</span>
                  <span className="arc-r-main">
                    <span className="arc-r-title">{t.title}</span>
                    {t.tags.length > 0 && (
                      <span className="arc-r-meta">
                        {t.tags.map((g, i) => (
                          <span key={g}>
                            {i > 0 && <span className="arc-sep">·</span>}
                            {g}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="arc-r-cat">
                    <span
                      className="arc-dot"
                      style={{ background: CATEGORY_COLORS[t.category] }}
                      aria-hidden="true"
                    />
                    {t.category}
                  </span>
                  <span className="arc-r-date">
                    <span>{archived.date}</span>
                    <span className="arc-r-time">{archived.time}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="arc-empty">
            <span className="arc-empty-mark" aria-hidden="true">
              ▢
            </span>
            <span className="arc-empty-title">
              {active ? 'No archived tickets match these filters' : 'Nothing archived yet'}
            </span>
            <span className="arc-empty-sub">
              {active
                ? 'Try clearing the search or widening the date range.'
                : 'Tickets land here after they ship and are cold-stored.'}
            </span>
          </div>
        )}

        <p className="arc-note">
          Clicking any row opens the existing <strong>ticket drawer in read-only mode</strong> — no edit affordances,
          no reactivate. Strictly browse.
        </p>
      </div>
    </div>
  )
}
