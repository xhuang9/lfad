import type { RefObject } from 'react'

import { SettingsMenu } from './SettingsMenu'

interface TopBarProps {
  title: string
  search: string
  onSearch: (s: string) => void
  onNew: () => void
  onConfigurePrompts: () => void
  /** Copies the "process all unblocked tickets" prompt to the clipboard. */
  onNextAll: () => void
  /** True during the transient "✓ Copied" feedback window after onNextAll. */
  nextAllCopied: boolean
  /** How many tickets are unblocked right now — disables the button at 0. */
  nextAllCount: number
  /** Whether the board is filtered to tickets waiting for human action. */
  needsActionOn: boolean
  onToggleNeedsAction: () => void
  /** Number of tickets waiting for human action across the whole board. */
  needsActionCount: number
  /** The filter belongs to the board view, not Dashboard or Archive. */
  showNeedsAction: boolean
  /** Number of tickets currently held by official agent-session leases. */
  runningCount: number
  searchRef: RefObject<HTMLInputElement>
}

export function TopBar({ title, search, onSearch, onNew, onConfigurePrompts, onNextAll, nextAllCopied, nextAllCount, needsActionOn, onToggleNeedsAction, needsActionCount, showNeedsAction, runningCount, searchRef }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="crumb crumb-root">Agent Dashboard</span>
        <span className="crumb-sep crumb-root" aria-hidden="true">
          ▸
        </span>
        <span>{title}</span>
      </div>
      <div className="topbar-actions">
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Search…  ( / )"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Search tickets"
        />
        {showNeedsAction && (
          <button
            className={`btn needs-action-btn ${needsActionOn ? 'is-active' : ''}`}
            onClick={onToggleNeedsAction}
            aria-pressed={needsActionOn}
            title="Show only tickets waiting for human action"
          >
            Needs action ({needsActionCount})
          </button>
        )}
        <button
          className={`btn cmd-btn${runningCount > 0 ? ' run-2' : ''}`}
          onClick={onNextAll}
          disabled={nextAllCount === 0}
          title={
            nextAllCount === 0
              ? 'No unblocked tickets to process'
              : `Copies a prompt to process all ${nextAllCount} unblocked ticket${nextAllCount === 1 ? '' : 's'} in parallel — paste it into your agent session`
          }
          aria-label="Copy a prompt to process all unblocked tickets"
        >
          {runningCount > 0 ? (
            <>
              <span className="r-act">{nextAllCopied ? '✓ Copied' : `Run (${nextAllCount})`}</span>
              <span className="r-live">
                Running ({runningCount}) <span className="run-dot" aria-hidden="true" />
              </span>
            </>
          ) : nextAllCopied ? (
            '✓ Copied'
          ) : (
            `Run (${nextAllCount})`
          )}
        </button>
        <button className="btn btn-primary topbar-icon" type="button" onClick={onNew} title="New idea" aria-label="New idea">
          <span aria-hidden="true">＋</span>
        </button>
        <SettingsMenu onConfigurePrompts={onConfigurePrompts} />
      </div>
    </header>
  )
}
