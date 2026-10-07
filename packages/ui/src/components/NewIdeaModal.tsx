import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createTicket } from '../api'
import type { Category, StepPayload } from '../types'
import { CATEGORIES, CATEGORY_COLORS } from '../types'
import { useFocusTrap } from '../useFocusTrap'
import { FlowIdeaGuide } from './FlowIdeaGuide'

interface NewIdeaModalProps {
  steps: StepPayload[]
  onClose: () => void
  onCreated: () => void
}

export function NewIdeaModal({ steps, onClose, onCreated }: NewIdeaModalProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<Category>('ui')
  // Mirrors /flow:idea's contract: ui-category tickets default to the mock/design
  // gates. Picking a category resets the default; the checkbox stays overridable.
  const [needsDesign, setNeedsDesign] = useState(true)
  const [tags, setTags] = useState('')
  const [body, setBody] = useState('')
  const [entry, setEntry] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Entry points come from the board config — any step flagged `entry: true`.
  const entrySteps = useMemo(() => steps.filter((s) => s.entry), [steps])

  // Trap first (captures where focus came from), then start typing in Title.
  useFocusTrap(panelRef)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // Default to the first configured entry step once steps load (and keep the
  // selection valid if the config changes underneath an open modal).
  useEffect(() => {
    if (entrySteps.length > 0 && !entrySteps.some((s) => s.key === entry)) {
      setEntry(entrySteps[0].key)
    }
  }, [entrySteps, entry])

  // A typed draft (any non-empty text field) is guarded against accidental
  // dismissal: Esc and backdrop clicks confirm before discarding. Explicit
  // closes (the ✕ / Cancel buttons) and a clean modal close as today.
  const dirty = title.trim() !== '' || tags.trim() !== '' || body.trim() !== ''
  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard this draft ticket?')) return
    onClose()
  }, [dirty, onClose])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  function submit() {
    const trimmed = title.trim()
    if (!trimmed || submitting) return
    setSubmitting(true)
    setError(null)
    const tagList = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    createTicket({
      title: trimmed,
      category,
      body: body.trim() || undefined,
      tags: tagList.length > 0 ? tagList : undefined,
      // The API treats absence as false — send the flag only when it means something.
      needsDesign: needsDesign || undefined,
      entryStep: entry || undefined,
    })
      .then(() => {
        onCreated()
        onClose()
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
        setSubmitting(false)
      })
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="New ticket" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>New ticket</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <FlowIdeaGuide />

          <label className="field">
            <span className="field-label">Title</span>
            <input
              ref={titleRef}
              className="text-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add dark mode…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </label>

          <div className="field">
            <span className="field-label">Category</span>
            <div className="seg" role="group" aria-label="Category">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`seg-item ${category === c ? 'seg-active' : ''}`}
                  style={category === c ? { borderColor: CATEGORY_COLORS[c], color: CATEGORY_COLORS[c] } : undefined}
                  onClick={() => {
                    setCategory(c)
                    setNeedsDesign(c === 'ui')
                  }}
                  aria-pressed={category === c}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <label className="field field-check">
            <input
              type="checkbox"
              checked={needsDesign}
              onChange={(e) => setNeedsDesign(e.target.checked)}
            />
            <span>
              Needs design <span className="muted">— mock/design gates apply</span>
            </span>
          </label>

          <label className="field">
            <span className="field-label">Tags (comma separated)</span>
            <input
              className="text-input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="theme, settings"
            />
          </label>

          <label className="field">
            <span className="field-label">Intent — what &amp; why, not how</span>
            <textarea
              className="text-input"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the outcome you want…"
            />
          </label>

          {entrySteps.length > 0 && (
            <div className="field">
              <span className="field-label">Entry point</span>
              <div className="seg" role="group" aria-label="Entry point">
                {entrySteps.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`seg-item ${entry === s.key ? 'seg-active' : ''}`}
                    onClick={() => setEntry(s.key)}
                    aria-pressed={entry === s.key}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="drawer-error">{error}</p>}
        </div>

        <footer className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  )
}
