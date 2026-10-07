import { describe, expect, it } from 'vitest'

import type { BoardLayout } from '../src/api'
import { MIN_LANDSCAPE_WIDTH, resolveOrientation, type ResolvedOrientation } from '../src/useBoardLayout'

describe('resolveOrientation', () => {
  const wide = { w: 1280, h: 800 }
  const tall = { w: 800, h: 1280 }
  const narrow = { w: MIN_LANDSCAPE_WIDTH - 1, h: 400 }

  it.each([
    // layout, viewport, expected
    ['portrait', wide, 'portrait'],
    ['portrait', tall, 'portrait'],
    ['portrait', narrow, 'portrait'],
    ['auto', wide, 'landscape'],
    ['auto', tall, 'portrait'],
    ['auto', narrow, 'portrait'],
    ['landscape', wide, 'landscape'],
    // Explicit landscape forces side-by-side even on a portrait-shaped viewport…
    ['landscape', tall, 'landscape'],
    // …but a too-narrow viewport still silently falls back to portrait.
    ['landscape', narrow, 'portrait'],
  ] satisfies Array<[BoardLayout, { w: number, h: number }, ResolvedOrientation]>)(
    'resolves %s at %o to %s',
    (layout, { w, h }, expected) => {
      expect(resolveOrientation(layout, w, h)).toBe(expected)
    },
  )

  it('treats the exact MIN_LANDSCAPE_WIDTH as wide enough for landscape', () => {
    expect(resolveOrientation('landscape', MIN_LANDSCAPE_WIDTH, 400)).toBe('landscape')
    expect(resolveOrientation('auto', MIN_LANDSCAPE_WIDTH, 400)).toBe('landscape')
  })
})
