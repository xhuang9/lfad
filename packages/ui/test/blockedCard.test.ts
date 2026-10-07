import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Card } from '../src/components/Card'
import type { Ticket } from '../src/types'

const ticket: Ticket = {
  id: 69,
  slug: 'blocked-ticket',
  title: 'Blocked ticket',
  status: 'blocked',
  category: 'logic',
  tags: [],
  returnStep: 'review',
  openInputs: 1,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
  history: [],
}

describe('blocked card', () => {
  it('keeps its question-bearing escalation passive', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      ticket,
      hint: { label: 'Blocked', tone: 'blocked' },
      onOpen: () => undefined,
      onOpenInput: () => undefined,
      keywords: { maxShown: 3, items: [] },
    }))

    expect(html).toContain('hint-blocked')
    expect(html).not.toContain('hint-question')
    expect(html).not.toContain('Answer 1 open question')
  })
})
