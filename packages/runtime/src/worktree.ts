/**
 * Git worktree PRIMITIVES for the engine — mechanism only, zero policy. Branch
 * naming, when to create, and when to remove are all decided by the calling
 * skill; the engine merely provisions/removes the worktree and records the
 * path in the ticket's `worktree` frontmatter field (via core `setWorktree`).
 * Exposed as REST (`POST`/`DELETE /api/tickets/:id/worktree`) and CLI
 * (`flow worktree create|remove`); the run engine itself never creates one.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { loadBoardConfig, readTicket, setWorktree, type Ticket } from '@lfad/core'

import { defaultWorktreeRoot, resolveRunConfig, type RunConfig } from './run-config.js'

/** Resolves the worktree root for a config, falling back to {@link defaultWorktreeRoot}. */
function worktreeRootFor(cfg: RunConfig): string | undefined {
  if (cfg.worktreeRoot !== undefined) return cfg.worktreeRoot
  if (cfg.codeRepo !== undefined) return defaultWorktreeRoot(cfg.codeRepo)
  return undefined
}

/**
 * Provisions the git worktree for a ticket on the given branch, returning its
 * absolute path. Reuses an existing `t-<id>` directory rather than re-adding
 * it. Throws with a readable message when no code repo is configured or git
 * refuses (not a repo, branch exists, …).
 *
 * @param cfg - the resolved run config.
 * @param id - the ticket id (worktree dir `t-<id>`).
 * @param branch - the branch to create the worktree on (caller's policy).
 */
export function createWorktree(cfg: RunConfig, id: number, branch: string): string {
  if (cfg.codeRepo === undefined) {
    throw new Error('No code repo configured (LFAD_CODE_REPO) — cannot create a worktree')
  }
  const root = worktreeRootFor(cfg)!
  const path = join(root, `t-${id}`)
  if (existsSync(path)) return path
  mkdirSync(root, { recursive: true })
  try {
    execFileSync('git', ['-C', cfg.codeRepo, 'worktree', 'add', path, '-b', branch], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim()
    throw new Error(`git worktree add failed for ticket ${id}: ${stderr || (err instanceof Error ? err.message : String(err))}`)
  }
  return path
}

/**
 * Removes a ticket's recorded worktree (and prunes the registration), falling
 * back to the legacy `t-<id>` path when none was recorded. The owning repo is
 * derived from the worktree itself. No-op when no path can be resolved or the
 * path does not exist. Never throws.
 */
export function removeWorktree(cfg: RunConfig, id: number, recordedPath?: string): void {
  const root = worktreeRootFor(cfg)
  const path = recordedPath?.trim() || (root === undefined ? undefined : join(root, `t-${id}`))
  if (path === undefined) return
  if (!existsSync(path)) return

  let ownerRepo: string | undefined
  try {
    const commonGitDir = execFileSync(
      'git',
      ['-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
    ownerRepo = dirname(commonGitDir)
    execFileSync('git', ['-C', ownerRepo, 'worktree', 'remove', path], {
      stdio: 'ignore',
    })
  } catch {
    console.warn(`Worktree removal skipped for ${path}: git refused or the path is not a worktree`)
  }

  if (ownerRepo !== undefined) {
    try {
      execFileSync('git', ['-C', ownerRepo, 'worktree', 'prune'], { stdio: 'ignore' })
    } catch {
      // Pruning is best-effort and does not change the removal outcome.
    }
  }
}

/**
 * The `flow worktree create` command body (shared by CLI and tests): loads the
 * board config + run config, provisions the worktree, and records its path on
 * the ticket. Throws on an unknown ticket or a git failure.
 */
export function worktreeCreateCommand(
  boardRoot: string,
  env: NodeJS.ProcessEnv,
  id: number,
  branch: string,
): { path: string, ticket: Ticket } {
  const config = loadBoardConfig(boardRoot)
  const cfg = resolveRunConfig(env, boardRoot)
  readTicket(boardRoot, config, id) // throws 'Ticket <id> not found' before any git side-effect
  const path = createWorktree(cfg, id, branch)
  const ticket = setWorktree(boardRoot, config, id, { path })
  return { path, ticket }
}

/**
 * The `flow worktree remove` command body (shared by CLI and tests): removes
 * the worktree (best-effort) and clears the ticket's `worktree` field.
 */
export function worktreeRemoveCommand(boardRoot: string, env: NodeJS.ProcessEnv, id: number): Ticket {
  const config = loadBoardConfig(boardRoot)
  const cfg = resolveRunConfig(env, boardRoot)
  const ticket = readTicket(boardRoot, config, id)
  removeWorktree(cfg, id, ticket.worktree)
  return setWorktree(boardRoot, config, id, {})
}
