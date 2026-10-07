import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { StageBar, StageRail } from '../src/components/StageProgress'
import type { BuildStages } from '../src/types'

describe('staged-build progress', () => {
  it('keeps valid marker output unchanged', () => {
    const stages: BuildStages = {
      total: 2,
      current: 1,
      items: [
        { key: 'core', title: 'Core contract', status: 'review' },
        { key: 'ui', title: 'Tolerant UI', status: 'pending' },
      ],
    }
    const html = renderToStaticMarkup(createElement(StageRail, { stages }))

    expect(html).toContain('stage-status stage-status-review')
    expect(html).toContain('stage-status stage-status-pending')
  })

  it('renders an unknown status neutrally without leaking it into a class name', () => {
    const stages = {
      total: 2,
      current: 9,
      items: [
        { title: 'Malformed stage', status: 'garbage"><script' },
        { key: 'ui', title: 'Tolerant UI', status: 'pending' },
      ],
    } as unknown as BuildStages

    const rail = renderToStaticMarkup(createElement(StageRail, { stages }))
    const bar = renderToStaticMarkup(createElement(StageBar, { stages }))

    expect(rail).toContain('<span class="stage-status">unknown</span>')
    expect(rail).not.toContain('stage-status-garbage')
    expect(rail).not.toContain('is-cur')
    expect(bar).toContain('Stage <b>2</b> / 2')
    expect(bar).not.toContain('Malformed stage')
  })

  it('renders nothing when items is not an array', () => {
    const stages = { total: 2, current: 1, items: null } as unknown as BuildStages

    expect(renderToStaticMarkup(createElement(StageBar, { stages }))).toBe('')
    expect(renderToStaticMarkup(createElement(StageRail, { stages }))).toBe('')
  })
})
