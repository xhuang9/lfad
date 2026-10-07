// Renders a skill's SKILL.md body in a modal — opened from the Dashboard's
// pipeline table when the operator clicks a skill. The daemon serves the raw
// markdown (plugin or the board's project-local `.claude/skills`) at
// GET /api/skills?key=…; we render it with the same markdown pipeline as docs.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { getSkillBody, getCommandPrefixSnapshot, subscribeCommandPrefix } from '../api'
import { renderMarkdown } from '../markdown'
import { useFocusTrap } from '../useFocusTrap'
import { useMdPathCopy } from '../useMdPathCopy'

interface SkillModalProps {
  /** The skill key — `flow:idea` (plugin) or `flow-add-test` (project-local). */
  skillKey: string
  onClose: () => void
}

export function SkillModal({ skillKey, onClose }: SkillModalProps) {
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusTrap(panelRef)

  useEffect(() => {
    let live = true
    setBody(null)
    setError(null)
    getSkillBody(skillKey)
      .then((r) => { if (live) setBody(r.body) })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load skill') })
    return () => { live = false }
  }, [skillKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useMdPathCopy(bodyRef, body)

  const html = body === null ? '' : renderMarkdown(body).html

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal skill-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Skill ${skillKey}`}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <code className="skill-modal-key">{commandPrefix}{skillKey}</code>
          <button className="drawer-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body skill-modal-body" ref={bodyRef}>
          {error !== null ? (
            <p className="drawer-error">{error}</p>
          ) : body === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  )
}
