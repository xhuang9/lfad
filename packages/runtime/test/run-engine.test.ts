import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createTicket,
  moveTicket,
  readTicket,
  updateFrontmatter,
  type BoardConfig,
  type CreateTicketInput,
  type Step,
} from '@lfad/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createServer, parseQuestions, type RunningServer } from '../src/index.js'
import { readArtifacts } from '../src/artifacts.js'
import { resolveRunConfig } from '../src/run-config.js'
import { RunConflictError, RunManager, type RunEvent } from '../src/run-manager.js'
import { RunningRegistry } from '../src/running-registry.js'
import { decodeFakeArgv, fakeAdapter, makeFixtureBoard, makeFullFixtureBoard } from './helpers.js'
import { pluginPrefix } from '../src/manual.js'

/** Collects run events and lets a test await one matching a predicate. */
class EventBus {
  readonly events: RunEvent[] = []
  readonly #pending: { pred: (e: RunEvent) => boolean, resolve: (e: RunEvent) => void }[] = []

  readonly emit = (event: RunEvent): void => {
    this.events.push(event)
    for (let i = this.#pending.length - 1; i >= 0; i--) {
      const p = this.#pending[i]!
      if (p.pred(event)) {
        this.#pending.splice(i, 1)
        p.resolve(event)
      }
    }
  }

  wait(pred: (e: RunEvent) => boolean, timeoutMs = 8000): Promise<RunEvent> {
    const existing = this.events.find(pred)
    if (existing !== undefined) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for run event')), timeoutMs)
      this.#pending.push({
        pred,
        resolve: (e) => {
          clearTimeout(timer)
          resolve(e)
        },
      })
    })
  }
}

/** Creates a ticket and (optionally) moves it to a starting step. */
function seedTicket(
  boardRoot: string,
  config: BoardConfig,
  title: string,
  opts?: { body?: string, step?: Step, needsDesign?: boolean },
): number {
  const input: CreateTicketInput = { title, category: 'logic' }
  if (opts?.body !== undefined) input.body = opts.body
  if (opts?.needsDesign !== undefined) input.needsDesign = opts.needsDesign
  const created = createTicket(boardRoot, config, input)
  if (opts?.step !== undefined && opts.step !== created.status) {
    moveTicket(boardRoot, config, created.id, opts.step)
  }
  return created.id
}

function makeManager(
  boardRoot: string,
  config: BoardConfig,
  env: NodeJS.ProcessEnv = {},
): { rm: RunManager, bus: EventBus } {
  const cfg = resolveRunConfig(env, boardRoot)
  const bus = new EventBus()
  const rm = new RunManager({ boardRoot, cfg, getConfig: () => config, emit: bus.emit })
  return { rm, bus }
}

/** Awaits the fake agent's argv from the run-log stream and decodes it. */
async function waitForArgv(bus: EventBus): Promise<string[]> {
  const event = await bus.wait((e) => e.type === 'run-log' && e.line.startsWith('FAKE_ARGV_B64:'))
  return decodeFakeArgv((event as { line: string }).line)
}

/** Resolves once `process.kill(pid, 0)` reports the process gone (ESRCH). */
async function waitForDead(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`process ${pid} still alive after ${timeoutMs}ms`)
}

