import type { ReactNode } from 'react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { getManual, getCommandPrefixSnapshot, getSkillPrefixSnapshot, subscribeCommandPrefix, subscribeSkillPrefix } from '../api'
import { resolveSkillKey } from '../commands'
import type { StepPayload, Ticket } from '../types'
import { SkillModal } from './SkillModal'

interface DashboardProps {
  tickets: Ticket[]
  steps: StepPayload[]
  onOpen: (id: number) => void
  /** Opens a ticket's drawer directly in input mode (`/t/:id/input`). */
  onOpenInput: (id: number) => void
}

interface NeedsListProps {
  title: string
  tone: 'warn' | 'danger'
  items: Ticket[]
  empty: string
  onOpen: (id: number) => void
  /** Extra per-row badge (e.g. the `? n` open-question count). */
  meta?: (t: Ticket) => ReactNode
}

function NeedsList({ title, tone, items, empty, onOpen, meta }: NeedsListProps) {
  return (
    <section className={`needs-card needs-${tone}`}>
      <h2 className="needs-title">
        {title} <span className="needs-count">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="needs-list">
          {items.map((t) => (
            <li key={t.id}>
              <button className="needs-row" onClick={() => onOpen(t.id)}>
                <span className="needs-id">#{t.id}</span>
                <span className="needs-row-title">{t.title}</span>
                {meta?.(t)}
                <span className="needs-cat">{t.category}</span>
                <span className="needs-open" aria-hidden="true">
                  open ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function Dashboard({ tickets, steps, onOpen, onOpenInput }: DashboardProps) {
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const skillPrefix = useSyncExternalStore(subscribeSkillPrefix, getSkillPrefixSnapshot)
  // Skill summaries (for the pipeline's Description column), keyed by the value
  // that matches each step's `skill` binding. Loaded once from the daemon.
  const [skillSummary, setSkillSummary] = useState<Map<string, string>>(new Map())
  const [openSkill, setOpenSkill] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getManual()
      .then((m) => { if (live) setSkillSummary(new Map(m.skills.map((s) => [s.key, s.summary]))) })
      .catch(() => { /* descriptions stay blank if the manual can't load */ })
    return () => { live = false }
  }, [])

  // The pipeline, in board order (the lateral `blocked` lane is surfaced below).
  const pipeline = useMemo(() => steps.filter((s) => !s.lateral), [steps])
  const countAt = (key: string) => tickets.filter((t) => t.status === key).length

  // Human gates that wait on the operator drive the "Needs you · Review" list;
  // the lateral (blocked) lane is surfaced separately below, so it's excluded
  // here by its metadata flag rather than by name.
  const review = useMemo(
    () => tickets.filter((t) => steps.some((s) => s.key === t.status && s.type === 'gate' && s.row === 'needs-you' && !s.lateral)),
    [tickets, steps],
  )
  const blocked = useMemo(
    () => tickets.filter((t) => steps.some((s) => s.key === t.status && s.lateral)),
    [tickets, steps],
  )
  const questionTickets = useMemo(() => tickets.filter((t) => (t.openInputs ?? 0) > 0), [tickets])

  return (
    <div className="dashboard">
      <div className="pipeline" role="table" aria-label="Pipeline stages">
        {pipeline.map((s, i) => {
          const count = countAt(s.key)
          const skill = s.skill === undefined ? undefined : resolveSkillKey(s.skill, skillPrefix)
          const mode = s.row === 'needs-you' ? 'Manual' : 'Automate'
          return (
            <div key={s.key} className="pipe-row" role="row">
              <span className="pipe-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="pipe-name">{s.label}</span>
              <span className="pipe-desc">{skill !== undefined ? (skillSummary.get(skill) ?? '') : ''}</span>
              <span className="pipe-skills">
                {skill !== undefined ? (
                  <button className="pipe-skill" onClick={() => setOpenSkill(skill)} title={`Open ${commandPrefix}${skill}`}>
                    {commandPrefix}{skill}
                  </button>
                ) : (
                  <span className="pipe-skill-none">—</span>
                )}
              </span>
              <span className={`pipe-mode pipe-mode-${mode.toLowerCase()}`}>{mode}</span>
              <span className="pipe-count" title={`${count} ticket${count === 1 ? '' : 's'} here`}>
                {count > 0 ? count : ''}
              </span>
            </div>
          )
        })}
      </div>

      <div className="needs">
        <NeedsList
          title="Needs you · Open questions"
          tone="warn"
          items={questionTickets}
          empty="No open questions — nothing waiting on your input."
          onOpen={onOpenInput}
          meta={(t) => <span className="hint hint-question">? {t.openInputs ?? 0}</span>}
        />
        <NeedsList
          title="Needs you · Review"
          tone="warn"
          items={review}
          empty="No tickets waiting on your review."
          onOpen={onOpen}
        />
        <NeedsList
          title="Needs you · Blocked"
          tone="danger"
          items={blocked}
          empty="Nothing blocked — agents are unblocked."
          onOpen={onOpen}
        />
      </div>

      {openSkill !== null && <SkillModal skillKey={openSkill} onClose={() => setOpenSkill(null)} />}
    </div>
  )
}
