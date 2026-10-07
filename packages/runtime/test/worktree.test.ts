import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTicket, readTicket, setWorktree, type BoardConfig, type Ticket } from '@lfad/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createServer, type RunningServer } from '../src/index.js'
import { resolveRunConfig } from '../src/run-config.js'
import { removeWorktree, worktreeCreateCommand, worktreeRemoveCommand } from '../src/worktree.js'
import { makeFullFixtureBoard } from './helpers.js'

/** Creates a throwaway git repo with one commit so `git worktree add` works. */
function makeCodeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lfad-wt-code-'))
  execFileSync('git', ['-C', repo, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })
  writeFileSync(join(repo, 'README.md'), '# code\n')
  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'ignore' })
  execFileSync('git', ['-C', repo, 'commit', '-m', 'initial'], { stdio: 'ignore' })
  return repo
}

/** Branches known to the repo (`git branch --list`). */
function branches(repo: string): string[] {
  return execFileSync('git', ['-C', repo, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((b) => b.length > 0)
}

describe('worktree primitives (REST)', () => {
  let boardRoot: string
  let config: BoardConfig
  let codeRepo: string
  let owningRepo: string
  let worktreeRoot: string
  let customWorktreeRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number

  beforeAll(async () => {
    const fixture = makeFullFixtureBoard('lfad-wt-')
    boardRoot = fixture.root
    config = fixture.config
    codeRepo = makeCodeRepo()
    owningRepo = makeCodeRepo()
    worktreeRoot = mkdtempSync(join(tmpdir(), 'lfad-wt-trees-'))
    customWorktreeRoot = mkdtempSync(join(tmpdir(), 'lfad-wt-custom-trees-'))
    ticketId = createTicket(boardRoot, config, { title: 'Worktree me', category: 'logic' }).id

    const runConfig = resolveRunConfig(
      { LFAD_CODE_REPO: codeRepo, LFAD_WORKTREE_ROOT: worktreeRoot, LFAD_AUTOPILOT: 'false' },
      boardRoot,
    )
    server = await createServer({ boardRoot, runConfig }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    for (const dir of [boardRoot, worktreeRoot, customWorktreeRoot, codeRepo, owningRepo]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('POST creates the worktree on the requested branch and records it on the ticket', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/worktree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/1-worktree-me' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket, worktree: { path: string, branch: string } }
    const expectedPath = join(worktreeRoot, `t-${ticketId}`)
    expect(body.worktree).toEqual({ path: expectedPath, branch: 'feature/1-worktree-me' })
    expect(body.ticket.worktree).toBe(expectedPath)
    expect(existsSync(expectedPath)).toBe(true)
    expect(branches(codeRepo)).toContain('feature/1-worktree-me')
    expect(readTicket(boardRoot, config, ticketId).worktree).toBe(expectedPath)
  })

  it('DELETE removes the worktree and clears the frontmatter field', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/worktree`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.worktree).toBeUndefined()
    expect(existsSync(join(worktreeRoot, `t-${ticketId}`))).toBe(false)
    expect(readTicket(boardRoot, config, ticketId).worktree).toBeUndefined()
  })

  it('DELETE removes a recorded custom path from the worktree owning repo', async () => {
    const customTicketId = createTicket(boardRoot, config, { title: 'Custom worktree', category: 'logic' }).id
    const customPath = join(customWorktreeRoot, 'manually-named-worktree')
    execFileSync('git', ['-C', owningRepo, 'worktree', 'add', customPath, '-b', 'feature/custom-worktree'], {
      stdio: 'ignore',
    })
    setWorktree(boardRoot, config, customTicketId, { path: customPath })

    const res = await fetch(`${base}/api/tickets/${customTicketId}/worktree`, { method: 'DELETE' })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.worktree).toBeUndefined()
    expect(existsSync(customPath)).toBe(false)
    expect(readTicket(boardRoot, config, customTicketId).worktree).toBeUndefined()
  })

  it('POST without a branch → 400; unknown ticket → 404', async () => {
    const noBranch = await fetch(`${base}/api/tickets/${ticketId}/worktree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(noBranch.status).toBe(400)

    const missing = await fetch(`${base}/api/tickets/999999/worktree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/nope' }),
    })
    expect(missing.status).toBe(404)
  })

  it('POST surfaces a git failure (duplicate branch) as a 400 with the git message', async () => {
    const other = createTicket(boardRoot, config, { title: 'Second ticket', category: 'bug' }).id
    const res = await fetch(`${base}/api/tickets/${other}/worktree`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/1-worktree-me' }), // already exists from the first test
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('git worktree add failed')
  })
})

describe('worktree primitives (CLI command bodies)', () => {
  let boardRoot: string
  let config: BoardConfig
  let codeRepo: string
  let owningRepo: string
  let worktreeRoot: string
  let customWorktreeRoot: string
  let env: NodeJS.ProcessEnv
  let ticketId: number

  beforeAll(() => {
    const fixture = makeFullFixtureBoard('lfad-wt-cli-')
    boardRoot = fixture.root
    config = fixture.config
    codeRepo = makeCodeRepo()
    owningRepo = makeCodeRepo()
    worktreeRoot = mkdtempSync(join(tmpdir(), 'lfad-wt-cli-trees-'))
    customWorktreeRoot = mkdtempSync(join(tmpdir(), 'lfad-wt-cli-custom-trees-'))
    env = { LFAD_CODE_REPO: codeRepo, LFAD_WORKTREE_ROOT: worktreeRoot }
    ticketId = createTicket(boardRoot, config, { title: 'CLI worktree', category: 'refactor' }).id
  })

  afterAll(() => {
    for (const dir of [boardRoot, worktreeRoot, customWorktreeRoot, codeRepo, owningRepo]) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('create provisions the worktree, records the path, and is reusable; remove clears it', () => {
    const { path, ticket } = worktreeCreateCommand(boardRoot, env, ticketId, 'refactor/2-cli-worktree')
    expect(path).toBe(join(worktreeRoot, `t-${ticketId}`))
    expect(ticket.worktree).toBe(path)
    expect(existsSync(path)).toBe(true)
    expect(branches(codeRepo)).toContain('refactor/2-cli-worktree')

    // Re-running create reuses the existing worktree directory.
    const again = worktreeCreateCommand(boardRoot, env, ticketId, 'refactor/other-name')
    expect(again.path).toBe(path)

    const cleared = worktreeRemoveCommand(boardRoot, env, ticketId)
    expect(cleared.worktree).toBeUndefined()
    expect(existsSync(path)).toBe(false)
  })

  it('create throws on an unknown ticket and when no code repo is configured', () => {
    expect(() => worktreeCreateCommand(boardRoot, env, 999999, 'feature/x')).toThrow(/not found/)
    expect(() => worktreeCreateCommand(boardRoot, {}, ticketId, 'feature/x')).toThrow(/LFAD_CODE_REPO/)
  })

  it('remove uses the recorded custom path and its owning repo', () => {
    const customTicketId = createTicket(boardRoot, config, { title: 'Owned elsewhere', category: 'refactor' }).id
    const customPath = join(customWorktreeRoot, 'manual-worktree-name')
    execFileSync('git', ['-C', owningRepo, 'worktree', 'add', customPath, '-b', 'refactor/owned-elsewhere'], {
      stdio: 'ignore',
    })
    setWorktree(boardRoot, config, customTicketId, { path: customPath })

    const cleared = worktreeRemoveCommand(boardRoot, env, customTicketId)

    expect(cleared.worktree).toBeUndefined()
    expect(existsSync(customPath)).toBe(false)
    expect(readTicket(boardRoot, config, customTicketId).worktree).toBeUndefined()
  })

  it('remove is a no-op for a missing recorded path', () => {
    const cfg = resolveRunConfig(env, boardRoot)
    expect(() => removeWorktree(cfg, ticketId, join(worktreeRoot, 'missing-custom-path'))).not.toThrow()
  })

  it('remove refuses a dirty recorded worktree without throwing', () => {
    const dirtyTicketId = createTicket(boardRoot, config, { title: 'Dirty worktree', category: 'bug' }).id
    const dirtyPath = join(worktreeRoot, 'dirty-custom-path')
    execFileSync('git', ['-C', codeRepo, 'worktree', 'add', dirtyPath, '-b', 'bugfix/dirty-worktree'], {
      stdio: 'ignore',
    })
    writeFileSync(join(dirtyPath, 'untracked.txt'), 'keep me\n')
    setWorktree(boardRoot, config, dirtyTicketId, { path: dirtyPath })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => worktreeRemoveCommand(boardRoot, env, dirtyTicketId)).not.toThrow()
      expect(existsSync(dirtyPath)).toBe(true)
      expect(readTicket(boardRoot, config, dirtyTicketId).worktree).toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(dirtyPath))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped'))
    } finally {
      warn.mockRestore()
    }
  })
})
