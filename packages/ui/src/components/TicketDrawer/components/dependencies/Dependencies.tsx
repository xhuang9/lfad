import { useState } from 'react'

import { updateDependencies } from '../../../../api'
import type { DependencyEdge, StepPayload, Ticket, TicketDetail } from '../../../../types'
import { DependencyModal } from './DependencyModal'
import { DependencyRow } from './DependencyRow'

interface DependenciesProps {
  detail: TicketDetail
  steps: StepPayload[]
  candidates: Ticket[]
  archivedCandidates: Ticket[]
  readOnly: boolean
  onSaved: (detail: TicketDetail) => void
}

export function Dependencies({ detail, steps, candidates, archivedCandidates, readOnly, onSaved }: DependenciesProps) {
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const edges = detail.dependencyState.edges
  const ticket = detail.ticket
  const modalOpen = adding || editing !== null

  const persist = async (dependencies: DependencyEdge[]): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const next = await updateDependencies(ticket.id, dependencies)
      onSaved(next)
      setAdding(false)
      setEditing(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const saveEdge = (edge: DependencyEdge): void => {
    const dependencies = edges.map(({ ticketId, blockAtStage, unblockWhen }) => ({ ticketId, blockAtStage, unblockWhen }))
    if (editing === null) dependencies.push(edge)
    else dependencies[editing] = edge
    void persist(dependencies)
  }

  const closeModal = (): void => {
    if (saving) return
    setAdding(false)
    setEditing(null)
    setError(null)
  }

  return (
    <main className="dependencies-panel" aria-labelledby="dependencies-title">
      <header className="dependencies-head">
        <div>
          <h2 id="dependencies-title">Dependencies</h2>
          <p>Hold this ticket at a chosen stage until prerequisite work reaches a stable milestone.</p>
        </div>
        <span className="dependency-count">{edges.length} {edges.length === 1 ? 'edge' : 'edges'}</span>
        {!readOnly ? (
          <button type="button" className="btn btn-accent" disabled={saving} onClick={() => setAdding(true)}>
            Add dependency
          </button>
        ) : null}
      </header>
      {detail.dependencyState.held ? (
        <p className="dependency-hold">
          Held at <strong>{detail.dependencyState.heldAt}</strong>. Resumes at <strong>{detail.dependencyState.resumesAt}</strong>.
        </p>
      ) : null}
      {edges.length === 0 ? (
        <p className="dependencies-empty">No dependency edges. This ticket can advance independently.</p>
      ) : null}
      {error !== null && !modalOpen ? <p className="dependency-error" role="alert">{error}</p> : null}
      <section className="dependency-list" aria-label="Dependency edges">
        {edges.map((edge, index) => (
          <DependencyRow
            key={`${edge.ticketId}-${index}`}
            edge={edge}
            readOnly={readOnly}
            disabled={saving}
            onEdit={() => setEditing(index)}
            onRemove={() => void persist(edges
              .filter((_, edgeIndex) => edgeIndex !== index)
              .map(({ ticketId, blockAtStage, unblockWhen }) => ({ ticketId, blockAtStage, unblockWhen })))}
          />
        ))}
      </section>
      {modalOpen ? (
        <DependencyModal
          key={editing === null ? 'add' : `edit-${editing}`}
          ticket={ticket}
          initial={editing === null ? undefined : edges[editing]}
          inferredBoundary={detail.inferredDependencyBoundary}
          steps={steps}
          candidates={candidates}
          archivedCandidates={archivedCandidates}
          saving={saving}
          error={error}
          onSave={saveEdge}
          onClose={closeModal}
        />
      ) : null}
    </main>
  )
}
