/**
 * Resolves the run engine's host-machine configuration from environment
 * variables. Everything agent-related (which CLI to spawn, its args, model,
 * effort) lives in the board's `board.yml` `agents` section — NOT here. The
 * env only carries what is machine-specific: the code repo, worktree root,
 * dry-run/autopilot posture, and the per-run wall-clock cap.
 *
 * BREAKING (config-driven steps): `HITLOOP_AGENT_CMD` and
 * `HITLOOP_PERMISSION_MODE` were removed — adapters in `board.yml` replace
 * them (a permission flag goes into an adapter's args template).
 */

import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { withLegacyEnv } from '@lfad/core'

/** Fully-resolved host configuration for one daemon's run engine. */
export interface RunConfig {
  /** Absolute path to the git repo the agent edits; unset ⇒ doc/dry-run only, no worktree. */
  codeRepo?: string
  /** Where per-ticket worktrees are created (default {@link defaultWorktreeRoot}). */
  worktreeRoot?: string
  /** When true the daemon makes no code-repo commit and tells the agent not to commit. */
  dryRun: boolean
  /** When true a clean step completion advances + auto-runs the next agent-work step. */
  autopilot: boolean
  /** Hard per-run wall-clock limit in ms; on timeout the child is killed and the run errors. */
  timeoutMs: number
  /** Grace between SIGTERM and SIGKILL when tearing down the agent's process group. */
  killGraceMs: number
}

/** Default per-run wall-clock limit (10 minutes). */
const DEFAULT_TIMEOUT_MS = 600000

/** Default grace before escalating a process-group SIGTERM to SIGKILL (2 seconds). */
const DEFAULT_KILL_GRACE_MS = 2000

/**
 * Parses a boolean-ish env string. Unset or empty ⇒ `fallback`; otherwise only
 * the explicit negatives (`false`/`0`/`no`/`off`) flip it false.
 */
function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  const t = value.trim().toLowerCase()
  if (t === '') return fallback
  return !(t === 'false' || t === '0' || t === 'no' || t === 'off')
}

/**
 * Resolves a possibly-relative env path to absolute (relative paths resolve
 * against `base`), or `undefined` when unset/empty.
 */
function resolvePath(value: string | undefined, base: string): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return isAbsolute(trimmed) ? trimmed : resolve(base, trimmed)
}

/**
 * Worktrees sit beside the code repo in `.lfad-worktrees`. A repo that already
 * has a `.hitloop-worktrees` folder from before the rename keeps using it.
 */
export function defaultWorktreeRoot(codeRepo: string): string {
  const legacy = resolve(codeRepo, '..', '.hitloop-worktrees')
  return existsSync(legacy) ? legacy : resolve(codeRepo, '..', '.lfad-worktrees')
}

/**
 * Builds a {@link RunConfig} from an environment bag. Pure: no process, no I/O.
 * Relative `LFAD_CODE_REPO` / `LFAD_WORKTREE_ROOT` paths resolve against
 * `boardRoot` so the result is deterministic in tests (independent of cwd).
 *
 * @param rawEnv - the environment to read (`process.env` in production). Legacy
 *   `HITLOOP_*` names are still read when the `LFAD_*` name is unset.
 * @param boardRoot - absolute board root, used as the base for relative paths.
 */
export function resolveRunConfig(rawEnv: NodeJS.ProcessEnv, boardRoot: string): RunConfig {
  const env = withLegacyEnv(rawEnv)
  const codeRepo = resolvePath(env.LFAD_CODE_REPO, boardRoot)
  let worktreeRoot = resolvePath(env.LFAD_WORKTREE_ROOT, boardRoot)
  if (worktreeRoot === undefined && codeRepo !== undefined) {
    worktreeRoot = defaultWorktreeRoot(codeRepo)
  }

  const timeout = Number(env.LFAD_RUN_TIMEOUT_MS)
  const killGrace = Number(env.LFAD_RUN_KILL_GRACE_MS)

  const config: RunConfig = {
    dryRun: parseBool(env.LFAD_DRY_RUN, true),
    autopilot: parseBool(env.LFAD_AUTOPILOT, true),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
    killGraceMs: Number.isFinite(killGrace) && killGrace >= 0 ? killGrace : DEFAULT_KILL_GRACE_MS,
  }
  if (codeRepo !== undefined) config.codeRepo = codeRepo
  if (worktreeRoot !== undefined) config.worktreeRoot = worktreeRoot
  return config
}
