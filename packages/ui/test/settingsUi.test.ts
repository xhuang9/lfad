import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Sidebar } from '../src/components/Sidebar'
import type { Category } from '../src/types'

describe('settings UI', () => {
  it('uses the accessible KEYWORDS cog without the redundant Settings section', () => {
    const html = renderToStaticMarkup(createElement(Sidebar, {
      view: 'board',
      onView: () => undefined,
      collapsed: false,
      onToggle: () => undefined,
      categoryFilter: new Set<Category>(),
      onToggleCategory: () => undefined,
      keywordFilter: new Set<string>(),
      onToggleKeyword: () => undefined,
      keywords: { maxShown: 3, items: [] },
      onConfigureKeywords: () => undefined,
      tickets: [],
      archiveCount: 0,
      parkedCount: 0,
      onManual: () => undefined,
    }))

    expect(html).toContain('aria-label="Configure project keywords"')
    expect(html).toContain('class="lucide lucide-cog"')
    expect(html).not.toContain('class="sidebar-settings"')
    expect(html).not.toContain('Action prompts')
  })

  it('keeps the topbar above cards and below the existing overlays', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const topbar = css.match(/\.topbar\s*\{([^}]*)\}/)?.[1]

    expect(topbar).toContain('position: relative')
    expect(topbar).toContain('z-index: 30')
    expect(css).toMatch(/\.modal-backdrop\s*\{[^}]*z-index:\s*40/s)
    expect(css).toMatch(/\.keyword-palette\s*\{[^}]*z-index:\s*60/s)
    expect(css).toMatch(/\.dependency-modal-backdrop\s*\{[^}]*z-index:\s*70/s)
  })
})
