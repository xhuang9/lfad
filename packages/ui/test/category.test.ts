import { describe, expect, it } from 'vitest'

import { CATEGORIES, CATEGORY_BADGES } from '../src/types'

function relativeLuminance(hex: string): number {
  const normalized = hex.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('category badge presentation', () => {
  it('uses the approved readable labels', () => {
    expect(CATEGORIES.map((category) => CATEGORY_BADGES[category].label)).toEqual([
      'UI',
      'Bug',
      'Logic',
      'Business',
      'Refactor',
      'Hotfix',
    ])
  })

  it('meets WCAG AA contrast for every solid badge', () => {
    for (const category of CATEGORIES) {
      const badge = CATEGORY_BADGES[category]
      expect(contrastRatio(badge.fill, badge.ink), category).toBeGreaterThanOrEqual(4.5)
    }
  })
})
