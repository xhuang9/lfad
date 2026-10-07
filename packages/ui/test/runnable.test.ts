/**
 * Unit tests for the pure batch-runnability predicate behind the top-bar
 * "Run (N)" count and the Next-all prompt (see App.tsx `nextAllIds`).
 */

import { describe, expect, it } from 'vitest'

import { isRunnableInBatch } from '../src/runnable'
import type { StepPayload, Ticket } from '../src/types'

/** Builds a minimal ticket for predicate-only assertions. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  const now = '2026-07-13T00:00:00.000Z'
  return {
    id: 1,
    slug: 'foo',
    title: 'Foo',
    status: 'doing',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'doing', at: now }],
    ...over,
  }
}

/** Builds a minimal step payload for predicate-only assertions. */
function makeStep(over: Partial<StepPayload> = {}): StepPayload {
  return {
    key: 'doing',
    label: 'Doing',
    folder: 'doing',
    lateral: false,
    type: 'agent',
    row: 'agents',
    position: 6,
    entry: false,
    ...over,
  }
}

describe('isRunnableInBatch', () => {
  it('includes a ticket on an agent step', () => {
    expect(isRunnableInBatch(makeTicket(), makeStep({ type: 'agent' }))).toBe(true)
  })

  it('includes a gate ticket only when it has no open questions', () => {
    const gate = makeStep({ type: 'gate' })
    expect(isRunnableInBatch(makeTicket({ openInputs: 0 }), gate)).toBe(true)
    expect(isRunnableInBatch(makeTicket(), gate)).toBe(true) // absent counts as 0
    expect(isRunnableInBatch(makeTicket({ openInputs: 2 }), gate)).toBe(false)
  })

  it('excludes queue and terminal steps', () => {
    expect(isRunnableInBatch(makeTicket(), makeStep({ type: 'queue' }))).toBe(false)
    expect(isRunnableInBatch(makeTicket(), makeStep({ type: 'terminal' }))).toBe(false)
  })

  it('excludes the lateral blocked lane and an unknown step', () => {
    expect(isRunnableInBatch(makeTicket(), makeStep({ lateral: true }))).toBe(false)
    expect(isRunnableInBatch(makeTicket(), undefined)).toBe(false)
  })

  it('excludes a ticket while the board projects a live running claim', () => {
    expect(isRunnableInBatch(makeTicket(), makeStep())).toBe(true)
    expect(isRunnableInBatch(makeTicket({
      running: { count: 1, since: '2026-07-13T00:00:00.000Z' },
    }), makeStep())).toBe(false)
  })

  it('excludes a Manual ticket everywhere a batch would otherwise pick it up', () => {
    const manual = makeTicket({ automationLevel: 'manual' })
    expect(isRunnableInBatch(manual, makeStep({ type: 'agent' }))).toBe(false)
    expect(isRunnableInBatch({ ...manual, openInputs: 0 }, makeStep({ type: 'gate' }))).toBe(false)
  })

  it('treats normal and express like an absent level', () => {
    expect(isRunnableInBatch(makeTicket({ automationLevel: 'normal' }), makeStep())).toBe(true)
    expect(isRunnableInBatch(makeTicket({ automationLevel: 'express' }), makeStep())).toBe(true)
  })

  it('excludes tickets with pending manual tasks until humans complete them', () => {
    expect(isRunnableInBatch(makeTicket({ manualTasks: { total: 2, pending: 1 } }), makeStep())).toBe(false)
    expect(isRunnableInBatch(makeTicket({ manualTasks: { total: 2, pending: 0 } }), makeStep())).toBe(true)
  })

  it('excludes tickets held at a dependency boundary', () => {
    expect(isRunnableInBatch(makeTicket({
      dependencyState: { edges: [], held: true, heldAt: 'todo', resumesAt: 'doing', blockingTicketIds: [50] },
    }), makeStep())).toBe(false)
  })
})
