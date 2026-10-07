/**
 * The run engine: a queue with an at-most-one active agent child.
 *
 * `enqueue(ticketId)` schedules a run; when a slot is free the manager derives
 * the ticket's step routing from the board config (`type`: agent/gate/queue/
 * terminal), builds the self-contained step prompt, resolves the step's
 * agent adapter (step `agent` → board `default` → built-in `claude -p`), and
 * spawns it with per-token placeholder substitution. It streams the child's
 * stdout line-by-line — each line becomes an SSE `run-log` event and a ticket
 * log entry — and scans for two text sentinels: `FLOW_BLOCK: <q>`
 * (→ `core.setBlocked`, stop) and `FLOW_DONE` (step complete → advance +
 * optional autopilot).
 *
 * Queue steps never run: a run starting on one advances the ticket to the
 * next step first (autopilot pass-through and a manual Run behave the same).
 * The child's cwd is `ticket.worktree ?? codeRepo ?? boardRoot`; worktree
 * creation/removal is a separate skill-driven primitive (see worktree.ts).
 *
 * Concurrency is capped at 1 for v1; extra runs wait in the queue. All ticket
 * state changes go through `@lfad/core`; this class owns only process and
 * queue lifecycle.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  adapterForStep,
  appendLog as coreAppendLog,
  appendLogAt as coreAppendLogAt,
  BLOCKED_DIR,
  dependencyHoldForMove as coreDependencyHoldForMove,
  isAgentStep,
  isGate,
  isQueue,
  isTerminal,
  listArchive as coreListArchive,
  listParked as coreListParked,
  moveTicket as coreMoveTicket,
  nextStep,
  readBoard as coreReadBoard,
  readTicket as coreReadTicket,
  setBlocked as coreSetBlocked,
  stepByKey,
  stepKeys,
  type AdapterOutput,
  type BoardConfig,
  type DependencyEvaluation,
  type Step,
  type Ticket,
} from '@lfad/core'

import { buildAdapterInvocation, extractAgentTexts } from './adapter.js'
import { readArtifacts } from './artifacts.js'
import { findFlowPluginDir, pluginPrefix } from './manual.js'
import { buildStepPrompt } from './prompt.js'
import type { RunConfig } from './run-config.js'

/** Lifecycle state of a single run. */
export type RunStatus = 'queued' | 'running' | 'blocked' | 'done' | 'error' | 'stopped'

/** Public, serializable view of one run (no child/timer internals). */
export interface RunState {
  id: string
  ticketId: number
  status: RunStatus
  /** ISO 8601 start time, set once the run leaves the queue. */
  startedAt?: string
  /** The step this run is executing. */
  step?: Step
}

/** A run lifecycle event broadcast over SSE. */
export type RunEvent =
  | { type: 'run-log', runId: string, ticketId: number, line: string }
  | { type: 'run-status', runId: string, ticketId: number, status: RunStatus, step?: Step }

/** Thrown by {@link RunManager.enqueue} when a run already exists for the ticket. */
export class RunConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunConflictError'
  }
}

/**
 * Consulted before an engine run is scheduled: returns the live running-registry
 * lease holder for a ticket (count + when + optional label), or `null` when no
 * session holds it. Injected so the engine can refuse to spawn a run on a ticket
 * an official agent session already owns via a cooperative lease.
 */
export type RunningLeaseProbe = (ticketId: number) => { count: number, claimedAt: string, label?: string } | null

/** The subset of `@lfad/core` the manager calls — injectable for tests. */
export interface CoreApi {
  readTicket: (root: string, config: BoardConfig, id: number) => Ticket
  readBoard: (root: string, config: BoardConfig) => Ticket[]
  listArchive: (root: string, config: BoardConfig) => Ticket[]
  listParked: (root: string, config: BoardConfig) => Ticket[]
  dependencyHoldForMove: (
    ticket: Ticket,
    targetStep: Step,
    liveTickets: readonly Ticket[],
    archivedTickets: readonly Ticket[],
    config: BoardConfig,
  ) => DependencyEvaluation
  moveTicket: (root: string, config: BoardConfig, id: number, toStep: Step, opts?: { reason?: string, actor?: string }) => Ticket
  setBlocked: (root: string, config: BoardConfig, id: number, payload: { question?: string }) => Ticket
  appendLog: (root: string, config: BoardConfig, id: number, entry: Record<string, unknown> | string) => void
  /** Dir-taking append: writes to an already-resolved ticket dir, no board scan. */
  appendLogAt: (dir: string, id: number, entry: Record<string, unknown> | string) => void
}

