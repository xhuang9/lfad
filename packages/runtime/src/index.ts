/**
 * @lfad/runtime — the daemon factory.
 *
 * {@link createServer} loads the board's `board.yml` (fail-fast: an invalid or
 * disk-mismatched config refuses to start), wires together the in-memory
 * {@link BoardIndex}, a chokidar watcher over the board root, the SSE fan-out
 * hub, and the Hono app, and returns a handle whose `start(port)` boots the
 * HTTP server. A `board.yml` edit hot-reloads the config (revalidate → swap →
 * rebuild index → SSE `config-changed` + `board-changed`); an INVALID edit
 * keeps the previous config and logs the error — the daemon never crashes on a
 * bad edit. All ticket reads/mutations go through `@lfad/core`.
 */

import { basename, join, sep } from 'node:path'

import { loadBoardConfig, BOARD_CONFIG_FILE, type BoardConfig } from '@lfad/core'
import { serve, type ServerType } from '@hono/node-server'
import { watch, type FSWatcher } from 'chokidar'

import { buildApp } from './app.js'
import { BoardIndex } from './board-index.js'
import { resolveRunConfig, type RunConfig } from './run-config.js'
import { RunManager } from './run-manager.js'
import { RunningRegistry, type RunningRegistryOptions } from './running-registry.js'
import { SseHub } from './sse.js'

export type { Artifact } from './artifacts.js'
export { countManualTasks, MANUAL_TASKS_FILE, orderManualTasks, parseManualTasks, parseTicketManualTasks } from './manual-tasks.js'
export type { ManualTaskCounts, ManualTaskInfo } from './manual-tasks.js'
export type { StepPayload } from './labels.js'
export { countOpenInputs, parseQuestions, parseTicketQuestions } from './questions.js'
export type { QuestionInfo, QuestionType } from './questions.js'
export { BoardIndex } from './board-index.js'
export { SseHub } from './sse.js'
export { buildAdapterInvocation } from './adapter.js'
export type { AdapterInvocation, AdapterRunContext } from './adapter.js'
export { resolveRunConfig } from './run-config.js'
export type { RunConfig } from './run-config.js'
export { RunConflictError, RunManager } from './run-manager.js'
export type { RunEvent, RunState, RunStatus } from './run-manager.js'
export { RunningConflictError, RunningRegistry } from './running-registry.js'
export type { RunningClaim, RunningRegistryOptions, RunningSnapshot } from './running-registry.js'
export { createCommand, moveCommand, noteCommand, parseTags, renderShow, showCommand } from './ticket-commands.js'
export type { CreateCommandInput, NoteCommandInput, ShowResult } from './ticket-commands.js'
export { ensureBoardGitignore, findToolUiDist, resolveUiDir, toolUiDistFromHere } from './ui-dir.js'
export { createWorktree, removeWorktree, worktreeCreateCommand, worktreeRemoveCommand } from './worktree.js'
export { computeNextVersion, parseCommits, renderChangelogSection } from './release.js'
export type { ReleaseCommit } from './release.js'

/** Options accepted by {@link createServer}. */
export interface CreateServerOptions {
  /** Absolute path to the board root (the folder containing the step folders). */
  boardRoot: string
  /** Optional absolute path to a built UI to static-serve at `/`. */
  uiDir?: string
  /** Absolute path where the Document step writes chunks (default `<board>/chunks`). */
  docsChunksDir?: string
  /** Absolute path where the Document step writes session docs (default `<board>/session`). */
  docsSessionsDir?: string
  /** Run-engine config; defaults to `resolveRunConfig(process.env, boardRoot)`. */
  runConfig?: RunConfig
  /** Lease settings override, primarily for deterministic tests. */
  runningRegistry?: Partial<RunningRegistryOptions> & { sweepIntervalMs?: number }
}

/** A running daemon: the bound port and a graceful shutdown function. */
export interface RunningServer {
  port: number
  close: () => Promise<void>
}

/** Handle returned by {@link createServer}; call `start(port)` to boot. */
export interface DashboardServer {
  start: (port: number) => Promise<RunningServer>
}

/**
 * Creates a chokidar watcher over the board root that ignores any dot-prefixed
 * entry under the board root (machinery by convention: `.git`, `.ui`, an
 * in-board `.lfad` (or `.hitloop`) tool install — step keys can never start with a dot),
 * any `log/` directory, and atomic-write `.tmp` files, debouncing bursts of
 * filesystem events into a single `onChange` call (~100ms). Whether the burst
 * touched `board.yml` is flagged so the caller can hot-reload the config.
 */
