import { describe, expect, it } from 'vitest'

import { validateBuildStages } from '../src/index.js'

const valid = {
  total: 2,
  current: 1,
  items: [
    { key: 'core', title: 'Core contract', status: 'building' },
    { key: 'ui', title: 'Tolerant UI', status: 'pending' },
  ],
}

describe('validateBuildStages', () => {
  it('returns no warnings for an absent or valid marker', () => {
    expect(validateBuildStages(undefined)).toEqual([])
    expect(validateBuildStages(valid)).toEqual([])
  })

  it('warns when an item is missing its canonical key', () => {
    const warnings = validateBuildStages({
      ...valid,
      items: [{ title: 'Core contract', status: 'building' }, valid.items[1]],
    })

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'items.0.key' }),
    ]))
  })

  it('warns about an invalid status', () => {
    const warnings = validateBuildStages({
      ...valid,
      items: [{ ...valid.items[0], status: 'complete' }, valid.items[1]],
    })

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'items.0.status' }),
    ]))
  })

  it('warns when total does not match the number of items', () => {
    const warnings = validateBuildStages({ ...valid, total: 3 })

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'total', message: 'total must match items.length (2)' }),
    ]))
  })

  it.each([0, 3])('warns when current=%s is outside the 1-based range', (current) => {
    const warnings = validateBuildStages({ ...valid, current })

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'current', message: 'current must be between 1 and total (2)' }),
    ]))
  })
})