/** Dependencies for {@link RunManager}. `boardRoot` + `cfg` + `getConfig` are required. */
export interface RunManagerOptions {
  boardRoot: string
  cfg: RunConfig
  /** Live accessor for the parsed board config (hot-reload safe). */
  getConfig: () => BoardConfig
  /** Pushes a run event to subscribers (SSE). Defaults to a no-op. */
  emit?: (event: RunEvent) => void
  /** Called after a ticket state change so the index/board refreshes. Defaults to a no-op. */
  onBoardChanged?: () => void
  /** Consulted before spawning: the running-registry lease holder for a ticket, or null. Defaults to none. */
  runningLease?: RunningLeaseProbe
  /** Overrides for the core fns (tests). Defaults to the real `@lfad/core`. */
  core?: Partial<CoreApi>
}

/** Internal record: the public state plus the live child/timer and settle flags. */
interface RunRecord extends RunState {
  child?: ChildProcess
  timeout?: NodeJS.Timeout
  /** Set once a terminal transition (done/blocked/error/stopped) has been applied. */
  settled: boolean
  /** Set when FLOW_DONE was seen; consumed on child close to advance the step. */
  flowDone: boolean
  /** The spawned adapter's output mode — decides how sentinel text is extracted. */
  outputMode?: AdapterOutput
  /** Requested run step: the ticket is pulled into it before the run starts. */
  targetStep?: Step
  /** Action skill running in place — the engine never auto-advances such a run. */
  skillOverride?: string
  /**
   * The ticket's on-disk dir resolved once at {@link RunManager.#startRun}, so
   * every per-line log append writes straight to it instead of re-scanning the
   * board. Cleared when it goes stale (the ticket moved/was removed mid-run);
   * see {@link RunManager.#appendTicketLog}.
   */
  boardTicketDir?: string
}

/** Default core binding. */
const DEFAULT_CORE: CoreApi = {
  readTicket: coreReadTicket,
  readBoard: coreReadBoard,
  listArchive: coreListArchive,
  listParked: coreListParked,
  dependencyHoldForMove: coreDependencyHoldForMove,
  moveTicket: coreMoveTicket,
  setBlocked: coreSetBlocked,
  appendLog: coreAppendLog,
  appendLogAt: coreAppendLogAt,
}

/** Queue + at-most-one active agent child. See the module doc for the protocol. */
export class RunManager {
  readonly #boardRoot: string
  readonly #cfg: RunConfig
  readonly #getConfig: () => BoardConfig
  readonly #emit: (event: RunEvent) => void
  readonly #onBoardChanged: () => void
  readonly #runningLease: RunningLeaseProbe
  readonly #core: CoreApi

  #active: RunRecord | null = null
  #queue: RunRecord[] = []

  constructor(options: RunManagerOptions) {
    this.#boardRoot = options.boardRoot
    this.#cfg = options.cfg
    this.#getConfig = options.getConfig
    this.#emit = options.emit ?? (() => {})
    this.#onBoardChanged = options.onBoardChanged ?? (() => {})
    this.#runningLease = options.runningLease ?? (() => null)
    this.#core = { ...DEFAULT_CORE, ...options.core }
  }

  /**
   * Schedules a run for a ticket. Throws {@link RunConflictError} when a run is
   * already active or queued for that ticket, or when an official session holds
   * a live running-registry lease on it (the run route maps both to HTTP 409),
   * or a plain Error ("not found") when the ticket id is unknown. Starts the run
   * immediately if a slot is free.
   */
  enqueue(ticketId: number, opts?: { step?: Step, skill?: string }): RunState {
    if (this.#active?.ticketId === ticketId || this.#queue.some((r) => r.ticketId === ticketId)) {
      throw new RunConflictError(`A run is already active or queued for ticket ${ticketId}`)
    }
    // Refuse to spawn on a ticket an official agent session already holds via a
    // cooperative lease — the two concurrency mechanisms must not both drive it.
    const holder = this.#runningLease(ticketId)
    if (holder !== null) {
      const who = holder.label !== undefined ? `session "${holder.label}"` : 'a running session'
      throw new RunConflictError(
        `Ticket ${ticketId} is held by ${who} (claimed ${holder.claimedAt}); refusing to start an engine run`,
      )
    }
    try {
      this.#core.readTicket(this.#boardRoot, this.#getConfig(), ticketId)
    } catch {
      throw new Error(`Ticket ${ticketId} not found`)
    }
    return this.#toState(this.#queueRun(ticketId, false, opts?.step, opts?.skill))
  }

