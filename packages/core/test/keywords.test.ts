import { describe, expect, it } from 'vitest'

import {
  KEYWORD_COLORS,
  KEYWORD_NEUTRALS,
  KEYWORD_PALETTE,
  KEYWORD_SHADES,
  LEGACY_KEYWORD_COLORS,
} from '../src/keywords'

describe('keyword palette', () => {
  it('provides five Tailwind shades for 18 hues and three neutral families', () => {
    expect(KEYWORD_SHADES).toEqual([100, 300, 500, 700, 900])
    expect(KEYWORD_PALETTE).toHaveLength(18)
    expect(KEYWORD_PALETTE.map((row) => row.name)).toEqual([
      'Red', 'Orange', 'Amber', 'Yellow', 'Lime', 'Green', 'Emerald', 'Teal', 'Cyan',
      'Sky', 'Blue', 'Indigo', 'Violet', 'Purple', 'Fuchsia', 'Pink', 'Rose', 'Slate',
    ])
    expect(KEYWORD_NEUTRALS.map((row) => row.name)).toEqual(['Gray', 'Zinc', 'Stone'])
    expect([...KEYWORD_PALETTE, ...KEYWORD_NEUTRALS].every((row) => row.colors.length === 5)).toBe(true)
  })

  it('allows every picker colour and every legacy 600 colour without duplicates', () => {
    expect(KEYWORD_COLORS).toHaveLength(18 * 5 + 3 * 5 + 18)
    expect(new Set(KEYWORD_COLORS).size).toBe(KEYWORD_COLORS.length)
    expect(LEGACY_KEYWORD_COLORS.every((color) => KEYWORD_COLORS.includes(color))).toBe(true)
  })
})
