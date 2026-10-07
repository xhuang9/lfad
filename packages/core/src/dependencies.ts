/**
 * Pure dependency graph and boundary evaluation. Persistence stays in the
 * normal ticket frontmatter path; runtime and UI projections share this one
 * interpretation of edges, milestones, invalid references, and holds.
 */

import { nextStep, type BoardConfig } from './config.js'
import { PARKED_DIR } from './steps.js'
import type {
  DependencyEdge,
  DependencyEvaluation,
  DependencyMilestone,
  EvaluatedDependency,
  Step,
  Ticket,
} from './types.js'

function stepIndex(config: BoardConfig, step: Step): number {
  return config.steps.findIndex((candidate) => candidate.key === step)
}

function hasReachedStep(ticket: Ticket, key: Step, config: BoardConfig): boolean {
  const milestoneIndex = stepIndex(config, key)
  if (milestoneIndex < 0) return false
  return ticket.history.some((entry) => stepIndex(config, entry.step) >= milestoneIndex)
}

function milestoneStep(milestone: Exclude<DependencyMilestone, 'archived'>, config: BoardConfig): Step | undefined {
  if (milestone === 'done') {
    return config.steps.find((step) => step.key === 'done')?.key
      ?? config.steps.find((step) => step.type === 'terminal')?.key
  }
  // The skill binding carries the semantic meaning across a step rename. On
  // older/custom boards without bindings, the last design-named step is the
  // approval boundary (for example design-review after a design work step).
  return config.steps.find((step) => step.skill?.split(':').at(-1) === 'design')?.key
    ?? config.steps.filter((step) => /^design(?:-|$)/i.test(step.key)).at(-1)?.key
}

function milestoneState(
  prerequisite: Ticket,
  archived: boolean,
  milestone: DependencyMilestone,
  config: BoardConfig,
): { satisfied: boolean, invalidReason?: string } {
  if (archived) return { satisfied: true }
  if (prerequisite.status === PARKED_DIR) return { satisfied: false }
  if (milestone === 'archived') return { satisfied: false }
  const key = milestoneStep(milestone, config)
  if (key === undefined) return { satisfied: false, invalidReason: `pipeline has no '${milestone}' milestone` }
  const milestoneIndex = stepIndex(config, key)
  if (milestone === 'design-approved') {
    // Ticket metadata does not duplicate gate answers. Progress beyond design
    // is the durable pipeline signal that its approval gate was cleared.
    return {
      satisfied: prerequisite.history.some((entry) => stepIndex(config, entry.step) > milestoneIndex),
    }
  }
  return { satisfied: hasReachedStep(prerequisite, key, config) }
}

function crossesBoundary(ticket: Ticket, targetStep: Step, boundary: Step, config: BoardConfig): boolean {
  const currentIndex = stepIndex(config, ticket.status)
  const targetIndex = stepIndex(config, targetStep)
  const boundaryIndex = stepIndex(config, boundary)
  if (currentIndex < 0 || targetIndex < 0 || targetIndex <= currentIndex) return false
  // A removed/renamed boundary cannot be located safely in the pipeline. Keep
  // every forward move held until the edge is repaired instead of silently
  // allowing a now-ambiguous dependency to pass.
  if (boundaryIndex < 0) return true
  return currentIndex < boundaryIndex && targetIndex >= boundaryIndex
}

