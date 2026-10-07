import { useEffect, useRef, useState } from 'react'

import { getManual } from '../api'
import { DEFAULT_SKILL_PREFIX } from '../commands'
import type { Manual, ManualSkill } from '../types'
import { useFocusTrap } from '../useFocusTrap'

interface ManualModalProps {
  onClose: () => void
}

export function groupManualSkills(skills: ManualSkill[], skillPrefix = DEFAULT_SKILL_PREFIX): {
  dashboard: ManualSkill[]
  project: ManualSkill[]
} {
  return {
    dashboard: skills.filter((skill) => skill.key.startsWith(`${skillPrefix}:`)),
    project: skills.filter((skill) => !skill.key.startsWith(`${skillPrefix}:`)),
  }
}

/** A help modal listing the `flow` plugin skills (read live from the daemon) and
 *  the board's actions. Opened from the sidebar "FAQ" button. */
export function ManualModal({ onClose }: ManualModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [manual, setManual] = useState<Manual | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFocusTrap(panelRef)

  useEffect(() => {
    let cancelled = false
    getManual()
      .then((m) => {
        if (!cancelled) setManual(m)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groupedSkills = groupManualSkills(manual?.skills ?? [], manual?.skillPrefix)
  const skillSections = [
    { key: 'dashboard', label: 'Dashboard skills', skills: groupedSkills.dashboard },
    { key: 'project', label: 'Project-local skills', skills: groupedSkills.project },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal manual-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Agent dashboard FAQ"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>FAQ</h2>
          <button className="drawer-close" onClick={onClose} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body manual-body">
          {error && <p className="drawer-error">{error}</p>}

          {manual?.guidance !== undefined && manual.guidance.trim().length > 0 && (
            <p className="manual-guidance">
              <span className="manual-guidance-label">Board guidance</span>
              {manual.guidance}
            </p>
          )}

          {manual === null && !error && <p className="muted">Loading…</p>}
          {manual?.skills.length === 0 && <p className="muted">No skills found.</p>}
          {manual !== null && manual.skills.length > 0 && skillSections.map((section) => (
            <section key={section.key} className="manual-section">
              <p className="manual-head">
                <span>{section.label}</span>
                <span className="manual-count">{section.skills.length}</span>
                <span className="manual-hint">— run in Claude Code · click to expand</span>
              </p>
              {section.skills.map((s) => (
                <details key={s.command} className="manual-skill">
                  <summary className="manual-skill-row">
                    <code className="manual-cmd">{s.command}</code>
                    <span className="manual-summary">{s.summary}</span>
                  </summary>
                  <p className="manual-detail">{s.description}</p>
                </details>
              ))}
            </section>
          ))}

          <section className="manual-section">
            <p className="manual-head">On the board</p>
            <ul className="manual-actions">
              {manual?.actions.map((a) => (
                <li key={a.label}>
                  <strong>{a.label}</strong> — {a.detail}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
