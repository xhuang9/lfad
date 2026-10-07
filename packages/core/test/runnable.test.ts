import { describe, expect, it } from 'vitest'

import { isRunnableInBatch, type BatchRunnabilitySignals } from '../src/runnable.js'

/** A batch-runnable baseline: an agent step, normal automation, nothing held. */
const runnable: BatchRunnabilitySignals = {
  stepType: 'agent',
  lateral: false,
  liveRunning: false,
  automationLevel: 'normal',
  manualTasksPending: 0,
  openInputs: 0,
  dependencyHeld: false,
}

describe('isRunnableInBatch (core predicate)', () => {
  it('allows an agent step with normal automation and nothing held', () => {
    expect(isRunnableInBatch(runnable)).toBe(true)
    expect(isRunnableInBatch({ ...runnable, automationLevel: undefined })).toBe(true)
    expect(isRunnableInBatch({ ...runnable, automationLevel: 'express' })).toBe(true)
  })

  it('rejects an undefined (unknown) step', () => {
    expect(isRunnableInBatch({ ...runnable, stepType: undefined })).toBe(false)
  })

  it('rejects a lateral (blocked) step', () => {
    expect(isRunnableInBatch({ ...runnable, lateral: true })).toBe(false)
  })

  it.each([
    ['an agent step', {}],
    ['a resolved gate step', { stepType: 'gate' as const }],
  ])('rejects a live running claim on %s', (_label, overrides) => {
    const eligible = { ...runnable, ...overrides }

    expect(isRunnableInBatch({ ...eligible, liveRunning: false })).toBe(true)
    expect(isRunnableInBatch({ ...eligible, liveRunning: true })).toBe(false)
  })

  it('rejects a manual ticket', () => {
    expect(isRunnableInBatch({ ...runnable, automationLevel: 'manual' })).toBe(false)
  })

  it('rejects a ticket with a pending manual task', () => {
    expect(isRunnableInBatch({ ...runnable, manualTasksPending: 1 })).toBe(false)
  })

  it('rejects a dependency-held ticket', () => {
    expect(isRunnableInBatch({ ...runnable, dependencyHeld: true })).toBe(false)
  })

  it('allows a gate step only when it has no open inputs', () => {
    expect(isRunnableInBatch({ ...runnable, stepType: 'gate', openInputs: 0 })).toBe(true)
    expect(isRunnableInBatch({ ...runnable, stepType: 'gate', openInputs: 2 })).toBe(false)
  })

  it('rejects queue and terminal steps', () => {
    expect(isRunnableInBatch({ ...runnable, stepType: 'queue' })).toBe(false)
    expect(isRunnableInBatch({ ...runnable, stepType: 'terminal' })).toBe(false)
  })
})
