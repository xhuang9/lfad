import { useMemo, useRef } from 'react'

import { renderMarkdown } from '../../../../markdown'
import type { TicketDetail } from '../../../../types'
import { useMdPathCopy } from '../../../../useMdPathCopy'
import { useArtifactLinks } from '../../hooks/useArtifactLinks'
import { QuestionForm } from '../InputMode/QuestionForm'
import { useInputFlow } from '../InputMode/useInputFlow'
import { resolveArtifactRef, resolveFileUrl } from '../SectionDoc'
import { BLOCKED_ARTIFACT, blockedInfo } from './blockedInfo'

interface BlockedModeProps {
  ticketId: number
  commandPrefix: '/' | '$'
  skillPrefix: string
  detail: TicketDetail
  applyDetail: (detail: TicketDetail) => void
  copiedSkill: string | null
  onCopyCommand: (skill: string) => void
  onDirty: (dirty: boolean) => void
  onArtifactLink: (path: string, anchor: string | null) => boolean
}

function NextCommand({ ticketId, commandPrefix, skillPrefix, copied, onCopy }: {
  ticketId: number
  commandPrefix: '/' | '$'
  skillPrefix: string
  copied: boolean
  onCopy: () => void
}) {
  const command = `${commandPrefix}${skillPrefix}:next ${ticketId}`
  return (
    <div className="blocked-command-row">
      <code>{command}</code>
      <button className="btn cmd-btn" onClick={onCopy}>{copied ? 'Copied' : 'Copy command'}</button>
    </div>
  )
}

export function BlockedMode({ ticketId, commandPrefix, skillPrefix, detail, applyDetail, copiedSkill, onCopyCommand, onDirty, onArtifactLink }: BlockedModeProps) {
  const info = blockedInfo(detail.ticket, detail.artifacts, detail.questions)
  const flow = useInputFlow(ticketId, detail, applyDetail, BLOCKED_ARTIFACT)
  const reasonRef = useRef<HTMLDivElement>(null)
  const reasonHtml = useMemo(() => info.reason === null ? '' : renderMarkdown(
    info.reason,
    (url) => resolveFileUrl(ticketId, BLOCKED_ARTIFACT, url),
    (url) => resolveArtifactRef(BLOCKED_ARTIFACT, url),
  ).html, [info.reason, ticketId])

  useMdPathCopy(reasonRef, reasonHtml)
  useArtifactLinks(reasonRef, reasonHtml, onArtifactLink)

  const question = info.escalatedQuestion ?? flow.current
  const returnStep = info.returnStep ?? 'Not recorded'
  const copyNext = () => onCopyCommand(`${skillPrefix}:next`)
  const command = (
    <NextCommand
      ticketId={ticketId}
      commandPrefix={commandPrefix}
      skillPrefix={skillPrefix}
      copied={copiedSkill === `${skillPrefix}:next`}
      onCopy={copyNext}
    />
  )

  return (
    <main className="blocked-panel">
      <div className="blocked-lead">
        <strong>{info.hasReason ? 'This ticket is blocked, waiting on you.' : 'This ticket is blocked, but no reason was recorded.'}</strong>
        <p>{info.hasReason
          ? `An agent paused at ${returnStep}. Review the reason and unblock path below.`
          : 'There is no question to answer. Use the generic unblock command below.'}</p>
      </div>

      <section className="blocked-section">
        <h2><span>1</span> Status</h2>
        <dl className="blocked-status">
          <dt>Blocked at</dt><dd>{returnStep}, then moved to lateral blocked</dd>
          <dt>Return to</dt><dd>{returnStep}</dd>
          <dt>Reason</dt><dd className={info.hasReason ? 'blocked-reason-present' : 'blocked-reason-missing'}>{info.hasReason ? 'Recorded in blocked.md' : 'No blocked.md content'}</dd>
        </dl>
      </section>

      <section className="blocked-section blocked-reason">
        <h2><span>2</span> Reason</h2>
        {reasonHtml !== '' ? (
          <div ref={reasonRef} className="md" dangerouslySetInnerHTML={{ __html: reasonHtml }} />
        ) : (
          <div className="blocked-empty">
            <strong>No reason recorded</strong>
            <p>The block was created without a reason file. The return path is still available below.</p>
          </div>
        )}
      </section>

      <section className="blocked-section blocked-unblock">
        <h2><span>3</span> Unblock</h2>
        {question !== undefined && question !== null && question.open ? (
          <div className="blocked-answer">
            <h3>{question.ask ?? 'Answer the escalated question'}</h3>
            {flow.notice !== null && <p className="input-notice">{flow.notice}</p>}
            {flow.error !== null && <p className="drawer-error input-error">{flow.error}</p>}
            <QuestionForm
              key={`${question.file}-${question.decisionLine}`}
              question={question}
              ticketId={ticketId}
              submitting={flow.submitting}
              onSubmit={flow.submit}
              onDirty={onDirty}
            />
            <p className="blocked-footnote">Saving records the answer in blocked.md. The unblock command appears here after the answer is saved.</p>
          </div>
        ) : question !== undefined && question !== null ? (
          <div className="blocked-complete">
            <strong>Answer recorded</strong>
            {flow.answeredValue !== null && <p>{flow.answeredValue}</p>}
            <p>Copy the command and run it in your agent session to return this ticket to {returnStep}.</p>
            {command}
          </div>
        ) : (
          <div className="blocked-complete">
            <p>No answerable question was recorded. Copy the command and run it in your agent session to return this ticket to {returnStep}.</p>
            {command}
          </div>
        )}
        <p className="blocked-footnote">The UI only copies this command. It never moves the ticket.</p>
      </section>
    </main>
  )
}
