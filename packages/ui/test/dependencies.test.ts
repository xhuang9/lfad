import { describe, expect, it } from 'vitest'

import { dependencyBadge, isDependencyHeld } from '../src/dependencies'
import type { Ticket } from '../src/types'

function ticket(blockingTicketIds: number[], held = blockingTicketIds.length > 0): Ticket {
  const now = '2026-07-14T00:00:00.000Z'
  return {
    id: 37,
    slug: 'dependent',
    title: 'Dependent',
    status: 'design',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'design', at: now }],
    dependencyState: { edges: [], held, blockingTicketIds },
  }
}

describe('dependency card helpers', () => {
  it('shows one active blocker compactly', () => {
    expect(isDependencyHeld(ticket([50]))).toBe(true)
    expect(dependencyBadge(ticket([50]))).toBe('blocked by #50')
  })

  it('folds additional blockers and hides satisfied edges', () => {
    expect(dependencyBadge(ticket([50, 61, 72]))).toBe('blocked by #50 +2')
    expect(isDependencyHeld(ticket([], false))).toBe(false)
    expect(dependencyBadge(ticket([], false))).toBeNull()
  })
})
