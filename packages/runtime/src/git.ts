/**
 * Minimal git snapshotting for the daemon. Per SPEC §7, modifying existing
 * ticket content must first commit a pre-change snapshot of the board so the
 * edit is recoverable. This is strictly best-effort: when the board is not its
 * own git repo (or there is nothing to commit, or no identity is configured)
 * the snapshot is silently skipped and the caller proceeds with the write.
 */

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'

/** Runs `git -C <boardRoot> <args>` silently, throwing on a non-zero exit. */
function git(boardRoot: string, args: string[]): void {
  execFileSync('git', ['-C', boardRoot, ...args], { stdio: 'ignore' })
}

/** Runs `git -C <boardRoot> <args>` and returns its trimmed stdout. */
function gitOut(boardRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', boardRoot, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
}

/**
 * True when `boardRoot` is itself the top level of a git working tree. Merely
 * being INSIDE a repo is not enough: `git add -A` stages the entire tree, so
 * snapshotting a board nested in a larger repo would commit the user's own
 * unrelated work into that outer repo.
 */
function isBoardRepo(boardRoot: string): boolean {
  try {
    const toplevel = gitOut(boardRoot, ['rev-parse', '--show-toplevel'])
    return realpathSync(toplevel) === realpathSync(boardRoot)
  } catch {
    return false
  }
}

/**
 * Commits the CURRENT state of the board as a pre-edit snapshot before an
 * artifact is overwritten. No-op when the board is not a git repo or when there
 * is nothing staged to commit (a clean tree). Never throws.
 */
export function snapshotBeforeEdit(boardRoot: string, id: number, name: string): void {
  snapshot(boardRoot, `snapshot before edit to #${id}/${name}`)
}

/** Commits the current board before editing board-level data such as settings. */
export function snapshotBeforeBoardEdit(boardRoot: string, name: string): void {
  snapshot(boardRoot, `snapshot before edit to ${name}`)
}

/** Best-effort shared snapshot implementation. */
function snapshot(boardRoot: string, message: string): void {
  if (!isBoardRepo(boardRoot)) return
  try {
    git(boardRoot, ['add', '-A'])
    git(boardRoot, ['commit', '-m', message])
  } catch {
    // best-effort: nothing to commit, or no git identity configured — skip.
  }
}
