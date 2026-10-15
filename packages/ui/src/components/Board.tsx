import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

import { useExpandedColumns } from '../expandedColumns'
import type { KeywordSettings, StepPayload, Ticket } from '../types'
import { useResolvedOrientation } from '../useBoardLayout'
import type { CardHint } from './Card'
import { Card } from './Card'

interface BoardProps {
  tickets: Ticket[]
  steps: StepPayload[]
  onOpen: (id: number) => void
  /** Opens a ticket's drawer directly in input mode (card `? n` badges). */
  onOpenInput: (id: number) => void
  keywords: KeywordSettings
}

interface ColumnProps {
  step: StepPayload
  /** Status badge every card in this column carries (derived from the step). */
  hint: CardHint | null
  tickets: Ticket[]
  onOpen: (id: number) => void
  onOpenInput: (id: number) => void
  keywords: KeywordSettings
  /** Expanded: every card shows, flowing into extra card columns instead of scrolling. */
  expanded: boolean
  onToggleExpanded: () => void
}

/** Returns the status hint carried by every card in a step. */
export function hintFor(step: StepPayload): CardHint | null {
  if (step.lateral) return { label: 'Blocked', tone: 'blocked' }
  return null
}

function Column({ step, hint, tickets, onOpen, onOpenInput, keywords, expanded, onToggleExpanded }: ColumnProps) {
  const className = ['column', step.lateral && 'column-lateral', expanded && 'is-expanded'].filter(Boolean).join(' ')

  // Pipeline label from the config position + key (e.g. "5-todo").
  const order = `${step.position}`

  return (
    <section className={className} aria-label={`${step.label} column, ${tickets.length} tickets`}>
      <header className="column-head">
        <div className="column-head-lead">
          <span className="column-title">
            <span className="column-order">{order}</span>
            {step.label}
          </span>
          <button
            className={`column-expand ${expanded ? 'is-on' : ''}`}
            type="button"
            onClick={onToggleExpanded}
            aria-pressed={expanded}
            aria-label={expanded ? `Collapse the ${step.label} column` : `Show every ${step.label} card`}
            title={expanded ? 'Collapse to a scrolling list' : 'Show every card'}
          >
            {expanded ? <Minimize2 aria-hidden="true" focusable="false" /> : <Maximize2 aria-hidden="true" focusable="false" />}
          </button>
        </div>
        <span className="column-count">{tickets.length}</span>
      </header>
      <div className="column-body" role="list">
        {tickets.length === 0 ? (
          <p className="column-empty" aria-hidden="true">
            —
          </p>
        ) : (
          tickets.map((t) => <Card key={t.id} ticket={t} hint={hint} onOpen={onOpen} onOpenInput={onOpenInput} keywords={keywords} />)
        )}
      </div>
    </section>
  )
}

interface LandscapeGroupProps {
  label: string
  side: 'human' | 'agent'
  columnCount: number
  /** True when one of the group's columns is expanded. */
  fitToContent: boolean
  children: ReactNode
}

/** One side-by-side half. While a column inside is expanded, the half takes the
 *  measured width of its columns so every card shows, and the board scrolls
 *  sideways. The browser underestimates the intrinsic width of a column whose
 *  cards wrap vertically, so the width is measured after layout. */
function LandscapeGroup({ label, side, columnCount, fitToContent, children }: LandscapeGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const group = groupRef.current
    const cols = colsRef.current
    if (!group || !cols) return
    if (!fitToContent) {
      group.style.removeProperty('flex-basis')
      return
    }
    const fit = (): void => {
      const borders = group.offsetWidth - group.clientWidth
      group.style.flexBasis = `${cols.scrollWidth + borders + 1}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    for (const column of Array.from(cols.children)) observer.observe(column)
    return () => observer.disconnect()
  }, [fitToContent, columnCount])

  return (
    <div
      ref={groupRef}
      className={`board-group board-group-${side}${fitToContent ? ' has-expanded' : ''}`}
      style={{ '--cols': columnCount } as CSSProperties}
    >
      <div className="board-group-header">
        <span className="board-group-label">{label}</span>
        <span className="board-group-count">{columnCount}</span>
      </div>
      <div ref={colsRef} className="board-cols">
        {children}
      </div>
    </div>
  )
}

export function Board({ tickets, steps, onOpen, onOpenInput, keywords }: BoardProps) {
  const [expandedSteps, toggleExpanded] = useExpandedColumns()
  const orientation = useResolvedOrientation()
  const byStep = (key: string) => tickets.filter((t) => t.status === key)

  const renderColumn = (step: StepPayload) => (
    <Column
      key={step.key}
      step={step}
      hint={hintFor(step)}
      tickets={byStep(step.key)}
      onOpen={onOpen}
      onOpenInput={onOpenInput}
      keywords={keywords}
      expanded={expandedSteps.has(step.key)}
      onToggleExpanded={() => toggleExpanded(step.key)}
    />
  )

  // View-only board: agents move tickets in/out, so only render columns that
  // currently hold tickets (empty steps are hidden until something lands there).
  // The two groups are the step's configured `row` — needs-you first, agents second.
  const agentCols = steps.filter((s) => s.row === 'agents' && byStep(s.key).length > 0)
  const humanCols = steps.filter((s) => s.row === 'needs-you' && byStep(s.key).length > 0)

  // Portrait: today's exact layout — a stacked row with a vertical side label
  // and the columns as inline siblings. Landscape: a side-by-side half with a
  // horizontal header on top and the columns in a horizontal-scroll wrapper.
  // The columns themselves are identical in both.
  const renderGroup = (label: string, side: 'human' | 'agent', cols: StepPayload[]) => {
    if (cols.length === 0) return null
    if (orientation === 'portrait') {
      return (
        <div className={`board-row board-row-${side}`}>
          <span className="board-row-label" aria-hidden="true">
            {label}
          </span>
          {cols.map(renderColumn)}
        </div>
      )
    }
    return (
      <LandscapeGroup label={label} side={side} columnCount={cols.length} fitToContent={cols.some((step) => expandedSteps.has(step.key))}>
        {cols.map(renderColumn)}
      </LandscapeGroup>
    )
  }

  return (
    <div className={`board board-${orientation}`}>
      {renderGroup('Needs you', 'human', humanCols)}
      {renderGroup('Agents', 'agent', agentCols)}
      {agentCols.length === 0 && humanCols.length === 0 ? <p className="board-empty">No tickets yet.</p> : null}
    </div>
  )
}