describe('RunManager (fake agent — no real claude)', () => {
  let boards: string[] = []

  afterEach(() => {
    for (const b of boards) rmSync(b, { recursive: true, force: true })
    boards = []
  })

  function fullBoard(): { root: string, config: BoardConfig } {
    const fixture = makeFullFixtureBoard()
    boards.push(fixture.root)
    return fixture
  }

  it('(a) advances the ticket one step on a clean FLOW_DONE run and stops at a gate', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Advance me') // starts at idea (first entry step)
    const { rm, bus } = makeManager(root, config)

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    // idea (agent) → next is shape, a human gate → moved there, then stops.
    expect(readTicket(root, config, id).status).toBe('shape')
  })

  it('(b) blocks the ticket when the agent emits FLOW_BLOCK', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Block me', { body: 'do work FAKE_BLOCK_TRIGGER now', step: 'doing' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'blocked')

    const ticket = readTicket(root, config, id)
    expect(ticket.status).toBe('blocked')
    expect(ticket.returnStep).toBe('doing')
    const block = readArtifacts(root, config, id).find((artifact) => artifact.name === 'blocked.md')
    expect(block).toBeDefined()
    expect(parseQuestions('blocked.md', block!.content)).toEqual([
      expect.objectContaining({
        file: 'blocked.md',
        open: true,
      }),
    ])
  })

  it('(b2) never blocks on sentinel docs quoted inside a stream-json tool result', async () => {
    const { root, config } = fullBoard()
    // The trap replays a tool_result whose payload contains a line-anchored
    // "FLOW_BLOCK: docs example question" — a skill file read back through the
    // stream. Only the agent's own assistant text may trip the scanner.
    const id = seedTicket(root, config, 'Read the docs', { body: 'FAKE_TOOLRESULT_TRAP', step: 'doing' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    expect(readTicket(root, config, id).status).not.toBe('blocked')
  })

  it('(b3) ignores a mid-line sentinel mention in the agent\'s own text (line-anchored)', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Discuss the protocol', { body: 'FAKE_MIDLINE_TRAP', step: 'doing' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    expect(readTicket(root, config, id).status).not.toBe('blocked')
  })

  it('(b4) a run with a step override pulls the ticket into that step first', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Pull me') // starts at idea
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id, { step: 'shape' })
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    const ticket = readTicket(root, config, id)
    expect(ticket.status).toBe('shape') // pulled in, ran there; a gate completes in place
    expect(ticket.history.map((h) => h.step)).toEqual(['idea', 'shape'])
  })

  it('(b5) an action-skill run references the skill and completes in place — the skill owns movement', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Action me', { step: 'doing' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id, { skill: 'my-check' })
    const argv = await waitForArgv(bus)
    expect(argv.join('\n')).toContain('Invoke the Skill "my-check"')
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    expect(readTicket(root, config, id).status).toBe('doing') // no engine advance
  })

  it('(b6) stopping a run kills the agent\'s whole process tree (grandchild dies)', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Spawns a grandchild', {
      body: 'FAKE_SPAWN_GRANDCHILD',
      step: 'doing',
    })
    // Near-zero grace so the SIGTERM→SIGKILL escalation never slows the test.
    const { rm, bus } = makeManager(root, config, {
      LFAD_AUTOPILOT: 'false',
      LFAD_RUN_KILL_GRACE_MS: '20',
    })

    rm.enqueue(id)
    const pidEvent = await bus.wait(
      (e) => e.type === 'run-log' && e.line.startsWith('FAKE_GRANDCHILD_PID:'),
    )
    const grandchildPid = Number.parseInt((pidEvent as { line: string }).line.split(':')[1]!.trim(), 10)
    expect(Number.isInteger(grandchildPid)).toBe(true)

    // The grandchild is running right now (no throw ⇒ it exists).
    expect(() => process.kill(grandchildPid, 0)).not.toThrow()

    const active = rm.list().find((r) => r.ticketId === id)
    expect(active).toBeDefined()
    rm.stop(active!.id)

    // The group kill must reap the grandchild, not just the direct child.
    await waitForDead(grandchildPid)
  })

  it('(c) refuses a second run while one is active for the same ticket', () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Busy ticket', { body: 'FAKE_SLEEP keep me running', step: 'doing' })
    const { rm } = makeManager(root, config)

    rm.enqueue(id)
    expect(() => rm.enqueue(id)).toThrow(RunConflictError)

    // Clean up the still-running child.
    const active = rm.list().find((r) => r.ticketId === id)
    if (active !== undefined) rm.stop(active.id)
  })

  it('(c2) refuses to spawn while a running-registry lease is held, then allows it after release', () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Leased ticket', { body: 'FAKE_SLEEP keep me running', step: 'doing' })
    const registry = new RunningRegistry({ ttlMs: 60_000 })
    const cfg = resolveRunConfig({ LFAD_AUTOPILOT: 'false' }, root)
    const bus = new EventBus()
    const rm = new RunManager({
      boardRoot: root,
      cfg,
      getConfig: () => config,
      emit: bus.emit,
      runningLease: (ticketId) => registry.holder(ticketId),
    })

    // A session holds the lease → the engine refuses and spawns nothing.
    const { token } = registry.claim(id, { label: 'session-a' })
    expect(() => rm.enqueue(id)).toThrow(RunConflictError)
    expect(() => rm.enqueue(id)).toThrow('session-a') // holder label is surfaced
    expect(rm.list()).toHaveLength(0) // nothing queued, no child spawned

    // Release the lease → enqueue works again.
    registry.release(id, token)
    const state = rm.enqueue(id)
    expect(state.ticketId).toBe(id)

    // Clean up the still-running child.
    const active = rm.list().find((r) => r.ticketId === id)
    if (active !== undefined) rm.stop(active.id)
  })

  it('(d) dry-run makes no code-repo commit; the engine never creates a worktree', async () => {
    const { root, config } = fullBoard()
    const codeRepo = mkdtempSync(join(tmpdir(), 'lfad-code-'))
    boards.push(codeRepo)
    execFileSync('git', ['-C', codeRepo, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', codeRepo, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', codeRepo, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })
    writeFileSync(join(codeRepo, 'README.md'), '# code\n')
    execFileSync('git', ['-C', codeRepo, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', codeRepo, 'commit', '-m', 'initial'], { stdio: 'ignore' })

    const commitCount = (): number =>
      Number.parseInt(
        execFileSync('git', ['-C', codeRepo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(),
        10,
      )
    const before = commitCount()

    const id = seedTicket(root, config, 'Code work', { step: 'doing' })
    const env: NodeJS.ProcessEnv = {
      LFAD_CODE_REPO: codeRepo,
      LFAD_DRY_RUN: 'true',
      LFAD_AUTOPILOT: 'false',
    }
    const cfg = resolveRunConfig(env, root)
    const bus = new EventBus()
    const rm = new RunManager({ boardRoot: root, cfg, getConfig: () => config, emit: bus.emit })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    expect(commitCount()).toBe(before) // the daemon committed nothing to the code repo
    expect(cfg.worktreeRoot).toBeDefined()
    expect(existsSync(join(cfg.worktreeRoot!, `t-${id}`))).toBe(false) // worktrees are skill-driven primitives now
  })

  it('resolves the step adapter and substitutes every placeholder per args token', async () => {
    const fixture = makeFixtureBoard({
      agents: {
        default: fakeAdapter(),
        special: fakeAdapter({
          args: [
            fakeAdapter().args[0]!,
            '{prompt}',
            '--model={model}',
            '--effort={effort}',
            '--ticket={ticketId}',
            '--step={step}',
            '--legacy={stage}',
            '--board={boardRoot}',
          ],
          model: 'sonnet',
          effort: 'low',
        }),
      },
      steps: [
        { key: 'doing', label: 'Doing', type: 'agent', agent: 'special', skill: 'flow:build', goal: 'Build it.' },
        { key: 'done', label: 'Done', type: 'terminal' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Adapter test')
    const { rm, bus } = makeManager(root, config)

    rm.enqueue(id)
    const argv = await waitForArgv(bus)

    // argv[0] is the substituted {prompt} (fake-agent.mjs drops node + script path).
    expect(argv[0]).toContain('agent-dashboard ticket')
    expect(argv[0]).toContain('Step goal: Build it.')
    expect(argv[0]).toContain(`Invoke the Skill "${pluginPrefix()}:build" for the full step playbook before working.`)
    expect(argv).toContain('--model=sonnet')
    expect(argv).toContain('--effort=low')
    expect(argv).toContain(`--ticket=${id}`)
    expect(argv).toContain('--step=doing')
    expect(argv).toContain('--legacy=doing') // {stage} stays a working alias of {step}
    expect(argv).toContain(`--board=${root}`)
    await bus.wait((e) => e.type === 'run-status' && e.status === 'done')
  })

  it('workflow: true prepends ultracode to the prompt text', async () => {
    const fixture = makeFixtureBoard({
      agents: { default: fakeAdapter({ workflow: true }) },
      steps: [
        { key: 'doing', label: 'Doing', type: 'agent' },
        { key: 'done', label: 'Done', type: 'terminal' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Workflow test')
    const { rm, bus } = makeManager(root, config)

    rm.enqueue(id)
    const argv = await waitForArgv(bus)
    expect(argv[0]!.startsWith('ultracode\n\n')).toBe(true)
    await bus.wait((e) => e.type === 'run-status' && e.status === 'done')
  })

  it('output: text adapters are scanned line-by-line for the same sentinels', async () => {
    const fixture = makeFixtureBoard({
      agents: { default: fakeAdapter({ output: 'text' }) },
      steps: [
        { key: 'doing', label: 'Doing', type: 'agent' },
        { key: 'checks', label: 'Checks', type: 'agent' },
        { key: 'done', label: 'Done', type: 'terminal' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Text mode', { body: 'plain text agent' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')
    expect(readTicket(root, config, id).status).toBe('checks')

    // FLOW_BLOCK also lands in text mode.
    const blockedId = seedTicket(root, config, 'Text block', { body: 'FAKE_BLOCK_TRIGGER' })
    rm.enqueue(blockedId)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === blockedId && e.status === 'blocked')
    expect(readTicket(root, config, blockedId).status).toBe('blocked')
  })

  it('autopilot passes THROUGH a queue step into the next step’s run', async () => {
    const fixture = makeFixtureBoard({
      steps: [
        { key: 'first', label: 'First', type: 'agent', entry: true },
        { key: 'waiting', label: 'Waiting', type: 'queue' },
        { key: 'second', label: 'Second', type: 'agent' },
        { key: 'approve', label: 'Approve', type: 'gate' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Queue pass-through')
    const { rm, bus } = makeManager(root, config)

    rm.enqueue(id)
    // The continuation run executes 'second' (having passed through 'waiting').
    await bus.wait((e) => e.type === 'run-status' && e.status === 'done' && e.step === 'second')

    const ticket = readTicket(root, config, id)
    expect(ticket.status).toBe('approve') // parked at the gate
    expect(ticket.history.map((h) => h.step)).toEqual(['first', 'waiting', 'second', 'approve'])
  })

  it('a manual Run on a ticket sitting in a queue step advances it and runs THAT step', async () => {
    const fixture = makeFixtureBoard({
      steps: [
        { key: 'waiting', label: 'Waiting', type: 'queue', entry: true },
        { key: 'work', label: 'Work', type: 'agent' },
        { key: 'later', label: 'Later', type: 'agent' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Manual from queue')
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    // The run advanced out of the queue, executed 'work', and (autopilot off)
    // the completion still moved the ticket one step — but spawned nothing more.
    const doneEvents = bus.events.filter((e) => e.type === 'run-status' && e.status === 'done')
    expect(doneEvents).toHaveLength(1)
    expect((doneEvents[0] as { step?: string }).step).toBe('work')
    expect(readTicket(root, config, id).status).toBe('later')
  })

  it('stops queue pass-through at an unmet dependency boundary without spawning work', async () => {
    const { root, config } = fullBoard()
    const prerequisite = seedTicket(root, config, 'Prerequisite', { step: 'doing' })
    const dependent = seedTicket(root, config, 'Held dependent', { step: 'todo' })
    updateFrontmatter(root, config, dependent, {
      dependencies: [{ ticketId: prerequisite, blockAtStage: 'doing', unblockWhen: 'done' }],
    })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(dependent)
    await bus.wait((event) => event.type === 'run-status' && event.ticketId === dependent && event.status === 'error')

    expect(readTicket(root, config, dependent).status).toBe('todo')
    expect(bus.events.some((event) => event.type === 'run-log' && event.ticketId === dependent)).toBe(false)
  })

  it('stops FLOW_DONE advancement at the same unmet dependency boundary', async () => {
    const { root, config } = fullBoard()
    const prerequisite = seedTicket(root, config, 'Prerequisite', { step: 'doing' })
    const dependent = seedTicket(root, config, 'Held after agent work')
    updateFrontmatter(root, config, dependent, {
      dependencies: [{ ticketId: prerequisite, blockAtStage: 'shape', unblockWhen: 'done' }],
    })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'true' })

    rm.enqueue(dependent)
    const event = await bus.wait((candidate) =>
      candidate.type === 'run-status' && candidate.ticketId === dependent && candidate.status === 'error',
    )

    expect(event).toMatchObject({ type: 'run-status', status: 'error', step: 'idea' })
    expect(readTicket(root, config, dependent).status).toBe('idea')
    expect(bus.events.some((candidate) => candidate.type === 'run-log' && candidate.ticketId === dependent)).toBe(true)
  })

  it('a run starting on a dead-end queue step errors instead of running', async () => {
    const fixture = makeFixtureBoard({
      steps: [
        { key: 'work', label: 'Work', type: 'agent', entry: true },
        { key: 'waiting', label: 'Waiting', type: 'queue' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Dead end', { step: 'waiting' })
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    const event = await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'error')
    expect(event.type).toBe('run-status')
    expect(readTicket(root, config, id).status).toBe('waiting')
  })

  it('nextStep skips a skipUnless step when the ticket flag is falsy (and keeps it when true)', async () => {
    const steps = [
      { key: 'start', label: 'Start', type: 'agent', entry: true },
      { key: 'design', label: 'Design', type: 'agent', skipUnless: 'needsDesign' },
      { key: 'build', label: 'Build', type: 'agent' },
      { key: 'approve', label: 'Approve', type: 'gate' },
    ]
    const plain = makeFixtureBoard({ steps })
    boards.push(plain.root)
    {
      const { root, config } = plain
      const id = seedTicket(root, config, 'No design needed')
      const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })
      rm.enqueue(id)
      await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')
      expect(readTicket(root, config, id).status).toBe('build') // design skipped
    }

    const flagged = makeFixtureBoard({ steps })
    boards.push(flagged.root)
    {
      const { root, config } = flagged
      const id = seedTicket(root, config, 'Design needed', { needsDesign: true })
      const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })
      rm.enqueue(id)
      await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')
      expect(readTicket(root, config, id).status).toBe('design') // flag set ⇒ not skipped
    }
  })

  it('a terminal step run completes in place (autopilot stops, nothing removed)', async () => {
    const { root, config } = fullBoard()
    const id = seedTicket(root, config, 'Finish line', { step: 'done' })
    const { rm, bus } = makeManager(root, config)

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')
    expect(readTicket(root, config, id).status).toBe('done')
  })

  it('per-line run logging survives the ticket folder moving mid-run (cached-dir fallback re-locates)', async () => {
    const fixture = makeFixtureBoard({
      steps: [
        { key: 'doing', label: 'Doing', type: 'agent', entry: true },
        { key: 'checks', label: 'Checks', type: 'agent' },
        { key: 'done', label: 'Done', type: 'terminal' },
      ],
    })
    boards.push(fixture.root)
    const { root, config } = fixture
    const id = seedTicket(root, config, 'Log across a move') // starts at doing
    const { rm, bus } = makeManager(root, config, { LFAD_AUTOPILOT: 'false' })

    rm.enqueue(id)
    await bus.wait((e) => e.type === 'run-status' && e.ticketId === id && e.status === 'done')

    // The clean FLOW_DONE advanced the ticket doing → checks; the folder rename
    // carried its log/ dir along, invalidating the dir cached at #startRun.
    const ticket = readTicket(root, config, id)
    expect(ticket.status).toBe('checks')

    const logPath = join(
      root,
      ticket.status,
      `${String(id).padStart(5, '0')}-${ticket.slug}`,
      'log',
      `${id}.ndjson`,
    )
    const records = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    // Fast path: per-line run-log entries were written straight to the cached
    // dir while the ticket still sat at doing.
    expect(records.some((r) => r.event === 'run-log')).toBe(true)
    // Fallback path: the final run-status 'done' line was appended AFTER the
    // folder was renamed to checks — it lands in this new-folder log ONLY
    // because the stale-cache fallback re-located the ticket instead of writing
    // to the vanished old dir.
    expect(records.some((r) => r.event === 'run-status' && r.status === 'done')).toBe(true)
  })
})

describe('run routes (HTTP wiring)', () => {
  let boardRoot: string
  let config: BoardConfig
  let server: RunningServer
  let base: string
  let ticketId: number

  beforeAll(async () => {
    const fixture = makeFullFixtureBoard('lfad-run-http-')
    boardRoot = fixture.root
    config = fixture.config
    ticketId = seedTicket(boardRoot, config, 'HTTP run', { body: 'FAKE_SLEEP stay active a moment' })
    const runConfig = resolveRunConfig({ LFAD_AUTOPILOT: 'false' }, boardRoot)
    server = await createServer({ boardRoot, runConfig }).start(0)
    base = `http://127.0.0.1:${server.port}`
    return async () => {
      await server.close()
      rmSync(boardRoot, { recursive: true, force: true })
    }
  })

  it('POST /run enqueues, GET /runs lists it, a second POST 409s, and stop works', async () => {
    const runRes = await fetch(`${base}/api/tickets/${ticketId}/run`, { method: 'POST' })
    expect(runRes.status).toBe(200)
    const { run } = (await runRes.json()) as { run: { id: string, ticketId: number, status: string } }
    expect(run.ticketId).toBe(ticketId)

    const listRes = await fetch(`${base}/api/runs`)
    const { runs } = (await listRes.json()) as { runs: { id: string, ticketId: number }[] }
    expect(runs.some((r) => r.id === run.id)).toBe(true)

    // A second run for the same ticket while one is active → 409.
    const conflict = await fetch(`${base}/api/tickets/${ticketId}/run`, { method: 'POST' })
    expect(conflict.status).toBe(409)

    const stopRes = await fetch(`${base}/api/runs/${run.id}/stop`, { method: 'POST' })
    expect(stopRes.status).toBe(200)
    expect((await stopRes.json()) as { ok: boolean }).toEqual({ ok: true })

    // Stopping an unknown run id → 404.
    const missing = await fetch(`${base}/api/runs/does-not-exist/stop`, { method: 'POST' })
    expect(missing.status).toBe(404)
  })

  it('POST /run on an unknown ticket id → 404', async () => {
    const res = await fetch(`${base}/api/tickets/999999/run`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