  /**
   * Stops a run: kills the active child or drops a queued record, marking it
   * `stopped`. Returns `{ ok: false }` when no run has that id.
   */
  stop(runId: string): { ok: boolean } {
    if (this.#active?.id === runId) {
      this.#finishRun(this.#active, 'stopped', undefined, true)
      return { ok: true }
    }
    const queued = this.#queue.find((r) => r.id === runId)
    if (queued !== undefined) {
      this.#finishRun(queued, 'stopped', undefined, false)
      return { ok: true }
    }
    return { ok: false }
  }

  /** Returns the active run (if any) followed by the queued runs, as plain state. */
  list(): RunState[] {
    const states: RunState[] = []
    if (this.#active !== null) states.push(this.#toState(this.#active))
    for (const record of this.#queue) states.push(this.#toState(record))
    return states
  }

  /** Creates a queued record (front for autopilot continuation, else back) and pumps. */
  #queueRun(ticketId: number, front: boolean, targetStep?: Step, skillOverride?: string): RunRecord {
    const record: RunRecord = {
      id: randomUUID(),
      ticketId,
      status: 'queued',
      settled: false,
      flowDone: false,
      ...(targetStep !== undefined ? { targetStep } : {}),
      ...(skillOverride !== undefined ? { skillOverride } : {}),
    }
    if (front) this.#queue.unshift(record)
    else this.#queue.push(record)
    this.#emitStatus(record)
    this.#pump()
    return record
  }

  /** Throws before any engine-owned move crosses an unresolved boundary. */
  #assertMoveAllowed(ticket: Ticket, targetStep: Step, config: BoardConfig): void {
    const state = this.#core.dependencyHoldForMove(
      ticket,
      targetStep,
      [...this.#core.readBoard(this.#boardRoot, config), ...this.#core.listParked(this.#boardRoot, config)],
      this.#core.listArchive(this.#boardRoot, config),
      config,
    )
    if (state.held) {
      throw new Error(
        `Ticket ${ticket.id} is held before '${state.resumesAt ?? targetStep}' by ${state.blockingTicketIds.map((id) => `#${id}`).join(', ')}`,
      )
    }
  }

  /** Starts the next queued run when no run is active. */
  #pump(): void {
    if (this.#active !== null) return
    const next = this.#queue.shift()
    if (next === undefined) return
    this.#active = next
    this.#startRun(next)
  }

