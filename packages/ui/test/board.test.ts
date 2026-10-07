import { describe, expect, it } from 'vitest'

import { hintFor } from '../src/components/Board'
import type { StepPayload } from '../src/types'

function makeStep(over: Partial<StepPayload> = {}): StepPayload {
  return {
    key: 'todo',
    label: 'Todo',
    folder: 'todo',
    lateral: false,
    type: 'agent',
    row: 'agents',
    position: 5,
    entry: false,
    ...over,
  }
}

describe('hintFor', () => {
  it('returns a blocked hint for a lateral step', () => {
    expect(hintFor(makeStep({ key: 'blocked', label: 'Blocked', folder: 'blocked', lateral: true, type: 'gate', row: 'needs-you' }))).toEqual({
      label: 'Blocked',
      tone: 'blocked',
    })
  })

  it.each([
    ['final gate', { key: 'review', label: 'Review', folder: 'review', type: 'gate', row: 'needs-you' }],
    ['intermediate gate', { key: 'interview', label: 'Interview', folder: 'interview', type: 'gate', row: 'needs-you' }],
    ['agent step', {}],
  ] satisfies Array<[string, Partial<StepPayload>]>)('returns no hint for a non-lateral %s', (_label, over) => {
    expect(hintFor(makeStep(over))).toBeNull()
  })
})