function evaluate(
  ticket: Ticket,
  targetStep: Step | undefined,
  liveTickets: readonly Ticket[],
  archivedTickets: readonly Ticket[],
  config: BoardConfig,
): DependencyEvaluation {
  const liveById = new Map(liveTickets.map((candidate) => [candidate.id, candidate]))
  const archivedById = new Map(archivedTickets.map((candidate) => [candidate.id, candidate]))
  const blockingTicketIds: number[] = []
  const blockingBoundaries: Step[] = []

  const edges: EvaluatedDependency[] = (ticket.dependencies ?? []).map((edge) => {
    const live = liveById.get(edge.ticketId)
    const archived = archivedById.get(edge.ticketId)
    const prerequisite = live ?? archived
    const base = {
      ...edge,
      ...(prerequisite !== undefined ? {
        prerequisite: {
          id: prerequisite.id,
          title: prerequisite.title,
          status: prerequisite.status,
          archived: archived !== undefined,
        },
      } : {}),
    }

    let evaluated: EvaluatedDependency
    if (edge.ticketId === ticket.id) {
      evaluated = { ...base, state: 'invalid', reason: 'a ticket cannot depend on itself' }
    } else if (stepIndex(config, edge.blockAtStage) < 0) {
      evaluated = { ...base, state: 'invalid', reason: `unknown blockAtStage '${edge.blockAtStage}'` }
    } else if (prerequisite === undefined) {
      evaluated = { ...base, state: 'invalid', reason: `ticket #${edge.ticketId} was not found` }
    } else {
      const result = milestoneState(prerequisite, archived !== undefined, edge.unblockWhen, config)
      evaluated = result.invalidReason !== undefined
        ? { ...base, state: 'invalid', reason: result.invalidReason }
        : { ...base, state: result.satisfied ? 'satisfied' : 'unmet' }
    }

    if (
      targetStep !== undefined
      && evaluated.state !== 'satisfied'
      && crossesBoundary(ticket, targetStep, edge.blockAtStage, config)
    ) {
      blockingTicketIds.push(edge.ticketId)
      blockingBoundaries.push(edge.blockAtStage)
    }
    return evaluated
  })

  const resumesAt = [...blockingBoundaries].sort((a, b) => stepIndex(config, a) - stepIndex(config, b))[0]
  return {
    edges,
    held: blockingTicketIds.length > 0,
    ...(blockingTicketIds.length > 0 ? { heldAt: ticket.status, resumesAt } : {}),
    blockingTicketIds,
  }
}

/** Evaluates all edges against the ticket's next applicable pipeline step. */
export function evaluateDependencies(
  ticket: Ticket,
  liveTickets: readonly Ticket[],
  archivedTickets: readonly Ticket[],
  config: BoardConfig,
): DependencyEvaluation {
  return evaluate(ticket, nextStep(config, ticket.status, ticket), liveTickets, archivedTickets, config)
}

/** Evaluates whether a specific move would cross an unsatisfied boundary. */
export function dependencyHoldForMove(
  ticket: Ticket,
  targetStep: Step,
  liveTickets: readonly Ticket[],
  archivedTickets: readonly Ticket[],
  config: BoardConfig,
): DependencyEvaluation {
  return evaluate(ticket, targetStep, liveTickets, archivedTickets, config)
}

/**
 * Default authoring boundary. Prefer the conventional doing/build step when it
 * is still ahead; otherwise choose the next applicable agent step.
 */
export function inferDependencyBoundary(ticket: Ticket, config: BoardConfig): Step {
  const currentIndex = stepIndex(config, ticket.status)
  const conventional = config.steps.find((step, index) =>
    index > currentIndex && step.type === 'agent' && /^(doing|build)$/i.test(step.key),
  )
  if (conventional !== undefined) return conventional.key

  const flags = ticket as unknown as Record<string, unknown>
  const nextAgent = config.steps.find((step, index) => {
    if (index <= currentIndex || step.type !== 'agent') return false
    if (step.skipUnless === undefined) return true
    return Boolean(flags[step.skipUnless] ?? ticket.extras?.[step.skipUnless])
  })
  return nextAgent?.key ?? nextStep(config, ticket.status, ticket) ?? ticket.status
}

/** Returns the first reachable dependency cycle, including the repeated id. */
export function dependencyCyclePath(
  ticketId: number,
  dependencies: readonly DependencyEdge[],
  tickets: readonly Ticket[],
): number[] | null {
  const graph = new Map(tickets.map((ticket) => [
    ticket.id,
    (ticket.id === ticketId ? dependencies : ticket.dependencies ?? []).map((edge) => edge.ticketId),
  ]))
  graph.set(ticketId, dependencies.map((edge) => edge.ticketId))

  const visiting: number[] = []
  const visited = new Set<number>()
  const visit = (id: number): number[] | null => {
    const cycleStart = visiting.indexOf(id)
    if (cycleStart >= 0) return [...visiting.slice(cycleStart), id]
    if (visited.has(id)) return null
    visiting.push(id)
    for (const next of graph.get(id) ?? []) {
      const cycle = visit(next)
      if (cycle !== null) return cycle
    }
    visiting.pop()
    visited.add(id)
    return null
  }

  return visit(ticketId)
}
