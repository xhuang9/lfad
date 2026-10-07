import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Card } from '../src/components/Card'
import type { AutomationLevel, Ticket } from '../src/types'

function baseTicket(level?: AutomationLevel): Ticket {
  return {
    id: 77,
    slug: 'automation-badge',
    title: 'Automation badge order and colour',
    status: 'todo',
    category: 'ui',
    tags: [],
    ...(level ? { automationLevel: level } : {}),
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    history: [],
  }
}

function render(level?: AutomationLevel): string {
  return renderToStaticMarkup(createElement(Card, {
    ticket: baseTicket(level),
    onOpen: () => undefined,
    onOpenInput: () => undefined,
    keywords: { maxShown: 3, items: [] },
  }))
}

describe('automation badge', () => {
  it('renders a solid express badge beside #id, ahead of the card foot', () => {
    const html = render('express')
    expect(html).toContain('automation-badge express')
    expect(html).toContain('Express')
    // Badge lives in the top-row lead cluster, not the foot.
    expect(html.indexOf('automation-badge')).toBeLessThan(html.indexOf('card-foot'))
    expect(html.indexOf('automation-badge')).toBeGreaterThan(html.indexOf('card-top-lead'))
  })

  it('renders a solid manual badge', () => {
    const html = render('manual')
    expect(html).toContain('automation-badge manual')
    expect(html).toContain('Manual')
  })

  it('renders no badge for normal', () => {
    const html = render('normal')
    expect(html).not.toContain('automation-badge')
  })

  it('renders no badge when the level is absent (normalized to normal)', () => {
    const html = render()
    expect(html).not.toContain('automation-badge')
  })

  it('keeps the automation-coloured left border double-encoding the level', () => {
    expect(render('express')).toContain('var(--accent)')
    expect(render('manual')).toContain('var(--warn)')
  })
})
