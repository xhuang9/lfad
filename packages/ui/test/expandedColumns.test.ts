import { afterEach, describe, expect, it, vi } from 'vitest'

import { readExpanded } from '../src/expandedColumns'

function stubStorage(value: string | null): void {
  vi.stubGlobal('localStorage', { getItem: () => value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readExpanded', () => {
  it('starts with every column collapsed', () => {
    stubStorage(null)
    expect(readExpanded()).toEqual(new Set())
  })

  it('restores the expanded step keys', () => {
    stubStorage('["interview","todo"]')
    expect(readExpanded()).toEqual(new Set(['interview', 'todo']))
  })

  it('ignores entries that are not step keys', () => {
    stubStorage('["interview",3,null]')
    expect(readExpanded()).toEqual(new Set(['interview']))
  })

  it('falls back to collapsed on malformed or blocked storage', () => {
    stubStorage('{not json')
    expect(readExpanded()).toEqual(new Set())
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readExpanded()).toEqual(new Set())
  })
})
