import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveRunConfig } from '../src/run-config.js'

const BOARD = '/tmp/board'

describe('resolveRunConfig', () => {
  it('applies the v1 defaults from an empty env', () => {
    const cfg = resolveRunConfig({}, BOARD)
    expect(cfg.dryRun).toBe(true)
    expect(cfg.autopilot).toBe(true)
    expect(cfg.timeoutMs).toBe(600000)
    expect(cfg.codeRepo).toBeUndefined()
    expect(cfg.worktreeRoot).toBeUndefined()
  })

  it('honours explicit overrides (agent cmd + permission mode now live in board.yml)', () => {
    const cfg = resolveRunConfig(
      {
        LFAD_DRY_RUN: 'false',
        LFAD_AUTOPILOT: 'off',
        LFAD_RUN_TIMEOUT_MS: '1234',
        LFAD_CODE_REPO: '/abs/repo',
      },
      BOARD,
    )
    expect(cfg.dryRun).toBe(false)
    expect(cfg.autopilot).toBe(false)
    expect(cfg.timeoutMs).toBe(1234)
    expect(cfg.codeRepo).toBe('/abs/repo')
    // The removed envs are simply ignored — no adapter config leaks in from env.
    expect('agentCmd' in cfg).toBe(false)
    expect('permissionMode' in cfg).toBe(false)
  })

  it('defaults worktreeRoot to a sibling of the code repo', () => {
    const cfg = resolveRunConfig({ LFAD_CODE_REPO: '/abs/repo' }, BOARD)
    expect(cfg.worktreeRoot).toBe('/abs/.lfad-worktrees')
  })

  it('keeps an existing .hitloop-worktrees folder from before the rename', () => {
    const parent = mkdtempSync(join(tmpdir(), 'lfad-wt-'))
    mkdirSync(join(parent, '.hitloop-worktrees'))
    const cfg = resolveRunConfig({ LFAD_CODE_REPO: join(parent, 'repo') }, BOARD)
    expect(cfg.worktreeRoot).toBe(join(parent, '.hitloop-worktrees'))
    rmSync(parent, { recursive: true, force: true })
  })

  it('still reads legacy HITLOOP_ variables from older .env files', () => {
    const cfg = resolveRunConfig({ HITLOOP_DRY_RUN: 'false', HITLOOP_CODE_REPO: '/tmp/repo' }, '/tmp/board')
    expect(cfg.dryRun).toBe(false)
    expect(cfg.codeRepo).toBe('/tmp/repo')
  })

  it('resolves relative code-repo paths against the board root', () => {
    const cfg = resolveRunConfig({ LFAD_CODE_REPO: '../main' }, '/work/.flow')
    expect(cfg.codeRepo).toBe('/work/main')
  })

  it('keeps a bad timeout at the default and treats empty booleans as default', () => {
    const cfg = resolveRunConfig({ LFAD_RUN_TIMEOUT_MS: 'nope', LFAD_DRY_RUN: '' }, BOARD)
    expect(cfg.timeoutMs).toBe(600000)
    expect(cfg.dryRun).toBe(true)
  })
})
