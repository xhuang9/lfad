import type { EvaluatedDependency } from '../../../../types'

interface DependencyRowProps {
  edge: EvaluatedDependency
  readOnly: boolean
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}

export function DependencyRow({ edge, readOnly, disabled, onEdit, onRemove }: DependencyRowProps) {
  const prerequisite = edge.prerequisite
  const title = prerequisite?.title ?? `Ticket #${edge.ticketId} — not found`
  const stateLabel = edge.state === 'satisfied' ? 'Satisfied' : edge.state === 'unmet' ? 'Unmet' : 'Invalid'

  return (
    <article className={`dependency-edge dependency-edge-${edge.state}`}>
      <div className="dependency-edge-top">
        {prerequisite ? (
          <a href={`/t/${edge.ticketId}`} className="dependency-prerequisite">
            {title} <span>#{edge.ticketId}</span>
            {prerequisite.archived ? <em>archived</em> : null}
          </a>
        ) : (
          <span className="dependency-prerequisite">{title}</span>
        )}
        <span className={`dependency-state dependency-state-${edge.state}`}>{stateLabel}</span>
      </div>
      <dl className="dependency-meta">
        <dt>Prerequisite</dt>
        <dd>{prerequisite ? `#${edge.ticketId} is at ${prerequisite.archived ? '_archive' : prerequisite.status}` : edge.reason}</dd>
        <dt>Block at</dt>
        <dd>{edge.blockAtStage}</dd>
        <dt>Unblock when</dt>
        <dd>{edge.unblockWhen}</dd>
      </dl>
      {!readOnly ? (
        <div className="dependency-actions">
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={onEdit}>
            {edge.state === 'invalid' ? 'Fix reference' : 'Edit'}
          </button>
          <button type="button" className="btn btn-sm" disabled={disabled} onClick={onRemove}>Remove</button>
        </div>
      ) : null}
    </article>
  )
}
