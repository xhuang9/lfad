import { describe, expect, it } from 'vitest'

import { filterParked } from '../src/components/Parked'
import { isNeedsAction } from '../src/needsAction'
import { isRunnableInBatch } from '../src/runnable'
import type { Category, Ticket } from '../src/types'

function ticket(id: number, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    slug: `ticket-${id}`,
    title: `Ticket ${id}`,
    status: 'parked',
    returnStep: 'todo',
    category: 'logic',
    tags: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: `2026-07-18T00:00:0${id}.000Z`,
    history: [],
    ...over,
  }
}

describe('parked collection', () => {
  it('filters by category and text and orders newest first', () => {
    const tickets = [
      ticket(1, { title: 'Keep old', category: 'bug', tags: ['keep'] }),
      ticket(2, { title: 'Ignore', category: 'logic' }),
      ticket(3, { title: 'Keep new', category: 'bug', tags: ['keep'] }),
    ]
    const shown = filterParked(tickets, 'keep', new Set<Category>(['bug']))
    expect(shown.map((item) => item.id)).toEqual([3, 1])
  })

  it('uses descending ticket id as the timestamp tie-break', () => {
    const timestamp = '2026-07-18T00:00:00.000Z'
    const shown = filterParked([
      ticket(3, { updatedAt: timestamp }),
      ticket(8, { updatedAt: timestamp }),
      ticket(5, { updatedAt: timestamp }),
    ], '', new Set())

    expect(shown.map((item) => item.id)).toEqual([8, 5, 3])
  })

  it('is neither batch-runnable nor a Needs action ticket', () => {
    const parked = ticket(1)
    expect(isRunnableInBatch(parked, undefined)).toBe(false)
    expect(isNeedsAction(parked, undefined)).toBe(false)
  })
})
