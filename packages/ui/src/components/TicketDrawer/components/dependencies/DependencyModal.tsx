import { useState } from 'react'

import type { DependencyEdge, DependencyMilestone, StepPayload, Ticket } from '../../../../types'
import { CandidatePicker } from './CandidatePicker'

interface DependencyModalProps {
  ticket: Ticket
  initial?: DependencyEdge
  inferredBoundary: string
  steps: StepPayload[]
  candidates: Ticket[]
  archivedCandidates: Ticket[]
  saving: boolean
  error: string | null
  onSave: (edge: DependencyEdge) => void
  onClose: () => void
}

const MILESTONES: { value: DependencyMilestone, label: string, hint: string }[] = [
  { value: 'design-approved', label: 'Design approved', hint: 'Design gate passed' },
  { value: 'done', label: 'Done', hint: 'Default' },
  { value: 'archived', label: 'Archived', hint: 'Reached _archive' },
]

export function DependencyModal({ ticket, initial, inferredBoundary, steps, candidates, archivedCandidates, saving, error, onSave, onClose }: DependencyModalProps) {
  const [ticketId, setTicketId] = useState<number | null>(initial?.ticketId ?? null)
  const [blockAtStage, setBlockAtStage] = useState(initial?.blockAtStage ?? inferredBoundary)
  const [unblockWhen, setUnblockWhen] = useState<DependencyMilestone>(initial?.unblockWhen ?? 'done')
  const boundarySteps = steps.filter((step) => !step.lateral)

  return (
    <div className="dependency-modal-backdrop" onClick={onClose}>
      <section
        className="dependency-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${initial ? 'Edit' : 'Add'} dependency`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{initial ? 'Edit' : 'Add'} dependency</h2>
          <p>Ticket #{ticket.id} — {ticket.title}</p>
        </header>
        <div className="dependency-modal-body">
          <div className="dependency-field">
            <span>Prerequisite ticket <small>The ticket that blocks #{ticket.id}</small></span>
            <CandidatePicker
              ticketId={ticket.id}
              selectedId={ticketId}
              candidates={candidates}
              archivedCandidates={archivedCandidates}
              onSelect={setTicketId}
            />
          </div>
          <label className="dependency-field">
            <span>Block at stage <small>Agent inferred, editable</small></span>
            <div className="dependency-inferred">Inferred boundary: <strong>{inferredBoundary}</strong></div>
            <select value={blockAtStage} onChange={(event) => setBlockAtStage(event.target.value)}>
              {boundarySteps.map((step) => <option key={step.key} value={step.key}>{step.label}</option>)}
            </select>
          </label>
          <fieldset className="dependency-field dependency-milestones">
            <legend>Unblock when <small>Stable milestone on the prerequisite</small></legend>
            {MILESTONES.map((milestone) => (
              <label key={milestone.value} className={unblockWhen === milestone.value ? 'selected' : ''}>
                <input
                  type="radio"
                  name="unblockWhen"
                  value={milestone.value}
                  checked={unblockWhen === milestone.value}
                  onChange={() => setUnblockWhen(milestone.value)}
                />
                <span>{milestone.label}</span><small>{milestone.hint}</small>
              </label>
            ))}
          </fieldset>
          <p className="dependency-preview">
            <strong>Preview:</strong> #{ticket.id} advances freely until <b>{blockAtStage}</b>, then holds
            {ticketId === null ? '' : ` — blocked by #${ticketId}`} — until the prerequisite reaches <b>{unblockWhen}</b>,
            then resumes at <b>{blockAtStage}</b> without re-running completed stages.
          </p>
          {error ? <p className="dependency-error" role="alert">{error}</p> : null}
        </div>
        <footer>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || ticketId === null}
            onClick={() => ticketId !== null && onSave({ ticketId, blockAtStage, unblockWhen })}
          >
            {saving ? 'Saving…' : initial ? 'Save dependency' : 'Add dependency'}
          </button>
          <button type="button" className="btn" disabled={saving} onClick={onClose}>Cancel</button>
        </footer>
      </section>
    </div>
  )
}
