/**
 * snapshotBeforeEdit must only ever commit the board's OWN repo. `git add -A`
 * stages the entire working tree, so a board folder that merely sits INSIDE a
 * larger repo (e.g. a `.flow/` whose `.git` was never created) must be treated
 * as "not a git repo" — otherwise every artifact edit would silently commit the
 * user's unrelated project changes into that outer repo.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { snapshotBeforeEdit } from '../src/git.js'

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
}

function initRepo(dir: string): void {
  execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'commit', '-m', message], { stdio: 'ignore' })
}

function commitCount(dir: string): number {
  return Number.parseInt(git(dir, ['rev-list', '--count', 'HEAD']), 10)
}

describe('snapshotBeforeEdit', () => {
  let outer: string

  beforeEach(() => {
    outer = mkdtempSync(join(tmpdir(), 'lfad-git-'))
  })

  afterEach(() => {
    rmSync(outer, { recursive: true, force: true })
  })

  it('commits a pre-edit snapshot when the board root is its own repo', () => {
    initRepo(outer)
    writeFileSync(join(outer, 'file.md'), 'v1\n')
    commitAll(outer, 'initial board')

    writeFileSync(join(outer, 'file.md'), 'v2\n')
    snapshotBeforeEdit(outer, 1, 'file.md')

    expect(commitCount(outer)).toBe(2)
    expect(git(outer, ['log', '-1', '--format=%s'])).toBe('snapshot before edit to #1/file.md')
  })

  it('never commits the parent repo when the board is nested inside it without its own .git', () => {
    initRepo(outer)
    writeFileSync(join(outer, 'project.txt'), 'committed project state\n')
    commitAll(outer, 'initial project')

    const board = join(outer, '.flow')
    mkdirSync(board)
    writeFileSync(join(board, 'ticket.md'), 'artifact\n')
    writeFileSync(join(outer, 'project.txt'), 'the user\'s uncommitted work\n')

    snapshotBeforeEdit(board, 1, 'ticket.md')

    expect(commitCount(outer)).toBe(1) // no snapshot landed in the parent repo
    expect(git(outer, ['status', '--porcelain'])).not.toBe('') // the user's work stays uncommitted
  })
})