function createWatcher(boardRoot: string, onChange: (configChanged: boolean) => void): FSWatcher {
  const rootPrefix = boardRoot + sep
  const watcher = watch(boardRoot, {
    ignoreInitial: true,
    ignored: (path: string) => {
      if (path.endsWith('.tmp') || /[/\\]log[/\\]/.test(path)) return true
      if (!path.startsWith(rootPrefix)) return false
      return path
        .slice(rootPrefix.length)
        .split(/[/\\]/)
        .some(segment => segment.startsWith('.'))
    },
  })
  let timer: NodeJS.Timeout | undefined
  let configChanged = false
  watcher.on('all', (_event, path) => {
    if (typeof path === 'string' && basename(path) === BOARD_CONFIG_FILE) configChanged = true
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      const flag = configChanged
      configChanged = false
      onChange(flag)
    }, 100)
  })
  return watcher
}

/** Tears down the watcher, SSE subscribers, and HTTP server in order. */
async function shutdown(server: ServerType, watcher: FSWatcher, sse: SseHub, runningSweep: NodeJS.Timeout): Promise<void> {
  clearInterval(runningSweep)
  sse.closeAll()
  await watcher.close()
  if (typeof (server as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
    ;(server as { closeAllConnections: () => void }).closeAllConnections()
  }
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

/**
 * Creates a dashboard daemon for `boardRoot`. The board config and index are
 * loaded eagerly from disk at construction (throwing on an invalid board.yml);
 * the watcher and HTTP server start on `start()`.
 *
 * @example
 * const server = createServer({ boardRoot: '/path/to/board' })
 * const { port, close } = await server.start(4319)
 */
export function createServer(options: CreateServerOptions): DashboardServer {
  const { boardRoot, uiDir } = options
  const docsChunksDir = options.docsChunksDir ?? join(boardRoot, 'chunks')
  const docsSessionsDir = options.docsSessionsDir ?? join(boardRoot, 'session')

  // Fail fast: an unparseable board.yml or a disk directory holding tickets
  // outside the config refuses to start (anti silent-ticket-loss).
  let config: BoardConfig
  try {
    config = loadBoardConfig(boardRoot)
  } catch (err) {
    throw new Error(
      `The dashboard cannot start — board config error.\n${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const getConfig = (): BoardConfig => config

  const index = new BoardIndex(boardRoot, getConfig)
  index.rebuild()
  const sse = new SseHub()
  const runningRegistry = new RunningRegistry({
    ttlMs: options.runningRegistry?.ttlMs ?? 10 * 60 * 1000,
    ...(options.runningRegistry?.now !== undefined ? { now: options.runningRegistry.now } : {}),
    onChange: () => sse.broadcast(),
  })
  const runningSweep = setInterval(() => runningRegistry.sweep(), options.runningRegistry?.sweepIntervalMs ?? 30_000)
  runningSweep.unref()
  const runConfig = options.runConfig ?? resolveRunConfig(process.env, boardRoot)
  const runManager = new RunManager({
    boardRoot,
    cfg: runConfig,
    getConfig,
    emit: (event) => sse.emit(event),
    onBoardChanged: () => {
      index.rebuild()
      sse.broadcast()
    },
    // Refuse an engine run on a ticket an official session already leases.
    runningLease: (id) => runningRegistry.holder(id),
  })
  // The bound port is only known once the server starts; expose it lazily so the
  // /api/info handler (built before start) can report it at request time.
  let boundPort = 0
  const app = buildApp({
    boardRoot,
    uiDir,
    docsChunksDir,
    docsSessionsDir,
    getConfig,
    index,
    sse,
    runManager,
    runningRegistry,
    runConfig,
    getPort: () => boundPort,
  })

  return {
    start(port: number): Promise<RunningServer> {
      return new Promise<RunningServer>((resolve, reject) => {
        const watcher = createWatcher(boardRoot, (configChanged) => {
          if (configChanged) {
            try {
              config = loadBoardConfig(boardRoot)
              sse.emit({ type: 'config-changed' })
            } catch (err) {
              // A bad edit never crashes the daemon: keep the previous config.
              console.error(
                `board.yml reload failed — keeping the previous config: `
                + `${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }
          index.rebuild()
          sse.broadcast()
        })
        let started = false
        const server = serve({ fetch: app.fetch, port }, (info) => {
          started = true
          boundPort = info.port
          resolve({
            port: info.port,
            close: () => shutdown(server, watcher, sse, runningSweep),
          })
        })
        // serve() surfaces listen failures (e.g. EADDRINUSE) only as an 'error'
        // event; without this the promise never settles and the event crashes
        // the process. Reject readably and undo what start() already set up.
        server.on('error', (err: NodeJS.ErrnoException) => {
          if (started) return // post-listen errors are not start() failures
          clearInterval(runningSweep)
          sse.closeAll()
          void watcher.close()
          reject(err.code === 'EADDRINUSE'
            ? new Error(`port ${port} is already in use — is another daemon serving this board?`)
            : (err instanceof Error ? err : new Error(String(err))))
        })
      })
    },
  }
}
