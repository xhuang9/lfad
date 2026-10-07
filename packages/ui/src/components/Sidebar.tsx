import { useEffect, useMemo, useState } from 'react'
import { Archive, Cog, Diamond, Kanban, LayoutDashboard } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { getInfo } from '../api'
import { normalizeKeyword, ticketMatchesKeyword } from '../keywords'
import type { Category, KeywordSettings, Ticket } from '../types'
import { CATEGORIES, CATEGORY_COLORS } from '../types'

export type View = 'dashboard' | 'board' | 'parked' | 'archive'

interface SidebarProps {
  view: View
  onView: (v: View) => void
  collapsed: boolean
  onToggle: () => void
  categoryFilter: Set<Category>
  onToggleCategory: (c: Category) => void
  keywordFilter: Set<string>
  onToggleKeyword: (word: string) => void
  keywords: KeywordSettings
  onConfigureKeywords: () => void
  tickets: Ticket[]
  /** Number of tickets in the `_archive` cold store — drives the Archive tab badge. */
  archiveCount: number
  /** Number of tickets in the resumable parked store. */
  parkedCount: number
  onManual: () => void
}

const NAV: { key: View; label: string; icon?: LucideIcon }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'board', label: 'Board', icon: Kanban },
  { key: 'parked', label: 'Parked' },
  { key: 'archive', label: 'Archive', icon: Archive },
]

export function Sidebar({ view, onView, collapsed, onToggle, categoryFilter, onToggleCategory, keywordFilter, onToggleKeyword, keywords, onConfigureKeywords, tickets, archiveCount, parkedCount, onManual }: SidebarProps) {
  const [version, setVersion] = useState<string>()
  const keywordCounts = useMemo(
    () => new Map(keywords.items.map((keyword) => [
      normalizeKeyword(keyword.word),
      tickets.filter((ticket) => ticketMatchesKeyword(ticket.tags, keyword.word)).length,
    ])),
    [keywords.items, tickets],
  )

  useEffect(() => {
    void getInfo().then((info) => setVersion(info.version)).catch(() => undefined)
  }, [])

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="brand">
        <Diamond className="brand-mark" aria-hidden="true" />
        {!collapsed && <span className="brand-name">Agent Dashboard</span>}
        <button
          className="brand-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="nav" aria-label="Primary navigation">
        {NAV.map((n) => {
          const Icon = n.icon
          return (
            <button
              key={n.key}
              className={`nav-item ${view === n.key ? 'nav-active' : ''}`}
              onClick={() => onView(n.key)}
              aria-current={view === n.key ? 'page' : undefined}
            >
              {Icon ? <Icon className="nav-icon" aria-hidden="true" /> : <span className="nav-text-mark" aria-hidden="true">P</span>}
              {!collapsed && <span className="nav-label">{n.label}</span>}
              {!collapsed && n.key === 'board' && (
                <span className="nav-count" title="Tickets on the board">
                  {tickets.length}
                </span>
              )}
              {!collapsed && n.key === 'archive' && (
                <span className="nav-count" title="Tickets in _archive">
                  {archiveCount}
                </span>
              )}
              {!collapsed && n.key === 'parked' && (
                <span className="nav-count" title="Tickets in parked">
                  {parkedCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {!collapsed && (
        <>
          <div className="filters">
            <p className="filters-head">Category</p>
            {CATEGORIES.map((c) => (
              <label key={c} className="filter-row">
                <input type="checkbox" checked={categoryFilter.has(c)} onChange={() => onToggleCategory(c)} />
                <span className="swatch" style={{ background: CATEGORY_COLORS[c] }} aria-hidden="true" />
                <span className="filter-label">{c}</span>
              </label>
            ))}
          </div>

          <div className="filters keyword-filters">
            <div className="filters-head keyword-filters-head">
              <span>Keywords</span>
              <button className="keyword-config" type="button" onClick={onConfigureKeywords} aria-label="Configure project keywords" title="Configure keywords">
                <Cog aria-hidden="true" />
              </button>
            </div>
            {keywords.items.length === 0 ? (
              <div className="keyword-empty">
                <strong>No keywords yet</strong>
                <span>Configure project filters and card colours.</span>
                <button onClick={onConfigureKeywords}>Configure</button>
              </div>
            ) : (
              <div className="keyword-list">
                {keywords.items.map((keyword) => {
                  const normalized = normalizeKeyword(keyword.word)
                  return (
                    <label key={normalized} className={`filter-row keyword-row ${keywordFilter.has(normalized) ? 'keyword-row-on' : ''}`}>
                      <input type="checkbox" checked={keywordFilter.has(normalized)} onChange={() => onToggleKeyword(keyword.word)} />
                      <span className="swatch keyword-swatch" style={{ color: keyword.color, background: keyword.color }} aria-hidden="true" />
                      <span className="filter-label">{keyword.word}</span>
                      <span className="keyword-count">{keywordCounts.get(normalized) ?? 0}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <button className="manual-btn" onClick={onManual} aria-label="Open the FAQ (skills & board help)">
        <span className="manual-btn-icon" aria-hidden="true">
          ?
        </span>
        {!collapsed && <span>FAQ</span>}
      </button>

      {version && (
        <div className="sidebar-foot">
          {collapsed ? (
            <span className="version-num" title="Installed flow version">{version}</span>
          ) : (
            <span className="version" title="Installed flow version — live from GET /api/info">
              <Diamond className="version-dot" aria-hidden="true" />
              <span className="version-name">Flow</span>
              <span className="version-num">v{version}</span>
            </span>
          )}
        </div>
      )}
    </aside>
  )
}
