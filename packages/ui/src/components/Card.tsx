import { Fragment, type CSSProperties } from 'react'

import { cardTags } from '../keywords'
import { dependencyBadge, isDependencyHeld } from '../dependencies'
import type { KeywordSettings, Ticket } from '../types'
import { CATEGORY_BADGES, CATEGORY_COLORS } from '../types'
import { useCopied } from '../useCopied'
import { StageBar } from './StageProgress'

/** Status badge for a card, derived by the board from its step's metadata. */
export interface CardHint {
  label: string
  tone: 'blocked'
}

interface CardProps {
  ticket: Ticket
  /** The status badge the ticket's step carries; null when it has none. */
  hint?: CardHint | null
  onOpen: (id: number) => void
  /** Opens the ticket drawer directly in input mode (the `? n` badge). */
  onOpenInput: (id: number) => void
  keywords: KeywordSettings
}

/**
 * Degraded rendering for an unreadable ticket folder: the folder name plus a
 * fix-on-disk hint. Deliberately not clickable — the drawer has nothing to
 * fetch (the server 404s a broken ticket.md); the error rides the tooltip.
 */
function UnreadableCard({ ticket }: { ticket: Ticket }) {
  const folder = `${String(ticket.id).padStart(5, '0')}-${ticket.slug}`
  return (
    <article
      className="card card-blocked"
      style={{ cursor: 'default' }}
      role="listitem"
      tabIndex={0}
      aria-label={`Ticket folder ${folder}: unreadable ticket.md — fix it on disk.`}
      title={ticket.unreadableError}
    >
      <div className="card-top">
        <span className="card-id">{`#${ticket.id}`}</span>
      </div>
      <div className="card-title">{folder}</div>
      <div className="card-foot">
        <span className="hint hint-blocked">unreadable — fix ticket.md on disk</span>
      </div>
    </article>
  )
}

export function Card({ ticket, hint = null, onOpen, onOpenInput, keywords }: CardProps) {
  const accent = CATEGORY_COLORS[ticket.category]
  const categoryBadge = CATEGORY_BADGES[ticket.category]
  const idStr = String(ticket.id)
  const openInputs = ticket.openInputs ?? 0
  const pendingManualTasks = ticket.manualTasks?.pending ?? 0
  const dependencyHeld = isDependencyHeld(ticket)
  const blockedBy = dependencyBadge(ticket)
  const running = ticket.running
  const { copied, copy } = useCopied()
  const renderedTags = cardTags(ticket.tags, keywords)
  const firstNeutralTag = renderedTags.visible.findIndex(({ keyword }) => keyword === undefined)

  if (ticket.unreadable) return <UnreadableCard ticket={ticket} />

  // A lateral blocked card stays passive even when blocked.md contains an open
  // Decision slot. Its reason and answer path belong to the drawer's pinned
  // Blocked section, not a card-level question affordance.
  const showQuestions = openInputs > 0 && hint?.tone !== 'blocked'
  const className = ['card', hint && `card-${hint.tone}`, dependencyHeld && 'card-dependency-held', showQuestions && 'card-question'].filter(Boolean).join(' ')
  // Manual/Express tint the card's left rule to the level colour and carry a
  // solid colour-coded badge next to #id; Normal (or absent) keeps the category
  // accent and renders no level badge. Normalize absent → normal for display
  // only; the persisted value is never touched here.
  const level = ticket.automationLevel ?? 'normal'
  const levelColor = level === 'manual' ? 'var(--warn)' : level === 'express' ? 'var(--accent)' : undefined

  return (
    <article
      className={className}
      style={{ borderLeftColor: dependencyHeld ? 'var(--warn)' : levelColor ?? accent }}
      role="listitem"
      tabIndex={0}
      aria-label={`Ticket #${ticket.id}: ${ticket.title}. ${ticket.category}, ${ticket.status}.`}
      onClick={() => onOpen(ticket.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onOpen(ticket.id)
        }
      }}
    >
      <div className="card-top">
        <span className="card-top-lead">
          <button
            className="card-id id-copy"
            onClick={(e) => {
              e.stopPropagation()
              copy(idStr)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
            aria-label={`Copy ticket id ${idStr}`}
            title="Copy id"
          >
            {copied ? 'Copied' : `#${idStr}`}
          </button>
          {level === 'express' ? <span className="automation-badge express">Express</span> : null}
          {level === 'manual' ? <span className="automation-badge manual">Manual</span> : null}
        </span>
        <span className="card-category" style={{ '--category-color': accent } as CSSProperties}>
          <span className="card-category-dot" aria-hidden="true" />
          {categoryBadge.label}
        </span>
      </div>
      <div className="card-title">{ticket.title}</div>
      {ticket.extras?.buildStages ? <StageBar stages={ticket.extras.buildStages} /> : null}
      <div className="card-foot">
        {ticket.worktree ? (
          <span className="card-wt" title={ticket.worktree}>
            {ticket.worktree.split('/').filter(Boolean).pop()}
          </span>
        ) : null}
        {renderedTags.visible.length > 0 || renderedTags.overflow > 0 ? (
          <span className="card-tag-run">
            {renderedTags.visible.map(({ tag, keyword }, index) => (
              <Fragment key={`${tag}-${index}`}>
                {keyword === undefined && index > firstNeutralTag ? <span className="card-tag-sep" aria-hidden="true">·</span> : null}
                <span
                  className={`card-tag${keyword === undefined ? '' : ' card-tag-matched'}`}
                  style={keyword === undefined ? undefined : { '--keyword-color': keyword.color } as CSSProperties}
                  title={keyword === undefined ? undefined : `Matches project keyword: ${keyword.word}`}
                >
                  {keyword === undefined ? null : <span className="card-tag-seed" aria-hidden="true" />}
                  {tag}
                </span>
              </Fragment>
            ))}
            {renderedTags.overflow > 0 ? <span className="card-tag-more">+{renderedTags.overflow}</span> : null}
          </span>
        ) : null}
        {showQuestions ? (
          <button
            className="hint hint-question"
            onClick={(e) => {
              e.stopPropagation()
              onOpenInput(ticket.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
            }}
            aria-label={`Answer ${openInputs} open question${openInputs === 1 ? '' : 's'}`}
            title="Answer open questions"
          >
            {openInputs} question{openInputs === 1 ? '' : 's'}
          </button>
        ) : null}
        {pendingManualTasks > 0 ? (
          <span
            className="hint hint-manual-tasks"
            aria-label={`${pendingManualTasks} pending manual task${pendingManualTasks === 1 ? '' : 's'}`}
            title="Pending manual tasks"
          >
            {pendingManualTasks} manual task{pendingManualTasks === 1 ? '' : 's'}
          </span>
        ) : null}
        {blockedBy ? <span className="hint hint-dependency">{blockedBy}</span> : null}
        {hint ? <span className={`hint hint-${hint.tone}`}>{hint.label}</span> : null}
        {running ? <span className="hint hint-running">Running{running.count > 1 ? ` (${running.count})` : ''}</span> : null}
      </div>
    </article>
  )
}
