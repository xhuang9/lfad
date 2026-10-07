import { describe, expect, it } from 'vitest'

import { withLegacyEnv } from '../src/env.js'

describe('withLegacyEnv', () => {
  it('copies a legacy HITLOOP_ variable to its LFAD_ name', () => {
    expect(withLegacyEnv({ HITLOOP_BOARD: '..' }).LFAD_BOARD).toBe('..')
  })

  it('keeps an LFAD_ value over the legacy one', () => {
    expect(withLegacyEnv({ HITLOOP_PORT: '1', LFAD_PORT: '2' }).LFAD_PORT).toBe('2')
  })

  it('leaves the input untouched', () => {
    const env = { HITLOOP_DRY_RUN: 'false' }
    withLegacyEnv(env)
    expect(env).toEqual({ HITLOOP_DRY_RUN: 'false' })
  })
})
