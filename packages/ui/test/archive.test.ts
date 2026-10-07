import { describe, expect, it } from 'vitest'

import { filterArchive } from '../src/archive'
import type { Category, Ticket } from '../src/types'

const noCategories = new Set<Category>()

function makeTicket(id: number, updatedAt: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    slug: `ticket-${id}`,
    title: `Ticket ${id}`,
    status: 'done',
    category: 'bug',
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt,
    history: [{ step: 'done', at: updatedAt }],
    ...over,
  }
}

describe('filterArchive', () => {
  it('orders archived tickets by updatedAt descending without mutating the input', () => {
    const tickets = [
      makeTicket(1, '2026-07-01T00:00:00.000Z'),
      makeTicket(2, '2026-07-03T00:00:00.000Z'),
      makeTicket(3, '2026-07-02T00:00:00.000Z'),
    ]
    const originalIds = tickets.map((ticket) => ticket.id)

    const shown = filterArchive(tickets, { selected: noCategories, q: '', from: '', to: '' })

    expect(shown.map((ticket) => ticket.id)).toEqual([2, 3, 1])
    expect(tickets.map((ticket) => ticket.id)).toEqual(originalIds)
  })

  it('orders matching filtered tickets newest-first', () => {
    const tickets = [
      makeTicket(1, '2026-07-01T00:00:00.000Z', { title: 'Keep oldest', tags: ['keep'] }),
      makeTicket(2, '2026-07-04T00:00:00.000Z', { title: 'Ignore newest', category: 'logic' }),
      makeTicket(3, '2026-07-03T00:00:00.000Z', { title: 'Keep newest', tags: ['keep'] }),
    ]

    const shown = filterArchive(tickets, {
      selected: new Set<Category>(['bug']),
      q: 'keep',
      from: '2026-07-01',
      to: '2026-07-03',
    })

    expect(shown.map((ticket) => ticket.id)).toEqual([3, 1])
  })

  it('uses descending ticket id as the timestamp tie-break', () => {
    const timestamp = '2026-07-03T00:00:00.000Z'
    const tickets = [makeTicket(3, timestamp), makeTicket(8, timestamp), makeTicket(5, timestamp)]

    const shown = filterArchive(tickets, { selected: noCategories, q: '', from: '', to: '' })

    expect(shown.map((ticket) => ticket.id)).toEqual([8, 5, 3])
  })
})