  /**
   * Advances a ticket out of any queue step(s) it sits in (queue steps never
   * run — both autopilot pass-through and a manual Run land here), returning
   * the ticket at its first runnable step, or `undefined` after finishing the
   * run with an error (dead-end queue, move failure).
   */
  #passThroughQueues(record: RunRecord, config: BoardConfig, ticket: Ticket): Ticket | undefined {
    let current = ticket
    while (isQueue(config, current.status)) {
      const next = nextStep(config, current.status, current)
      if (next === undefined) {
        this.#finishRun(record, 'error', `queue step '${current.status}' has no next step to advance into`, false)
        return undefined
      }
      try {
        this.#assertMoveAllowed(current, next, config)
        current = this.#core.moveTicket(this.#boardRoot, config, record.ticketId, next, {
          reason: 'queue pass-through',
          actor: 'lfad-run',
        })
        this.#onBoardChanged()
      } catch (err) {
        this.#finishRun(record, 'error', err instanceof Error ? err.message : String(err), false)
        return undefined
      }
    }
    return current
  }

  /** Resolves the step + adapter, builds the prompt, and spawns the agent child. */
  #startRun(record: RunRecord): void {
    record.status = 'running'
    record.startedAt = new Date().toISOString()
    const config = this.#getConfig()

    let ticket: Ticket
    try {
      ticket = this.#core.readTicket(this.#boardRoot, config, record.ticketId)
    } catch {
      this.#finishRun(record, 'error', `Ticket ${record.ticketId} not found`, false)
      return
    }
    // A requested step pulls the ticket into it first (the drawer's skill
    // buttons: "run flow:plan on this idea ticket"). The route validates the
    // target (current or next applicable, never queue); the skill's own
    // pull-validate guards the semantics.
    if (record.targetStep !== undefined && record.targetStep !== ticket.status) {
      try {
        this.#assertMoveAllowed(ticket, record.targetStep, config)
        ticket = this.#core.moveTicket(this.#boardRoot, config, record.ticketId, record.targetStep, {
          reason: `run: pulled into ${record.targetStep}`,
          actor: 'lfad-run',
        })
        this.#onBoardChanged()
      } catch (err) {
        this.#finishRun(record, 'error', err instanceof Error ? err.message : String(err), false)
        return
      }
    }
    const passed = this.#passThroughQueues(record, config, ticket)
    if (passed === undefined) return
    ticket = passed
    const step = ticket.status
    record.step = step
    this.#emitStatus(record)

    const stepConfig = stepByKey(config, step)
    const boardTicketDir = this.#locateTicketDir(config, record.ticketId)
    // Cache the resolved dir so #handleLine appends every output line straight
    // to it (one readdir per run, not per line); #appendTicketLog re-locates
    // only when this goes stale.
    record.boardTicketDir = boardTicketDir
    const artifacts = readArtifacts(this.#boardRoot, config, record.ticketId)
    const prompt = buildStepPrompt(ticket, artifacts, step, stepConfig, this.#cfg, {
      worktreePath: ticket.worktree ?? null,
      skillPrefix: pluginPrefix(),
      ...(boardTicketDir !== undefined ? { boardTicketDir } : {}),
      ...(record.skillOverride !== undefined ? { skillOverride: record.skillOverride } : {}),
      ...(config.guidance !== undefined ? { boardGuidance: config.guidance } : {}),
    })
    const adapter = adapterForStep(config, step)
    const invocation = buildAdapterInvocation(adapter, prompt, {
      ticketId: record.ticketId,
      step,
      boardRoot: this.#boardRoot,
      pluginDir: findFlowPluginDir() ?? '',
    })
    record.outputMode = adapter.output
    const cwd = ticket.worktree ?? this.#cfg.codeRepo ?? this.#boardRoot

    let child: ChildProcess
    try {
      // `detached` makes the child a new process-group leader (its own session),
      // so on stop/timeout we can signal the WHOLE group (`-pid`) and take down
      // grandchildren the agent CLI spawns. stdio stays piped — detached only
      // changes the group/session, not the streams.
      child = spawn(invocation.cmd, invocation.args, { cwd, detached: true })
    } catch (err) {
      this.#finishRun(record, 'error', err instanceof Error ? err.message : String(err), false)
      return
    }
    record.child = child
    record.timeout = setTimeout(() => {
      this.#finishRun(record, 'error', 'timeout', true)
    }, this.#cfg.timeoutMs)

    // Every stdout/stderr line streams to the run log; sentinel scanning is
    // output-mode aware (see #handleLine) so quoted docs inside stream-json
    // tool results never trip FLOW_BLOCK/FLOW_DONE.
    this.#wireStream(record, child.stdout, false)
    this.#wireStream(record, child.stderr, true)

    child.on('error', (err: Error) => {
      this.#finishRun(record, 'error', err.message, false)
    })
    child.on('close', (code: number | null) => {
      if (record.settled) return
      if (record.flowDone) {
        this.#handleStepComplete(record)
      } else {
        this.#finishRun(record, 'error', `agent exited (${code ?? 'null'}) without FLOW_DONE`, false)
      }
    })
  }

  /** Buffers a stream into lines, forwarding each to {@link #handleLine}. */
  #wireStream(record: RunRecord, stream: NodeJS.ReadableStream | null, isStderr: boolean): void {
    if (stream === null) return
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk: string) => {
      buffer += chunk
      let idx = buffer.indexOf('\n')
      while (idx >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        this.#handleLine(record, line, isStderr)
        idx = buffer.indexOf('\n')
      }
    })
    stream.on('end', () => {
      if (buffer.length > 0) this.#handleLine(record, buffer, isStderr)
      buffer = ''
    })
  }

  /** Emits + logs one output line and scans it for the FLOW_BLOCK / FLOW_DONE sentinels. */
  #handleLine(record: RunRecord, raw: string, isStderr: boolean): void {
    if (record.settled) return
    const line = isStderr ? `[stderr] ${raw}` : raw
    this.#emit({ type: 'run-log', runId: record.id, ticketId: record.ticketId, line })
    this.#appendTicketLog(record, { event: 'run-log', runId: record.id, line })

    if (isStderr) return
    // Sentinels count ONLY in the agent's own text (per-mode extraction) and
    // ONLY at the start of their own line — the documented print contract.
    for (const text of extractAgentTexts(raw, record.outputMode ?? 'stream-json')) {
      for (const textLine of text.split('\n')) {
        const line = textLine.trim()
        const blockMatch = /^FLOW_BLOCK:\s*(.*)$/.exec(line)
        if (blockMatch !== null) {
          const question = blockMatch[1]!.trim() || 'Agent requested a decision'
          this.#finishRun(record, 'blocked', question, true)
          return
        }
        if (/^FLOW_DONE$/.test(line)) record.flowDone = true
      }
    }
  }

  /**
   * Applies a terminal transition (blocked/error/stopped), optionally killing
   * the child's whole process tree, persisting the block, and starting the next
   * queued run.
   */
  #finishRun(record: RunRecord, status: RunStatus, detail: string | undefined, kill: boolean): void {
    if (record.settled) return
    record.settled = true
    if (record.timeout !== undefined) clearTimeout(record.timeout)
    if (kill && record.child !== undefined) this.#killTree(record.child)
    record.status = status

    if (status === 'blocked') {
      try {
        this.#core.setBlocked(this.#boardRoot, this.#getConfig(), record.ticketId, { question: detail })
        this.#onBoardChanged()
      } catch {
        // setBlocked failed (ticket gone); the run still ends.
      }
    }
    this.#logStatus(record, detail)
    this.#emitStatus(record)
    this.#finalize(record)
  }

  /**
   * Kills the agent child AND every grandchild it spawned. The child leads its
   * own process group (spawned `detached`), so we signal the whole group
   * (`-pid`): SIGTERM first, then — after a short grace — SIGKILL. Each group
   * signal falls back to a direct child SIGKILL if the group call throws. The
   * delayed SIGKILL is skipped once the child has actually exited, which keeps
   * an already-settled record from outliving its child and removes any
   * PID-reuse hazard.
   */
  #killTree(child: ChildProcess): void {
    const pid = child.pid
    if (pid === undefined) return
    if (child.exitCode !== null || child.signalCode !== null) return

    let exited = false
    child.once('exit', () => {
      exited = true
    })

    if (!this.#killGroup(pid, 'SIGTERM')) {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
      return
    }

    const timer = setTimeout(() => {
      if (exited || child.exitCode !== null || child.signalCode !== null) return
      if (!this.#killGroup(pid, 'SIGKILL')) {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
    }, this.#cfg.killGraceMs)
    // Never let the grace timer keep the process alive on its own.
    timer.unref()
  }

  /** Signals the child's whole process group (`-pid`); false when the call throws. */
  #killGroup(pid: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(-pid, signal)
      return true
    } catch {
      return false
    }
  }

  /**
   * Handles a clean FLOW_DONE: gate and terminal steps stop in place; every
   * other step advances one step (skipping `skipUnless` steps) and, under
   * autopilot, continues into the next agent or queue step.
   */
  #handleStepComplete(record: RunRecord): void {
    if (record.settled) return
    record.settled = true
    if (record.timeout !== undefined) clearTimeout(record.timeout)

    const config = this.#getConfig()
    const step = record.step
    let ticket: Ticket
    try {
      ticket = this.#core.readTicket(this.#boardRoot, config, record.ticketId)
    } catch {
      record.status = 'error'
      this.#logStatus(record, 'ticket not found on completion')
      this.#emitStatus(record)
      this.#finalize(record)
      return
    }

    // An action-skill run owns its own movement (the skill's written rules
    // decide) — the engine never advances it.
    if (record.skillOverride !== undefined) {
      this.#completeInPlace(record)
      return
    }

    // A gate step's run produced its draft artifact; stop and wait for the user.
    // Terminal steps have no successor — autopilot stops (worktree cleanup is
    // a skill's call now, never the engine's).
    if (step !== undefined && (isGate(config, step) || isTerminal(config, step))) {
      this.#completeInPlace(record)
      return
    }

    const next = step !== undefined ? nextStep(config, step, ticket) : undefined
    if (next === undefined) {
      this.#completeInPlace(record)
      return
    }

    try {
      this.#assertMoveAllowed(ticket, next, config)
      this.#core.moveTicket(this.#boardRoot, config, record.ticketId, next, {
        reason: 'autopilot: step complete',
        actor: 'lfad-run',
      })
      this.#onBoardChanged()
    } catch (err) {
      record.status = 'error'
      this.#logStatus(record, err instanceof Error ? err.message : String(err))
      this.#emitStatus(record)
      this.#finalize(record)
      return
    }

    record.status = 'done'
    this.#logStatus(record)
    this.#emitStatus(record)
    // Autopilot continues into agent steps and THROUGH queue steps (the
    // continuation run advances out of the queue when its slot frees).
    const continues = this.#cfg.autopilot && (isAgentStep(config, next) || isQueue(config, next))
    this.#finalize(record, continues ? record.ticketId : undefined)
  }

  /** Marks a run done without advancing the ticket (gate / terminal stop). */
  #completeInPlace(record: RunRecord): void {
    record.status = 'done'
    this.#logStatus(record)
    this.#emitStatus(record)
    this.#finalize(record)
  }

  /** Clears the slot, optionally queues an autopilot continuation, and pumps. */
  #finalize(record: RunRecord, continueTicketId?: number): void {
    if (this.#active === record) this.#active = null
    else this.#queue = this.#queue.filter((r) => r !== record)
    if (continueTicketId !== undefined && this.#cfg.autopilot) this.#queueRun(continueTicketId, true)
    this.#pump()
  }

  /** Persists a run-status line to the ticket log (best-effort). */
  #logStatus(record: RunRecord, detail?: string): void {
    this.#appendTicketLog(record, {
      event: 'run-status',
      runId: record.id,
      status: record.status,
      ...(record.step !== undefined ? { step: record.step } : {}),
      ...(detail !== undefined ? { detail } : {}),
    })
  }

  /**
   * Appends one record to the ticket log, preferring the dir cached at
   * {@link #startRun} — a single write, no board scan. Falls back to the
   * board-scanning {@link CoreApi.appendLog} when there is no cached dir, the
   * cached dir has vanished (the ticket moved/was removed mid-run: a rename
   * leaves the old path gone), or the dir-based append throws. On a stale cache
   * the entry lands via the locate path (which finds the ticket's new home) and
   * the cache is cleared so later lines skip the dead dir. Never throws — a
   * fully-vanished ticket folder is swallowed (a log failure must never crash a
   * run; the SSE event has already fired).
   */
  #appendTicketLog(record: RunRecord, entry: Record<string, unknown> | string): void {
    const dir = record.boardTicketDir
    if (dir !== undefined && existsSync(dir)) {
      try {
        this.#core.appendLogAt(dir, record.ticketId, entry)
        return
      } catch {
        record.boardTicketDir = undefined // dir went bad; fall through to re-locate.
      }
    } else if (dir !== undefined) {
      record.boardTicketDir = undefined // cached dir vanished (ticket moved).
    }
    try {
      this.#core.appendLog(this.#boardRoot, this.#getConfig(), record.ticketId, entry)
    } catch {
      // ticket folder vanished mid-run; keep streaming to SSE regardless.
    }
  }

  /** Broadcasts the current run status over SSE. */
  #emitStatus(record: RunRecord): void {
    this.#emit({
      type: 'run-status',
      runId: record.id,
      ticketId: record.ticketId,
      status: record.status,
      ...(record.step !== undefined ? { step: record.step } : {}),
    })
  }

  /** Locates a ticket's on-disk folder by scanning the step folders for `<id>-…`. */
  #locateTicketDir(config: BoardConfig, id: number): string | undefined {
    for (const folder of [...stepKeys(config), BLOCKED_DIR]) {
      const parent = join(this.#boardRoot, folder)
      let entries: string[]
      try {
        entries = readdirSync(parent)
      } catch {
        continue
      }
      for (const name of entries) {
        const match = /^(\d+)-/.exec(name)
        if (match !== null && Number.parseInt(match[1]!, 10) === id) return join(parent, name)
      }
    }
    return undefined
  }

  /** Strips the internal fields, returning the serializable run state. */
  #toState(record: RunRecord): RunState {
    const state: RunState = { id: record.id, ticketId: record.ticketId, status: record.status }
    if (record.startedAt !== undefined) state.startedAt = record.startedAt
    if (record.step !== undefined) state.step = record.step
    return state
  }
}
