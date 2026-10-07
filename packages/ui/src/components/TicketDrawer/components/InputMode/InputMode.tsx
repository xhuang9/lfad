// Input mode: the drawer's question flow. The head + question context scroll in
// the upper region; the answer control is pinned in a footer at the bottom (so
// it stays reachable in both the half-height and full-height drawer). The
// operator can move freely between questions (‹ ›), not just forward — an
// already-answered question shows its recorded answer read-only. Once every
// question is answered, a completion state offers the copyable next command.

import { useEffect, useMemo, useRef, useState } from 'react'

import { renderMarkdown } from '../../../../markdown'
import type { QuestionInfo, TicketDetail } from '../../../../types'
import { useMdPathCopy } from '../../../../useMdPathCopy'
import { useArtifactLinks } from '../../hooks/useArtifactLinks'
import { resolveArtifactRef, resolveFileUrl } from '../SectionDoc'
import { QuestionForm } from './QuestionForm'
import { useInputFlow } from './useInputFlow'

/** Remount key so form state resets when the shown question changes. */
function questionKey(q: QuestionInfo): string {
  return `${q.file}#${q.id ?? q.ask ?? q.decisionLine}`
}

/** Nearest preceding heading in the context markdown — the ask for bare questions. */
function headingAsk(context: string | undefined): string | null {
  if (context === undefined) return null
  let last: string | null = null
  for (const line of context.split('\n')) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (m !== null) last = m[1]
  }
  return last
}

interface InputModeProps {
  ticketId: number
  commandPrefix: '/' | '$'
  detail: TicketDetail
  /** Applies the refreshed detail returned by the write-back PUT. */
  applyDetail: (d: TicketDetail) => void
  /** Skills that can process the ticket here — the completion state's commands. */
  actions: string[]
  copiedSkill: string | null
  onCopyCommand: (skill: string) => void
  /** Returns to the doc view. */
  onExit: () => void
  /** True while a draft answer is typed — the drawer holds live refetches. */
  onDirty: (dirty: boolean) => void
  /** Routes a same-ticket artifact link through a section switch (exits input
   *  mode); returns true when handled. */
  onArtifactLink: (path: string, anchor: string | null) => boolean
}

export function InputMode({ ticketId, commandPrefix, detail, applyDetail, actions, copiedSkill, onCopyCommand, onExit, onDirty, onArtifactLink }: InputModeProps) {
  const contextRef = useRef<HTMLDivElement>(null)
  const { current, answeredValue, position, total, openCount, submitting, notice, error, submit, next, prev, canPrev, canNext } = useInputFlow(ticketId, detail, applyDetail)

  // Which answered question (if any) is being re-edited (D5). Reset whenever the
  // shown question changes so navigating away closes the edit form.
  const [editKey, setEditKey] = useState<string | null>(null)
  const curKey = current !== undefined ? questionKey(current) : null
  useEffect(() => { setEditKey(null) }, [curKey])

  const contextHtml = useMemo(() => {
    if (current?.context === undefined || current.context.trim() === '') return ''
    const file = current.file
    return renderMarkdown(
      current.context,
      (url) => resolveFileUrl(ticketId, file, url),
      (url) => resolveArtifactRef(file, url),
    ).html
  }, [current, ticketId])

  useMdPathCopy(contextRef, contextHtml)
  useArtifactLinks(contextRef, contextHtml, onArtifactLink)

  // Completion: no question is open (or the ticket has none). Navigation is
  // only offered while there is still something to answer.
  if (openCount === 0 || current === undefined) {
    return (
      <div className="input-mode input-complete">
        <span className="input-progress">{total > 0 ? `${total} / ${total}` : '0 / 0'}</span>
        <h2 className="input-ask">{total > 0 ? 'All questions answered' : 'No open questions'}</h2>
        {actions.length > 0 && (
          <>
            <p className="muted">Next — copy a command and paste it into your agent session:</p>
            <div className="input-choices">
              {actions.map((skill) => (
                <button
                  key={skill}
                  className="btn cmd-btn"
                  onClick={() => onCopyCommand(skill)}
                  aria-label={`Copy command ${commandPrefix}${skill} ${ticketId}`}
                >
                  {copiedSkill === skill ? '✓ Copied' : `${commandPrefix}${skill} ${ticketId}`}
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn input-back" onClick={onExit}>
          Back to document
        </button>
      </div>
    )
  }

  const ask = current.ask ?? headingAsk(current.context) ?? `Question ${position}`

  return (
    // Split layout: the question panel floats on the LEFT, the doc content
    // scrolls independently on the RIGHT. Each side owns its own scroll.
    <div className="input-mode input-split">
      <div className="input-side">
        <div className="input-nav">
          <button className="btn input-nav-btn" onClick={prev} disabled={!canPrev} aria-label="Previous question">
            ‹ Prev
          </button>
          <span className="input-nav-count">
            {position} / {total}
          </span>
          <button className="btn input-nav-btn" onClick={next} disabled={!canNext} aria-label="Next question">
            Next ›
          </button>
        </div>
        {notice !== null && <p className="input-notice">{notice}</p>}
        {error !== null && <p className="drawer-error input-error">{error}</p>}
        <div className="input-card">
          <h2 className="input-ask">{ask}</h2>
          {current.open ? (
            <QuestionForm key={questionKey(current)} question={current} ticketId={ticketId} submitting={submitting} onSubmit={submit} onDirty={onDirty} />
          ) : editKey === curKey ? (
            // Re-editing an already-answered question (D5): resubmit replaces the
            // Decision line + comment block; the text field seeds with the old answer.
            <QuestionForm
              key={`edit-${questionKey(current)}`}
              question={current}
              ticketId={ticketId}
              submitting={submitting}
              initialText={answeredValue ?? ''}
              onSubmit={(answer, comment) => { submit(answer, comment, true); setEditKey(null) }}
              onDirty={onDirty}
            />
          ) : (
            <div className="input-answered">
              <span className="input-answered-label">Answered</span>
              {answeredValue !== null && <span className="input-answered-value">{answeredValue}</span>}
              <button className="btn input-edit-btn" onClick={() => setEditKey(curKey)}>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="input-main">
        <div className="input-head">
          <span className="input-file">{current.file}</span>
        </div>
        {contextHtml !== '' ? (
          // Same sanitized renderer + ticket-relative URL resolution as SectionDoc.
          <div ref={contextRef} className="md input-context" dangerouslySetInnerHTML={{ __html: contextHtml }} />
        ) : (
          <p className="muted input-nocontext">No reference for this question.</p>
        )}
      </div>
    </div>
  )
}
