import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Card } from '../src/components/Card'
import type { KeywordSettings, Ticket } from '../src/types'

const ticket: Ticket = {
  id: 74,
  slug: 'readable-card-metadata',
  title: 'Readable card metadata',
  status: 'doing',
  category: 'refactor',
  tags: ['hitloop', 'board-ui', 'titles', 'extra'],
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:00.000Z',
  history: [],
}

const keywords: KeywordSettings = {
  maxShown: 3,
  items: [{ word: 'hitloop', color: '#0284c7' }],
}

function renderCard(overrides: Partial<Ticket> = {}, keywordSettings = keywords) {
  return renderToStaticMarkup(createElement(Card, {
    ticket: { ...ticket, ...overrides },
    onOpen: () => undefined,
    onOpenInput: () => undefined,
    keywords: keywordSettings,
  }))
}

describe('card metadata', () => {
  it('renders the category as a labelled colour dot', () => {
    const html = renderCard()

    expect(html).toContain('class="card-category"')
    expect(html).toContain('style="--category-color:#10b981"')
    expect(html).toContain('class="card-category-dot" aria-hidden="true"')
    expect(html).toContain('Refactor')
    expect(html).not.toContain('background-color:#10b981')
  })

  it('highlights matched keywords and keeps neutral tags in a separated text run', () => {
    const html = renderCard()

    expect(html).toContain('class="card-tag-run"')
    expect(html).toContain('class="card-tag card-tag-matched"')
    expect(html).toContain('style="--keyword-color:#0284c7"')
    expect(html).toContain('title="Matches project keyword: hitloop"')
    expect(html).toContain('class="card-tag-seed" aria-hidden="true"')
    expect(html.match(/class="card-tag-sep"/g)).toHaveLength(1)
    expect(html).toContain('<span class="card-tag-more">+1</span>')
  })

  it('leaves unconfigured tags neutral', () => {
    const html = renderCard({ tags: ['one', 'two'] }, { maxShown: 3, items: [] })

    expect(html).not.toContain('card-tag-matched')
    expect(html).not.toContain('card-tag-seed')
    expect(html.match(/class="card-tag-sep"/g)).toHaveLength(1)
  })
})
