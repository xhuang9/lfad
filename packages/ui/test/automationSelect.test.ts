import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { automationSelectClassName } from '../src/components/TicketDrawer/TicketDrawer'
import type { AutomationLevel } from '../src/types'

// The drawer automation control mirrors the card automation badge (#77): the
// same level drives the same --status-* tint. Assert the level→class mapping
// through renderToStaticMarkup, the way automationBadge.test.ts asserts the
// card badge, but on the colocated pure function so no fetch/hook mock is
// needed and the seam stays deterministic.
function render(level: AutomationLevel): string {
  return renderToStaticMarkup(
    createElement('label', { className: automationSelectClassName(level) }, 'Automation'),
  )
}

describe('automation select tint', () => {
  it('tints the express control with the express modifier', () => {
    expect(render('express')).toContain('automation-select express')
  })

  it('tints the manual control with the manual modifier', () => {
    expect(render('manual')).toContain('automation-select manual')
  })

  it('keeps the normal control neutral (no level modifier)', () => {
    const html = render('normal')
    expect(html).toContain('class="automation-select"')
    expect(html).not.toContain('automation-select express')
    expect(html).not.toContain('automation-select manual')
  })

  it('normalizes an absent level to neutral', () => {
    // The drawer passes `ticket.automationLevel ?? 'normal'`, so the class
    // function only ever sees a concrete level; the default path is neutral.
    expect(automationSelectClassName('normal')).toBe('automation-select')
  })
})
