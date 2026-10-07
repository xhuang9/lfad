import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { setPromptTemplates } from '../../api'
import {
  PROMPT_PRESETS,
  validateRunAllTemplate,
  type PromptPreset,
  type PromptTemplates,
} from '../../prompts'
import { useFocusTrap } from '../../useFocusTrap'

interface PromptModalProps {
  templates: PromptTemplates
  onClose: () => void
  onSaved: (templates: PromptTemplates) => void
}

export function PromptModal({ templates, onClose, onSaved }: PromptModalProps) {
  const [template, setTemplate] = useState(templates.runAll)
  const [pendingPreset, setPendingPreset] = useState<PromptPreset | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const templateRef = useRef<HTMLTextAreaElement>(null)
  const keepTextRef = useRef<HTMLButtonElement>(null)

  useFocusTrap(panelRef)

  const validationError = useMemo(() => validateRunAllTemplate(template), [template])
  const activePreset = PROMPT_PRESETS.find((preset) => preset.template === template)?.key

  const requestClose = useCallback(() => {
    if (!submitting) onClose()
  }, [onClose, submitting])

  useEffect(() => {
    if (pendingPreset === null) templateRef.current?.focus()
    else keepTextRef.current?.focus()
  }, [pendingPreset])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (pendingPreset !== null) setPendingPreset(null)
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingPreset, requestClose])

  function choosePreset(preset: PromptPreset): void {
    if (preset.template === template) return
    setPendingPreset(preset)
  }

  function applyPreset(): void {
    if (pendingPreset === null) return
    setTemplate(pendingPreset.template)
    setPendingPreset(null)
    setSaveError(null)
  }

  async function save(): Promise<void> {
    if (validationError !== null) return
    setSubmitting(true)
    setSaveError(null)
    try {
      onSaved(await setPromptTemplates({ runAll: template }))
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
      setSubmitting(false)
    }
  }

  const shownError = validationError ?? saveError

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div
        className={`modal prompt-modal ${pendingPreset === null ? '' : 'prompt-confirm'}`}
        role="dialog"
        aria-modal="true"
        aria-label={pendingPreset === null ? 'Action prompts' : 'Confirm prompt preset'}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        {pendingPreset === null ? (
          <>
            <header className="modal-head prompt-modal-head">
              <div>
                <h2>Action prompts</h2>
                <p>Edit the text copied by Run (N). The action itself stays the same.</p>
              </div>
              <button className="prompt-close" type="button" onClick={requestClose}>Close</button>
            </header>
            <div className="modal-body prompt-modal-body">
              <section className="field" aria-labelledby="prompt-preset-label">
                <span className="field-label" id="prompt-preset-label">Preset</span>
                <p className="prompt-field-hint">Choose a shipped template to replace the text below.</p>
                <div className="seg prompt-presets">
                  {PROMPT_PRESETS.map((preset) => (
                    <button
                      className={`seg-item prompt-preset ${activePreset === preset.key ? 'seg-active' : ''}`}
                      type="button"
                      key={preset.key}
                      aria-pressed={activePreset === preset.key}
                      onClick={() => choosePreset(preset)}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.description}</small>
                    </button>
                  ))}
                </div>
              </section>

              <label className="field" htmlFor="run-all-template">
                <span className="field-label">Run (N) prompt template</span>
                <textarea
                  className={`text-input prompt-template ${validationError === null ? '' : 'prompt-template-invalid'}`}
                  id="run-all-template"
                  ref={templateRef}
                  value={template}
                  aria-invalid={validationError !== null}
                  aria-describedby={shownError === null ? 'prompt-variables' : 'prompt-template-error prompt-variables'}
                  onChange={(event) => {
                    setTemplate(event.target.value)
                    setSaveError(null)
                  }}
                />
              </label>

              {shownError !== null && (
                <p className="drawer-error prompt-error" id="prompt-template-error" role="alert">{shownError}</p>
              )}

              <section className="prompt-variables" id="prompt-variables" aria-labelledby="prompt-variables-title">
                <h3 id="prompt-variables-title">Template variables</h3>
                <div className="prompt-variable-row">
                  <code>{'{ids}'}</code>
                  <span>Sorted tickets that Run (N) can advance now.</span>
                  <strong className="prompt-variable-required">Required</strong>
                </div>
                <div className="prompt-variable-row">
                  <code>{'{command}'}</code>
                  <span>The installed plugin's next command with the active command prefix.</span>
                  <strong>Auto</strong>
                </div>
                <div className="prompt-variable-row">
                  <code>{'{loop}'}</code>
                  <span>The active prefix plus loop.</span>
                  <strong>Auto</strong>
                </div>
              </section>
            </div>
            <footer className="modal-foot prompt-modal-foot">
              <span className={`prompt-status ${shownError === null ? '' : 'prompt-status-invalid'}`}>
                {validationError ?? (saveError === null ? 'Template ready to save' : 'Could not save template')}
              </span>
              <button className="btn" type="button" disabled={submitting} onClick={requestClose}>Cancel</button>
              <button className="btn btn-primary" type="button" disabled={submitting || validationError !== null} onClick={() => void save()}>
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="modal-head prompt-modal-head">
              <h2>Replace your prompt?</h2>
              <button className="prompt-close" type="button" onClick={() => setPendingPreset(null)}>Back</button>
            </header>
            <div className="modal-body prompt-confirm-body">
              <p>Applying <strong>{pendingPreset.label}</strong> replaces your current text. This is also how you reset to a shipped template.</p>
              <div className="prompt-preset-preview">
                <strong>{pendingPreset.label} — preview</strong>
                <span>{pendingPreset.template}</span>
              </div>
              <p className="muted">Your current text will be discarded. Save after applying to make the change permanent.</p>
            </div>
            <footer className="modal-foot prompt-confirm-foot">
              <button className="btn" type="button" ref={keepTextRef} onClick={() => setPendingPreset(null)}>Keep my text</button>
              <button className="btn btn-primary" type="button" onClick={applyPreset}>Apply preset</button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
