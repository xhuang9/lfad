// Input-mode flow state: which question is up (free navigation across every
// question in file/rail order, not just forward through the open ones), the
// progress counter, and the answer write-back. Submit refetches the ticket
// first (stale guard — the board may have moved while the operator typed),
// re-locates the question in the fresh payload, and rewrites ONLY its
// `**Decision:**` line. The PUT response carries the refreshed questions, which
// advances the flow to the next still-open question.

import { useCallback, useMemo, useState } from 'react'

import { ApiError, getTicket, updateArtifact } from '../../../../api'
import type { QuestionInfo, TicketDetail } from '../../../../types'

const DECISION_PREFIX = '**Decision:**'
const STAMP_RE = /\s*·\d{4}-\d{2}-\d{2}\s*$/

/** Local YYYY-MM-DD for the Decision stamp. */
function todayStamp(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Matches the shown question against one from a fresh refetch. `id` wins when
 * present; then `ask`; bare questions fall back to the Decision line index
 * (exact when the file is unchanged) or the surrounding context.
 */
function sameQuestion(a: QuestionInfo, b: QuestionInfo): boolean {
  if (a.file !== b.file) return false
  if (a.id !== undefined || b.id !== undefined) return a.id === b.id
  if (a.ask !== undefined || b.ask !== undefined) return a.ask === b.ask
  return a.decisionLine === b.decisionLine || (a.context !== undefined && a.context === b.context)
}

/**
 * Rewrites the Decision line and its optional comment block. The answer stays on
 * the `**Decision:**` line (byte-compatible with a hand edit or an inline agent
 * write); an optional comment renders as `>` blockquote lines immediately
 * beneath it. Any existing comment block (consecutive `>` lines directly under
 * the Decision) is replaced, so re-answering never stacks duplicate comments.
 */
function applyDecision(lines: string[], decisionLine: number, answer: string, comment: string, eol: string): string[] {
  const out = lines.slice()
  out[decisionLine] = `${DECISION_PREFIX} ${answer} ·${todayStamp()}${eol}`
  let end = decisionLine + 1
  while (end < out.length && /^\s*>/.test(out[end] ?? '')) end += 1
  const commentLines = comment.trim() === ''
    ? []
    : comment.trim().split('\n').map((l) => `> ${l.trim()}${eol}`)
  out.splice(decisionLine + 1, end - (decisionLine + 1), ...commentLines)
  return out
}

/** The recorded answer for an already-answered question (Decision line minus the date stamp). */
function recordedAnswer(detail: TicketDetail, q: QuestionInfo): string | null {
  const art = detail.artifacts.find((a) => a.name === q.file)
  if (art === undefined) return null
  const line = art.content.split('\n')[q.decisionLine] ?? ''
  const m = /^\*\*Decision:\*\*(.*)$/.exec(line)
  if (m === null) return null
  const val = m[1].replace(STAMP_RE, '').trim()
  return val === '' ? null : val
}

export interface InputFlowState {
  /** The question being shown — may be open or already answered (navigable). */
  current: QuestionInfo | undefined
  /** Recorded answer for the current question when it's already answered. */
  answeredValue: string | null
  /** 1-based position for the "2 / 5" counter. */
  position: number
  total: number
  /** How many questions are still open — 0 means the completion state. */
  openCount: number
  submitting: boolean
  /** Skip-forward notice (question answered elsewhere while typing). */
  notice: string | null
  error: string | null
  /**
   * Writes the answer (and an optional free-text comment) to the Decision line.
   * `replace` re-answers an already-answered question (D5) — without it the
   * write bails when the question is no longer open.
   */
  submit: (answer: string, comment?: string, replace?: boolean) => void
  goTo: (index: number) => void
  next: () => void
  prev: () => void
  canPrev: boolean
  canNext: boolean
}

export function useInputFlow(
  ticketId: number,
  detail: TicketDetail,
  applyDetail: (d: TicketDetail) => void,
  artifactName?: string,
): InputFlowState {
  const questions = useMemo(
    () => artifactName === undefined
      ? detail.questions
      : detail.questions.filter((question) => question.file.toLowerCase() === artifactName.toLowerCase()),
    [artifactName, detail.questions],
  )
  // Start on the first still-open question; navigation then moves freely.
  const [index, setIndex] = useState(() => {
    const i = questions.findIndex((q) => q.open)
    return i >= 0 ? i : 0
  })
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const total = questions.length
  const safeIndex = total === 0 ? -1 : Math.min(index, total - 1)
  const current = safeIndex < 0 ? undefined : (questions[safeIndex] as QuestionInfo)
  const openCount = useMemo(() => questions.filter((q) => q.open).length, [questions])
  const answeredValue = current !== undefined && !current.open ? recordedAnswer(detail, current) : null

  const goTo = useCallback((i: number) => {
    setNotice(null)
    setError(null)
    setIndex(Math.max(0, Math.min(i, total - 1)))
  }, [total])
  const next = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex])
  const prev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex])

  const submit = useCallback(
    (answer: string, comment?: string, replace?: boolean) => {
      if (current === undefined || submitting) return
      if (!current.open && replace !== true) return
      const question = current
      setSubmitting(true)
      setError(null)
      void (async () => {
        try {
          // Stale guard: work off a fresh payload, never the one on screen.
          const fresh = await getTicket(ticketId)
          // Re-locate the question. Duplicate ids/asks/contexts can make
          // several fresh questions "the same" — the Decision-line index
          // disambiguates when the file is unchanged; a still-ambiguous match
          // bails to the latest state rather than risking the wrong line.
          const candidates = fresh.questions.filter((q) => sameQuestion(q, question))
          const freshQ = candidates.find((q) => q.decisionLine === question.decisionLine)
            ?? (candidates.length === 1 ? candidates[0] : undefined)
          if (freshQ === undefined || (!freshQ.open && replace !== true)) {
            setNotice(freshQ === undefined && candidates.length > 1
              ? 'The document changed under this question — showing the latest state.'
              : 'This question was answered elsewhere — skipped forward.')
            applyDetail(fresh)
            return
          }
          const artifact = fresh.artifacts.find((a) => a.name === freshQ.file)
          const lines = artifact === undefined ? [] : artifact.content.split('\n')
          const before = lines[freshQ.decisionLine] ?? ''
          if (artifact === undefined || !before.startsWith(DECISION_PREFIX)) {
            setNotice('The document changed under this question — showing the latest state.')
            applyDetail(fresh)
            return
          }
          // Plain-markdown contract: this line must byte-match what an
          // Obsidian hand-edit or an inline agent write would produce. A CRLF
          // source line keeps its `\r` so line endings survive the rewrite.
          const commentText = comment ?? ''
          const oneLine = answer.replace(/\s*\n\s*/g, ' ').trim()
          // Comment-only answer (no option/pick, just a typed comment): the
          // comment becomes the recorded answer — its single-line-collapsed form
          // fills the Decision line so the gate resolves, while the full
          // multi-line comment is still kept verbatim as the `>` block beneath.
          const decision = oneLine === '' ? commentText.replace(/\s*\n\s*/g, ' ').trim() : oneLine
          const eol = before.endsWith('\r') ? '\r' : ''
          const newLines = applyDecision(lines, freshQ.decisionLine, decision, commentText, eol)
          // `baseContent` makes the PUT conditional: the daemon 409s when the
          // file changed between the refetch above and this write, so an edit
          // landing in that window is never silently overwritten.
          const updated = await updateArtifact(ticketId, freshQ.file, newLines.join('\n'), artifact.content)
          applyDetail(updated)
          setNotice(null)
          // Answering advances to the next still-open question (after this one,
          // else the first open anywhere). Re-editing an already-answered
          // question stays put — the operator was reviewing it, not progressing.
          if (replace !== true) {
            const q2 = artifactName === undefined
              ? updated.questions
              : updated.questions.filter((q) => q.file.toLowerCase() === artifactName.toLowerCase())
            const forward = q2.findIndex((q, i) => i > safeIndex && q.open)
            const nextOpen = forward >= 0 ? forward : q2.findIndex((q) => q.open)
            if (nextOpen >= 0) setIndex(nextOpen)
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            setNotice('The document changed under this question — showing the latest state.')
            try {
              applyDetail(await getTicket(ticketId))
            } catch {
              // refetch failed; keep the current detail — the next board tick refreshes it
            }
            return
          }
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setSubmitting(false)
        }
      })()
    },
    [ticketId, current, submitting, safeIndex, applyDetail, artifactName],
  )

  return {
    current,
    answeredValue,
    position: safeIndex + 1,
    total,
    openCount,
    submitting,
    notice,
    error,
    submit,
    goTo,
    next,
    prev,
    canPrev: safeIndex > 0,
    canNext: safeIndex >= 0 && safeIndex < total - 1,
  }
}
