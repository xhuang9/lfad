import { describe, expect, it } from 'vitest'

import {
  dependencyCyclePath,
  dependencyHoldForMove,
  evaluateDependencies,
  inferDependencyBoundary,
  validateTicket,
  type DependencyEdge,
  type Ticket,
} from '../src/index.js'
import { parseTicketFile, serializeTicketFile } from '../src/frontmatter.js'
import { makeTestConfig } from './helpers.js'

const NOW = '2026-07-14T00:00:00.000Z'

function ticket(id: number, status: string, dependencies?: DependencyEdge[]): Ticket {
  return {
    id,
    slug: `ticket-${id}`,
    title: `Ticket ${id}`,
    status,
    category: 'logic',
    tags: [],
    ...(dependencies !== undefined ? { dependencies } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    history: [{ step: status, at: NOW }],
  }
}

describe('dependency frontmatter', () => {
  it('normalizes legacy dependsOn ids and writes only canonical edges', () => {
    const raw = `---
id: 37
slug: legacy
title: Legacy
status: design
category: logic
tags: []
dependsOn: [50]
createdAt: '${NOW}'
updatedAt: '${NOW}'
history:
  - step: design
    at: '${NOW}'
---
Legacy body.
`
    const parsed = parseTicketFile(raw)
    expect(parsed.data.dependencies).toEqual([
      { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'done' },
    ])

    const canonical = serializeTicketFile(parsed.data, parsed.body)
    expect(canonical).toContain('dependencies:')
    expect(canonical).not.toContain('dependsOn:')
  })

  it('keeps a removed boundary loadable so it can be reported as invalid', () => {
    const config = makeTestConfig()
    const current = ticket(37, 'todo', [
      { ticketId: 50, blockAtStage: 'removed-step', unblockWhen: 'done' },
    ])
    expect(validateTicket(config, current)).toEqual([])
    expect(evaluateDependencies(current, [current], [], config).edges[0]).toMatchObject({
      state: 'invalid',
      reason: "unknown blockAtStage 'removed-step'",
    })
    expect(evaluateDependencies(current, [current], [], config)).toMatchObject({
      held: true,
      resumesAt: 'removed-step',
      blockingTicketIds: [50],
    })
    expect(dependencyHoldForMove(current, 'plan', [current], [], config).held).toBe(false)
  })
})

describe('dependency evaluation', () => {
  it('holds only when a move crosses the unresolved boundary and resumes there', () => {
    const config = makeTestConfig()
    const edge: DependencyEdge = { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'done' }
    const dependent = ticket(37, 'plan', [edge])
    const prerequisite = ticket(50, 'doing')

    expect(dependencyHoldForMove(dependent, 'design-review', [dependent, prerequisite], [], config).held).toBe(false)
    expect(dependencyHoldForMove(dependent, 'review', [dependent, prerequisite], [], config)).toMatchObject({
      held: true,
      heldAt: 'plan',
      resumesAt: 'doing',
      blockingTicketIds: [50],
    })
  })

  it('releases done milestones after the prerequisite reaches done', () => {
    const config = makeTestConfig()
    const dependent = ticket(37, 'todo', [
      { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    const prerequisite = ticket(50, 'done')

    expect(evaluateDependencies(dependent, [dependent, prerequisite], [], config)).toMatchObject({
      held: false,
      blockingTicketIds: [],
      edges: [{ state: 'satisfied' }],
    })
  })

  it('evaluates every stable milestone, including archived prerequisites', () => {
    const config = makeTestConfig()
    const dependent = ticket(37, 'todo', [
      { ticketId: 48, blockAtStage: 'doing', unblockWhen: 'design-approved' },
      { ticketId: 49, blockAtStage: 'doing', unblockWhen: 'done' },
      { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'archived' },
    ])
    const designApproved = ticket(48, 'todo')
    const done = ticket(49, 'done')
    const archived = ticket(50, 'done')

    expect(evaluateDependencies(dependent, [dependent, designApproved, done], [archived], config)).toMatchObject({
      held: false,
      edges: [
        { ticketId: 48, state: 'satisfied' },
        { ticketId: 49, state: 'satisfied' },
        { ticketId: 50, state: 'satisfied', prerequisite: { archived: true } },
      ],
    })
  })

  it.each(['lfad', 'flow', 'custom:nested'])('follows %s:design across step renames and requires approval', (prefix) => {
    const config = makeTestConfig()
    const dependent = ticket(37, 'todo', [
      { ticketId: 48, blockAtStage: 'doing', unblockWhen: 'design-approved' },
    ])
    const awaitingApproval = ticket(48, 'design-review')
    expect(evaluateDependencies(dependent, [dependent, awaitingApproval], [], config)).toMatchObject({
      held: true,
      edges: [{ state: 'unmet' }],
    })

    const renamedConfig = {
      ...config,
      steps: config.steps.map((step) => step.key === 'design-review'
        ? { ...step, key: 'visual-approval', skill: `${prefix}:design` }
        : step),
    }
    const awaitingRenamedApproval = ticket(48, 'visual-approval')
    expect(evaluateDependencies(dependent, [dependent, awaitingRenamedApproval], [], renamedConfig)).toMatchObject({
      held: true,
      edges: [{ state: 'unmet' }],
    })
    const approved = ticket(48, 'todo')
    expect(evaluateDependencies(dependent, [dependent, approved], [], renamedConfig)).toMatchObject({
      held: false,
      edges: [{ state: 'satisfied' }],
    })
  })

  it('evaluates independent boundaries without holding earlier work', () => {
    const config = makeTestConfig()
    const dependent = ticket(37, 'plan', [
      { ticketId: 50, blockAtStage: 'design', unblockWhen: 'done' },
      { ticketId: 51, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    const prerequisites = [ticket(50, 'doing'), ticket(51, 'doing')]

    expect(dependencyHoldForMove(dependent, 'shape', [dependent, ...prerequisites], [], config).held).toBe(false)
    expect(dependencyHoldForMove(dependent, 'design-review', [dependent, ...prerequisites], [], config)).toMatchObject({
      held: true,
      resumesAt: 'design',
      blockingTicketIds: [50],
    })
    expect(dependencyHoldForMove(dependent, 'doing', [dependent, ...prerequisites], [], config)).toMatchObject({
      held: true,
      resumesAt: 'design',
      blockingTicketIds: [50, 51],
    })
  })

  it('treats archived prerequisites as satisfied and missing ids as invalid blockers', () => {
    const config = makeTestConfig()
    const archivedDependent = ticket(37, 'todo', [
      { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'archived' },
    ])
    const archived = ticket(50, 'done')
    const archivedState = evaluateDependencies(archivedDependent, [archivedDependent], [archived], config)
    expect(archivedState.edges[0]).toMatchObject({
      state: 'satisfied',
      prerequisite: { id: 50, archived: true },
    })

    const missingDependent = ticket(45, 'todo', [
      { ticketId: 999, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    expect(evaluateDependencies(missingDependent, [missingDependent], [], config)).toMatchObject({
      held: true,
      blockingTicketIds: [999],
      edges: [{ state: 'invalid' }],
    })
  })

  it('keeps a parked prerequisite unmet even when its history reached done', () => {
    const config = makeTestConfig()
    const dependent = ticket(37, 'todo', [
      { ticketId: 50, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    const parked = ticket(50, 'parked')
    parked.returnStep = 'done'
    parked.history = [
      { step: 'done', at: NOW },
      { step: 'parked', at: NOW },
    ]
    expect(evaluateDependencies(dependent, [dependent, parked], [], config)).toMatchObject({
      held: true,
      edges: [{ state: 'unmet', prerequisite: { status: 'parked', archived: false } }],
    })
  })

  it('infers the conventional build boundary and returns a concrete cycle path', () => {
    const config = makeTestConfig()
    const first = ticket(1, 'design-review')
    const second = ticket(2, 'todo', [
      { ticketId: 1, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    const proposed = [{ ticketId: 2, blockAtStage: 'doing', unblockWhen: 'done' }] satisfies DependencyEdge[]

    expect(inferDependencyBoundary(first, config)).toBe('doing')
    expect(dependencyCyclePath(first.id, proposed, [first, second])).toEqual([1, 2, 1])
    expect(dependencyCyclePath(first.id, [{ ...proposed[0]!, ticketId: 1 }], [first])).toEqual([1, 1])
  })
})
