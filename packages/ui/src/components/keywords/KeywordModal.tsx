import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'

import { setKeywordSettings } from '../../api'
import { KEYWORD_PALETTE, normalizeKeyword } from '../../keywords'
import type { KeywordRename, KeywordSettings } from '../../types'
import { useFocusTrap } from '../../useFocusTrap'
import { KeywordRow, type DraftKeyword } from './KeywordRow'

interface KeywordModalProps {
  settings: KeywordSettings
  onClose: () => void
  onSaved: (settings: KeywordSettings) => void
}

function initialRows(settings: KeywordSettings): DraftKeyword[] {
  return settings.items.map((keyword, index) => ({
    id: `saved-${index}`,
    word: keyword.word,
    color: keyword.color,
    originalWord: keyword.word,
  }))
}

export function KeywordModal({ settings, onClose, onSaved }: KeywordModalProps) {
  const [rows, setRows] = useState(() => initialRows(settings))
  const [maxShown, setMaxShown] = useState(String(settings.maxShown))
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useFocusTrap(panelRef)

  const requestClose = useCallback(() => {
    if (!submitting) onClose()
  }, [onClose, submitting])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  const renames = useMemo<KeywordRename[]>(() => rows.flatMap((row) => {
    const word = row.word.trim()
    if (row.originalWord === undefined || row.originalWord === word) return []
    return [{ from: row.originalWord, to: word }]
  }), [rows])

  function validationError(): string | null {
    const limit = Number(maxShown)
    if (!Number.isSafeInteger(limit) || limit < 1) return 'Max keywords shown must be a positive whole number.'
    const words = rows.map((row) => row.word.trim())
    if (words.some((word) => word.length === 0)) return 'Every keyword needs wording.'
    if (new Set(words.map(normalizeKeyword)).size !== words.length) return 'Keyword wording must be unique.'
    return null
  }

  function buildSettings(): KeywordSettings {
    return {
      maxShown: Number(maxShown),
      items: rows.map((row) => ({ word: row.word.trim(), color: row.color })),
    }
  }

  function beginSave() {
    const nextError = validationError()
    setError(nextError)
    if (nextError !== null) return
    if (renames.length > 0) setConfirming(true)
    else void persist(false)
  }

  async function persist(propagate: boolean) {
    setSubmitting(true)
    setError(null)
    try {
      const result = await setKeywordSettings(buildSettings(), renames, propagate)
      onSaved(result.keywords)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
      setConfirming(false)
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (over === null || active.id === over.id) return
    setRows((current) => {
      const from = current.findIndex((row) => row.id === active.id)
      const to = current.findIndex((row) => row.id === over.id)
      return from < 0 || to < 0 ? current : arrayMove(current, from, to)
    })
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        className={`modal keyword-modal ${confirming ? 'keyword-confirm' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={confirming ? 'Confirm keyword renames' : 'Configure project keywords'}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        {confirming ? (
          <>
            <header className="modal-head keyword-modal-head">
              <h2>Rename ticket keywords?</h2>
              <button className="keyword-modal-close" onClick={() => setConfirming(false)}>Back</button>
            </header>
            <div className="modal-body keyword-confirm-body">
              <p>Choose whether these wording changes should update matching tags on every active ticket.</p>
              <ul>
                {renames.map((rename) => <li key={rename.from}><code>{rename.from}</code> → <code>{rename.to}</code></li>)}
              </ul>
              <p className="muted">Archived tickets are never changed. Leaving old tickets unchanged may make their old tags neutral.</p>
              {error !== null ? <p className="drawer-error" role="alert">{error}</p> : null}
            </div>
            <footer className="modal-foot keyword-confirm-foot">
              <button className="btn" type="button" disabled={submitting} onClick={() => void persist(false)}>No, leave old tickets</button>
              <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => void persist(true)}>Yes, update all active</button>
            </footer>
          </>
        ) : (
          <>
            <header className="modal-head keyword-modal-head">
              <h2>Configure keywords</h2>
              <button className="keyword-modal-close" onClick={requestClose} aria-label="Close (Esc)">Close</button>
            </header>
            <div className="modal-body keyword-modal-body">
              <label className="field keyword-limit">
                <span className="field-label">Max keywords shown per card</span>
                <input className="text-input" type="number" min="1" step="1" value={maxShown} onChange={(event) => setMaxShown(event.target.value)} />
              </label>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
                  <div className="keyword-edit-list">
                    {rows.map((row) => (
                      <KeywordRow
                        key={row.id}
                        keyword={row}
                        changed={row.originalWord !== undefined && row.originalWord !== row.word.trim()}
                        onChange={(next) => setRows((current) => current.map((item) => item.id === row.id ? next : item))}
                        onDelete={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <button
                className="keyword-add"
                type="button"
                onClick={() => {
                  const id = `new-${nextId.current++}`
                  const color = KEYWORD_PALETTE[rows.length % KEYWORD_PALETTE.length].colors[2]
                  setRows((current) => [...current, { id, word: '', color }])
                }}
              >
                Add keyword
              </button>
              {error !== null ? <p className="drawer-error" role="alert">{error}</p> : null}
            </div>
            <footer className="modal-foot">
              <button className="btn" type="button" disabled={submitting} onClick={requestClose}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={submitting} onClick={beginSave}>Save</button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
