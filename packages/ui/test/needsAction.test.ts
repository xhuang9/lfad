/**
 * Unit tests for the pure predicates behind the top-bar "Needs action" button.
 * `isNeedsActionOrHeld` is the union seam the count memo and board filter share
 * (see App.tsx): a ticket needs human attention when it is waiting for input OR
 * held at a dependency boundary.
 */

import { describe, expect, it } from 'vitest'

import { isNeedsActionOrHeld } from '../src/needsAction'
import type { StepPayload, Ticket } from '../src/types'

/** Builds a minimal ticket for predicate-only assertions. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  const now = '2026-07-19T00:00:00.000Z'
  return {
    id: 1,
    slug: 'foo',
    title: 'Foo',
    status: 'interview',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'interview', at: now }],
    ...over,
  }
}

/** Builds a minimal step payload for predicate-only assertions. */
function makeStep(over: Partial<StepPayload> = {}): StepPayload {
  return {
    key: 'interview',
    label: 'Interview',
    folder: 'interview',
    lateral: false,
    type: 'gate',
    row: 'needs-you',
    position: 3,
    entry: false,
    ...over,
  }
}

describe('isNeedsActionOrHeld', () => {
  it('is true for a needs-action ticket (gate with open inputs)', () => {
    expect(isNeedsActionOrHeld(makeTicket({ openInputs: 2 }), makeStep({ type: 'gate' }))).toBe(true)
  })

  it('is true for a needs-action ticket on the lateral blocked lane', () => {
    expect(isNeedsActionOrHeld(makeTicket(), makeStep({ lateral: true }))).toBe(true)
  })

  it('is true for a dependency-held ticket even on an agent step with no open inputs', () => {
    const held = makeTicket({
      status: 'doing',
      openInputs: 0,
      dependencyState: { edges: [], held: true, blockingTicketIds: [50] },
    })
    expect(isNeedsActionOrHeld(held, makeStep({ type: 'agent' }))).toBe(true)
  })

  it('is false when the ticket is neither waiting for input nor held', () => {
    const plain = makeTicket({ status: 'doing', openInputs: 0 })
    expect(isNeedsActionOrHeld(plain, makeStep({ type: 'agent' }))).toBe(false)
  })

  it('dedupes a ticket that satisfies both predicates so the union count never double-counts', () => {
    // A gate ticket with open inputs that is ALSO dependency-held — both
    // predicates fire, but a single ticket must contribute one entry to the
    // union count (App.tsx dedupes by ticket id).
    const both = makeTicket({
      openInputs: 1,
      dependencyState: { edges: [], held: true, blockingTicketIds: [7] },
    })
    const step = makeStep({ type: 'gate' })
    const matches = [both].filter((t) => isNeedsActionOrHeld(t, step))
    expect(new Set(matches.map((t) => t.id)).size).toBe(1)
  })
})
