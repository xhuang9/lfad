import { describe, expect, it } from 'vitest'

import { deriveNextActionLabel } from '../src/nextActionLabel'
import type { Ticket } from '../src/types'

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  const now = '2026-07-15T00:00:00.000Z'
  return {
    id: 71,
    slug: 'interview-clarity',
    title: 'Interview clarity',
    status: 'interview',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'interview', at: now }],
    ...over,
  }
}

describe('deriveNextActionLabel', () => {
  it('shows live clarity for an interview below the threshold', () => {
    expect(deriveNextActionLabel(makeTicket({ extras: { clarityPercent: 72 } }), 'Todo')).toBe('Continue Interview 72%')
  })

  it('keeps the next-step label when interview clarity meets the threshold', () => {
    expect(deriveNextActionLabel(makeTicket({ extras: { clarityPercent: 80 } }), 'Todo')).toBe('Todo →')
  })

  it('keeps the next-step label outside interview', () => {
    expect(deriveNextActionLabel(makeTicket({ status: 'todo', extras: { clarityPercent: 72 } }), 'Doing')).toBe('Doing →')
  })

  it('keeps the next-step label when clarity is missing', () => {
    expect(deriveNextActionLabel(makeTicket(), 'Todo')).toBe('Todo →')
  })
})
