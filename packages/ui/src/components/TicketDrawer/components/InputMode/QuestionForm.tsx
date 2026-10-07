// The per-question answer form, keyed by question so state resets on advance.
// Four answer shapes (canonical after the server normalizes choice/confirm):
//   approve — Approve / Reject buttons (single Approve when `single`)
//   option  — radio list, pick one
//   multi   — checkbox list, pick any (answer joins with ", ")
//   text    — a textarea with ⌘/⌃-Enter submit
// approve / option / multi also carry an optional free-text comment written as a
// `>` blockquote beneath the Decision line.

import type { ClipboardEvent } from 'react'
import { useEffect, useState } from 'react'

import { uploadTicketImage } from '../../../../api'
import type { QuestionInfo } from '../../../../types'

interface QuestionFormProps {
  question: QuestionInfo
  ticketId: number
  submitting: boolean
  onSubmit: (answer: string, comment?: string) => void
  /** True while a draft answer is in progress — the drawer holds live refetches. */
  onDirty: (dirty: boolean) => void
  /** Seeds the text field when re-editing an answered `text` question (D5). */
  initialText?: string
}

/**
 * Optional free-text comment shared by approve/option/multi. Pasting an image
 * uploads it beside the question's artifact and inserts a `![](files/…)` ref.
 */
function CommentField({ ticketId, file, value, onChange, disabled }: {
  ticketId: number
  file: string
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'))
    if (item === undefined) return // ordinary text paste — leave it to the textarea
    e.preventDefault()
    const blob = item.getAsFile()
    if (blob === null) return
    setUploading(true)
    setError(null)
    try {
      const { ref } = await uploadTicketImage(ticketId, file, blob)
      onChange(value.trim() === '' ? `![](${ref})` : `${value}\n![](${ref})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="input-comment-wrap">
      <textarea
        className="text-input input-comment"
        value={value}
        placeholder="Add a comment (optional)… paste an image to attach"
        spellCheck={false}
        aria-label="Optional comment"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => void handlePaste(e)}
      />
      {uploading && <span className="input-comment-hint muted">Uploading image…</span>}
      {error !== null && <span className="input-comment-hint input-comment-error">{error}</span>}
    </div>
  )
}

export function QuestionForm({ question, ticketId, submitting, onSubmit, onDirty, initialText = '' }: QuestionFormProps) {
  const options = question.options ?? []
  const hasOptions = options.length > 0
  // Undefined type with options degrades to a single-select; otherwise free text.
  const type = question.type ?? (hasOptions ? 'option' : 'text')

  const [comment, setComment] = useState('')
  const [text, setText] = useState(initialText)
  const [choice, setChoice] = useState<string | null>(null)
  const [picks, setPicks] = useState<string[]>([])

  // Any in-progress selection or text holds the drawer's live refetch so a board
  // tick never clobbers a draft; unmount (advance / mode-leave) releases it.
  const dirty = comment.trim().length > 0 || text.trim().length > 0 || choice !== null || picks.length > 0
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  if (type === 'approve') {
    return (
      <div className="input-answer-form">
        <CommentField ticketId={ticketId} file={question.file} value={comment} onChange={setComment} disabled={submitting} />
        <div className="input-choices" role="group" aria-label="Approve or reject">
          <button className="btn btn-primary choice-btn" disabled={submitting} onClick={() => onSubmit('Approve', comment)}>
            Approve
          </button>
          {question.single !== true && (
            <button className="btn choice-btn choice-reject" disabled={submitting} onClick={() => onSubmit('Reject', comment)}>
              Reject
            </button>
          )}
        </div>
      </div>
    )
  }

  if (type === 'option' && hasOptions) {
    return (
      <div className="input-answer-form">
        <div className="input-radios" role="radiogroup" aria-label="Answer options">
          {options.map((opt) => (
            <label key={opt} className={`input-radio ${choice === opt ? 'is-checked' : ''}`}>
              <input
                type="radio"
                name={`q-${question.decisionLine}`}
                checked={choice === opt}
                disabled={submitting}
                onChange={() => setChoice(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
        <CommentField ticketId={ticketId} file={question.file} value={comment} onChange={setComment} disabled={submitting} />
        <div className="input-submit-row">
          <button className="btn btn-primary" disabled={(choice === null && comment.trim() === '') || submitting} onClick={() => onSubmit(choice ?? '', comment)}>
            {submitting ? 'Saving…' : 'Submit answer'}
          </button>
        </div>
      </div>
    )
  }

  if (type === 'multi' && hasOptions) {
    const toggle = (opt: string) => setPicks((p) => (p.includes(opt) ? p.filter((x) => x !== opt) : [...p, opt]))
    return (
      <div className="input-answer-form">
        <div className="input-checks" role="group" aria-label="Answer options — choose any">
          {options.map((opt) => (
            <label key={opt} className={`input-check ${picks.includes(opt) ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={picks.includes(opt)}
                disabled={submitting}
                onChange={() => toggle(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
        <CommentField ticketId={ticketId} file={question.file} value={comment} onChange={setComment} disabled={submitting} />
        <div className="input-submit-row">
          <button
            className="btn btn-primary"
            disabled={(picks.length === 0 && comment.trim() === '') || submitting}
            onClick={() => onSubmit(options.filter((o) => picks.includes(o)).join(', '), comment)}
          >
            {submitting ? 'Saving…' : 'Submit answer'}
          </button>
        </div>
      </div>
    )
  }

  const canSubmit = text.trim().length > 0 && !submitting
  return (
    <div className="input-text">
      <textarea
        className="text-input input-answer"
        value={text}
        placeholder="Type your answer…"
        spellCheck={false}
        aria-label={question.ask ?? 'Answer'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
            e.preventDefault()
            onSubmit(text)
          }
        }}
      />
      <div className="input-submit-row">
        <span className="muted input-submit-hint">
          {/* The Decision write-back is a single markdown line (plain-markdown
              contract), so a multi-line draft warns that breaks are joined. */}
          {text.includes('\n') ? 'Line breaks are joined into one line · ⌘⏎ to submit' : '⌘⏎ to submit'}
        </span>
        <button className="btn btn-primary" disabled={!canSubmit} onClick={() => onSubmit(text)}>
          {submitting ? 'Saving…' : 'Submit answer'}
        </button>
      </div>
    </div>
  )
}
