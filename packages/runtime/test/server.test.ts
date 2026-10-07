import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BOARD_CONFIG_FILE, loadBoardConfig, writeBoardConfig, type Ticket } from '@lfad/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { StepPayload } from '../src/labels.js'
import { createServer, type RunningServer } from '../src/index.js'
import { buildStepPrompt } from '../src/prompt.js'
import { seedBoard } from '../src/seed.js'

/** Polls `check` until truthy or the deadline passes. */
async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

describe('@lfad/runtime server (default seeded board)', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-runtime-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('GET /api/steps returns the config-derived payload in board order, blocked appended', async () => {
    const res = await fetch(`${base}/api/steps`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { steps: StepPayload[] }
    expect(body.steps.map((s) => s.key)).toEqual([
      'idea', 'research', 'interview', 'mock', 'design', 'todo', 'doing', 'review', 'done', 'blocked',
    ])
    expect(body.steps[0]).toEqual({
      key: 'idea',
      label: 'Idea',
      folder: 'idea',
      lateral: false,
      type: 'agent',
      row: 'needs-you',
      position: 0,
      entry: true,
      skill: 'lfad:idea',
      actions: ['lfad:next'],
    })
    expect(body.steps[1]).toMatchObject({ key: 'research', type: 'agent', row: 'agents', position: 1, entry: false })
    expect(body.steps[2]).toMatchObject({ key: 'interview', type: 'gate', row: 'needs-you', position: 2 })
    expect(body.steps[3]).toMatchObject({ key: 'mock', type: 'gate', row: 'needs-you', position: 3, skipUnless: 'needsDesign' })
    expect(body.steps[4]).toMatchObject({ key: 'design', type: 'gate', row: 'needs-you', position: 4, skipUnless: 'needsDesign' })
    expect(body.steps[6]).toMatchObject({ key: 'doing', type: 'agent', position: 6 })
    expect(body.steps[7]).toMatchObject({ key: 'review', type: 'gate', row: 'needs-you', position: 7 })
    expect(body.steps[8]).toMatchObject({ key: 'done', type: 'terminal', position: 8 })
    expect(body.steps.at(-1)).toMatchObject({ key: 'blocked', label: 'Blocked', lateral: true, row: 'needs-you' })
  })

  it('GET /api/stages stays a deprecated alias serving the same payload', async () => {
    const steps = ((await (await fetch(`${base}/api/steps`)).json()) as { steps: StepPayload[] }).steps
    const res = await fetch(`${base}/api/stages`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stages: StepPayload[] }
    expect(body.stages).toEqual(steps)
  })

  it('GET /api/health reports ok', async () => {
    const res = await fetch(`${base}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/skills rejects traversal in the key lookup', async () => {
    // `flow:../skills/move` would reach a real SKILL.md through `..` — the
    // key's folder part must stay one safe segment, whatever exists on disk.
    for (const key of ['flow:../skills/move', 'flow:..', '../move', '.hidden']) {
      const res = await fetch(`${base}/api/skills?key=${encodeURIComponent(key)}`)
      expect(res.status).toBe(404)
    }
  })

  it('start() rejects readably when the port is already in use', async () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'lfad-eaddr-'))
    seedBoard(otherRoot)
    try {
      await expect(createServer({ boardRoot: otherRoot }).start(server.port)).rejects.toThrow(/already in use/)
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  it('GET /api/board returns the seeded tickets (idea / doing / done)', async () => {
    const res = await fetch(`${base}/api/board`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tickets: Ticket[] }
    expect(body.tickets).toHaveLength(3)
    expect(new Set(body.tickets.map((t) => t.status))).toEqual(new Set(['idea', 'doing', 'done']))
  })

  it('GET /api/archive returns the read-only archived-ticket collection', async () => {
    const res = await fetch(`${base}/api/archive`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ tickets: [] })
  })

  it('GET /api/tickets/:id returns the ticket and its artifacts', async () => {
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    const doing = board.tickets.find((t) => t.status === 'doing')!
    const res = await fetch(`${base}/api/tickets/${doing.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket, artifacts: { name: string, content: string }[] }
    expect(body.ticket.id).toBe(doing.id)
    expect(body.artifacts.some((a) => a.name === 'Idea')).toBe(true)
    expect(body.artifacts.some((a) => a.name === 'plan.md')).toBe(true)
  })

  it('projects manual tasks into detail and board payloads and refreshes them after a conditional rewrite', async () => {
    const created = (await (await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Human setup', category: 'logic' }),
    })).json()) as { ticket: Ticket }
    const pending = [
      '# Manual tasks',
      '',
      '```manual-task',
      'id: vercel-env',
      'service: Vercel',
      'title: Add production secret',
      'goal: Configure the deployed runtime',
      'steps:',
      '  - Open Settings',
      'done: false',
      '```',
      '',
    ].join('\n')
    const wrote = await fetch(`${base}/api/tickets/${created.ticket.id}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'manual-tasks.md', content: pending }),
    })
    expect(wrote.status).toBe(200)
    const detail = (await wrote.json()) as { manualTasks: { id: string, done: boolean, doneLine: number }[] }
    expect(detail.manualTasks).toEqual([expect.objectContaining({ id: 'vercel-env', done: false, doneLine: 9 })])

    const board = (await (await fetch(`${base}/api/board`)).json()) as {
      tickets: (Ticket & { manualTasks: { total: number, pending: number } })[]
    }
    expect(board.tickets.find((ticket) => ticket.id === created.ticket.id)?.manualTasks).toEqual({ total: 1, pending: 1 })

    const complete = pending.replace('done: false', 'done: true')
    const completed = await fetch(`${base}/api/tickets/${created.ticket.id}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'manual-tasks.md', content: complete, baseContent: pending }),
    })
    expect(completed.status).toBe(200)
    expect(((await completed.json()) as { manualTasks: { done: boolean }[] }).manualTasks[0]?.done).toBe(true)

    const stale = await fetch(`${base}/api/tickets/${created.ticket.id}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'manual-tasks.md', content: pending, baseContent: pending }),
    })
    expect(stale.status).toBe(409)
  })

  it('POST /api/tickets creates a ticket at the board entry step (idea)', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test ticket', category: 'logic', body: 'A test idea.' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.title).toBe('Test ticket')
    expect(body.ticket.status).toBe('idea')
    expect(body.ticket.category).toBe('logic')
  })

  it('POST /api/tickets accepts the hotfix category', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Emergency patch', category: 'hotfix' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.category).toBe('hotfix')
  })

  it('POST /api/tickets accepts an explicit entry-flagged entryStep', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Straight to idea', category: 'logic', entryStep: 'idea' }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { ticket: Ticket }).ticket.status).toBe('idea')
  })

  it('POST /api/tickets rejects a valid step that is not entry-flagged with 400', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Sneaking into doing', category: 'logic', entryStep: 'doing' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/entry step/i)
  })

  it('POST /api/tickets/:id/move changes the ticket step and is reflected on the board', async () => {
    const created = (await (
      await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Movable ticket', category: 'ui' }),
      })
    ).json()) as { ticket: Ticket }

    const moveRes = await fetch(`${base}/api/tickets/${created.ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'doing', reason: 'ready to start' }),
    })
    expect(moveRes.status).toBe(200)
    const moved = (await moveRes.json()) as { ticket: Ticket }
    expect(moved.ticket.status).toBe('doing')

    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    const onBoard = board.tickets.find((t) => t.id === created.ticket.id)
    expect(onBoard?.status).toBe('doing')
  })

  it('POST /api/tickets/:id/move accepts the legacy toStage field', async () => {
    const created = (await (
      await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Legacy mover', category: 'logic' }),
      })
    ).json()) as { ticket: Ticket }

    const moveRes = await fetch(`${base}/api/tickets/${created.ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStage: 'todo' }),
    })
    expect(moveRes.status).toBe(200)
    expect(((await moveRes.json()) as { ticket: Ticket }).ticket.status).toBe('todo')
  })

  it('POST /api/tickets/:id/move rejects a step outside the config with 400', async () => {
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    const res = await fetch(`${base}/api/tickets/${board.tickets[0]!.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'nonexistent-step' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/tickets/:id/move with batch:true rejects tickets that are not batch-runnable, while a named run is unaffected', async () => {
    const create = async (title: string, category = 'logic'): Promise<Ticket> => {
      const response = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, category }),
      })
      return ((await response.json()) as { ticket: Ticket }).ticket
    }
    const moveTo = async (id: number, toStep: string, batch?: boolean): Promise<Response> =>
      fetch(`${base}/api/tickets/${id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toStep, ...(batch !== undefined ? { batch } : {}) }),
      })
    const statusOf = async (id: number): Promise<string> => {
      const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
      return board.tickets.find((t) => t.id === id)!.status
    }

    // (a) a MANUAL ticket at an agent step — batch:true is rejected and it does not move.
    const manual = await create('Batch manual ticket')
    expect((await moveTo(manual.id, 'todo')).status).toBe(200) // todo is an agent step
    expect((await fetch(`${base}/api/tickets/${manual.id}/automation-level`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'manual' }),
    })).status).toBe(200)
    const manualBatch = await moveTo(manual.id, 'doing', true)
    expect(manualBatch.status).toBe(409)
    expect(((await manualBatch.json()) as { error: string }).error).toContain('not batch-runnable')
    expect(await statusOf(manual.id)).toBe('todo')

    // (e) the SAME manual ticket via a NAMED run (no batch flag) still advances — behaviour preserved.
    expect((await moveTo(manual.id, 'doing')).status).toBe(200)
    expect(await statusOf(manual.id)).toBe('doing')

    // (b) a ticket with a PENDING manual task — batch:true is rejected.
    const pending = await create('Batch pending-manual-task ticket')
    expect((await moveTo(pending.id, 'todo')).status).toBe(200)
    const manualTaskDoc = [
      '# Manual tasks',
      '',
      '```manual-task',
      'id: connect-neon',
      'service: Neon',
      'title: Provision a branch',
      'goal: Give CI a database',
      'steps:',
      '  - Open the Neon console',
      'done: false',
      '```',
      '',
    ].join('\n')
    expect((await fetch(`${base}/api/tickets/${pending.id}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'manual-tasks.md', content: manualTaskDoc }),
    })).status).toBe(200)
    const pendingBatch = await moveTo(pending.id, 'doing', true)
    expect(pendingBatch.status).toBe(409)
    expect(((await pendingBatch.json()) as { error: string }).error).toContain('not batch-runnable')
    expect(await statusOf(pending.id)).toBe('todo')

    // (c) a DEPENDENCY-HELD ticket — batch:true is rejected by the batch gate.
    const prerequisite = await create('Batch dep prerequisite')
    const dependent = await create('Batch dep dependent')
    expect((await moveTo(prerequisite.id, 'doing')).status).toBe(200)
    expect((await moveTo(dependent.id, 'todo')).status).toBe(200)
    expect((await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: prerequisite.id }] }),
    })).status).toBe(200)
    const heldBatch = await moveTo(dependent.id, 'doing', true)
    expect(heldBatch.status).toBe(409)
    expect(((await heldBatch.json()) as { error: string }).error).toContain('not batch-runnable')
    expect(await statusOf(dependent.id)).toBe('todo')

    // (d) a NORMAL agent-step ticket — batch:true advances it.
    const normal = await create('Batch normal ticket')
    expect((await moveTo(normal.id, 'todo')).status).toBe(200)
    const normalBatch = await moveTo(normal.id, 'doing', true)
    expect(normalBatch.status).toBe(200)
    expect(await statusOf(normal.id)).toBe('doing')
  })

  it('persists dependency edges, projects their state, and guards move and run boundaries', async () => {
    const create = async (title: string): Promise<Ticket> => {
      const response = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, category: 'logic' }),
      })
      return ((await response.json()) as { ticket: Ticket }).ticket
    }
    const prerequisite = await create('Dependency prerequisite')
    const dependent = await create('Dependency dependent')

    for (const ticket of [prerequisite, dependent]) {
      const response = await fetch(`${base}/api/tickets/${ticket.id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toStep: ticket.id === dependent.id ? 'todo' : 'doing' }),
      })
      expect(response.status).toBe(200)
    }

    const missing = await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: 999999 }] }),
    })
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toContain('#999999')

    for (const dependencies of [
      [{ ticketId: prerequisite.id }, { ticketId: prerequisite.id }],
      [{ ticketId: prerequisite.id, blockAtStage: 'removed-step' }],
      [{ ticketId: prerequisite.id, unblockWhen: 'arbitrary-step' }],
    ]) {
      const invalid = await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dependencies }),
      })
      expect(invalid.status).toBe(400)
    }

    const self = await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: dependent.id }] }),
    })
    expect(self.status).toBe(409)
    expect(((await self.json()) as { cycle: number[] }).cycle).toEqual([dependent.id, dependent.id])

    const update = await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: prerequisite.id }] }),
    })
    expect(update.status).toBe(200)
    const updated = (await update.json()) as {
      ticket: Ticket
      dependencyState: { held: boolean, resumesAt?: string, blockingTicketIds: number[] }
      inferredDependencyBoundary: string
      artifacts: unknown[]
      manualTasks: unknown[]
    }
    expect(updated.ticket.dependencies).toEqual([
      { ticketId: prerequisite.id, blockAtStage: 'doing', unblockWhen: 'done' },
    ])
    expect(updated).toMatchObject({
      dependencyState: { held: true, resumesAt: 'doing', blockingTicketIds: [prerequisite.id] },
      inferredDependencyBoundary: 'doing',
    })
    expect(Array.isArray(updated.artifacts)).toBe(true)
    expect(Array.isArray(updated.manualTasks)).toBe(true)

    const board = (await (await fetch(`${base}/api/board`)).json()) as {
      tickets: (Ticket & { dependencyState?: { held: boolean } })[]
    }
    expect(board.tickets.find((ticket) => ticket.id === dependent.id)?.dependencyState?.held).toBe(true)

    const heldMove = await fetch(`${base}/api/tickets/${dependent.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'doing' }),
    })
    expect(heldMove.status).toBe(409)
    expect(((await heldMove.json()) as { error: string }).error).toContain(`#${prerequisite.id}`)

    const heldRun = await fetch(`${base}/api/tickets/${dependent.id}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'doing' }),
    })
    expect(heldRun.status).toBe(409)
    expect(((await heldRun.json()) as { error: string }).error).toContain(`#${prerequisite.id}`)

    expect((await fetch(`${base}/api/tickets/${prerequisite.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'done' }),
    })).status).toBe(200)
    expect((await fetch(`${base}/api/tickets/${dependent.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'doing' }),
    })).status).toBe(200)

    const removed = await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [] }),
    })
    expect(removed.status).toBe(200)
    expect(((await removed.json()) as { ticket: Ticket, dependencyState: { edges: unknown[] } })).toMatchObject({
      ticket: { dependencies: [] },
      dependencyState: { edges: [] },
    })
  })

  it('rejects a cross-ticket dependency cycle with the concrete id path', async () => {
    const create = async (title: string): Promise<Ticket> => {
      const response = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, category: 'logic' }),
      })
      return ((await response.json()) as { ticket: Ticket }).ticket
    }
    const first = await create('Cycle first')
    const second = await create('Cycle second')

    expect((await fetch(`${base}/api/tickets/${first.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: second.id }] }),
    })).status).toBe(200)

    const response = await fetch(`${base}/api/tickets/${second.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dependencies: [{ ticketId: first.id }] }),
    })
    expect(response.status).toBe(409)
    expect((await response.json()) as { cycle: number[] }).toMatchObject({
      cycle: [second.id, first.id, second.id],
    })
  })

  it('keeps an archived prerequisite searchable and satisfies its archived milestone', async () => {
    const create = async (title: string): Promise<Ticket> => {
      const response = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, category: 'logic' }),
      })
      return ((await response.json()) as { ticket: Ticket }).ticket
    }
    const prerequisite = await create('Archive prerequisite')
    const dependent = await create('Archive dependent')

    for (const [id, toStep] of [[prerequisite.id, 'doing'], [dependent.id, 'todo']] as const) {
      expect((await fetch(`${base}/api/tickets/${id}/move`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toStep }),
      })).status).toBe(200)
    }
    expect((await fetch(`${base}/api/tickets/${dependent.id}/dependencies`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dependencies: [{ ticketId: prerequisite.id, blockAtStage: 'doing', unblockWhen: 'archived' }],
      }),
    })).status).toBe(200)

    expect((await fetch(`${base}/api/tickets/${prerequisite.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'done' }),
    })).status).toBe(200)
    expect((await fetch(`${base}/api/tickets/${prerequisite.id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'completed' }),
    })).status).toBe(200)

    const after = (await (await fetch(`${base}/api/board`)).json()) as {
      tickets: (Ticket & { dependencyState?: { held: boolean, edges: { state: string, prerequisite?: { archived: boolean } }[] } })[]
    }
    expect(after.tickets.find((ticket) => ticket.id === dependent.id)?.dependencyState).toMatchObject({
      held: false,
      edges: [{ state: 'satisfied', prerequisite: { archived: true } }],
    })
    const archive = (await (await fetch(`${base}/api/archive`)).json()) as { tickets: Ticket[] }
    expect(archive.tickets.some((ticket) => ticket.id === prerequisite.id)).toBe(true)
  })

  it('POST /api/tickets rejects an invalid category with 400', async () => {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Bad', category: 'nope' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toHaveProperty('error')
  })

  it('GET /api/tickets/:id returns 404 for an unknown id', async () => {
    const res = await fetch(`${base}/api/tickets/999999`)
    expect(res.status).toBe(404)
  })

  it('GET /api/info reports the board root and bound port', async () => {
    const res = await fetch(`${base}/api/info`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { boardRoot: string, port: number }
    expect(body.boardRoot).toBe(boardRoot)
    expect(body.port).toBe(server.port)
  })
})

describe('project keyword settings', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-keywords-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  async function createTagged(title: string): Promise<Ticket> {
    const response = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, category: 'logic', tags: ['Blog', 'other'] }),
    })
    return ((await response.json()) as { ticket: Ticket }).ticket
  }

  it('defaults safely, preserves other settings, and propagates renames to active tickets only', async () => {
    expect(await (await fetch(`${base}/api/settings/keywords`)).json()).toEqual({
      keywords: { maxShown: 3, items: [] },
    })

    writeFileSync(join(boardRoot, '.lfad-settings.json'), `${JSON.stringify({ futureSetting: { enabled: true } }, null, 2)}\n`)
    await fetch(`${base}/api/settings/command-prefix`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: '$' }),
    })
    const active = await createTagged('Active keyword ticket')
    const archived = await createTagged('Archived keyword ticket')
    // Archive is only permitted from the last applicable step, so advance the fixture to `done` first.
    expect((await fetch(`${base}/api/tickets/${archived.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'done', reason: 'pipeline complete' }),
    })).status).toBe(200)
    expect((await fetch(`${base}/api/tickets/${archived.id}/archive`, { method: 'POST' })).status).toBe(200)

    const initial = await fetch(`${base}/api/settings/keywords`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: { maxShown: 4, items: [{ word: 'blog', color: '#0284c7' }] },
        renames: [],
        propagate: false,
      }),
    })
    expect(initial.status).toBe(200)
    expect(await (await fetch(`${base}/api/settings/command-prefix`)).json()).toEqual({ prefix: '$' })

    const renamed = await fetch(`${base}/api/settings/keywords`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        keywords: { maxShown: 4, items: [{ word: 'writing', color: '#0284c7' }] },
        renames: [{ from: 'blog', to: 'writing' }],
        propagate: true,
      }),
    })
    expect(renamed.status).toBe(200)
    expect((await renamed.json()) as { updatedTickets: number[] }).toMatchObject({ updatedTickets: [active.id] })

    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    expect(board.tickets.find((ticket) => ticket.id === active.id)?.tags).toEqual(['writing', 'other'])
    const archive = (await (await fetch(`${base}/api/archive`)).json()) as { tickets: Ticket[] }
    expect(archive.tickets.find((ticket) => ticket.id === archived.id)?.tags).toEqual(['Blog', 'other'])
    expect(await (await fetch(`${base}/api/settings/keywords`)).json()).toEqual({
      keywords: { maxShown: 4, items: [{ word: 'writing', color: '#0284c7' }] },
    })
    expect(JSON.parse(readFileSync(join(boardRoot, '.lfad-settings.json'), 'utf8'))).toMatchObject({
      commandPrefix: '$',
      futureSetting: { enabled: true },
    })
  })

  it('rejects duplicate words and colours outside the curated palette', async () => {
    for (const keywords of [
      { maxShown: 3, items: [{ word: 'blog', color: '#0284c7' }, { word: 'BLOG', color: '#d97706' }] },
      { maxShown: 3, items: [{ word: 'blog', color: '#ffffff' }] },
    ]) {
      const response = await fetch(`${base}/api/settings/keywords`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords, renames: [], propagate: false }),
      })
      expect(response.status).toBe(400)
    }
  })

  it('accepts new hue shades, neutral shades, and existing 600 colours', async () => {
    const keywords = {
      maxShown: 4,
      items: [
        { word: 'light-red', color: '#fee2e2' },
        { word: 'indigo', color: '#6366f1' },
        { word: 'stone', color: '#1c1917' },
        { word: 'legacy-sky', color: '#0284c7' },
      ],
    }
    const response = await fetch(`${base}/api/settings/keywords`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keywords, renames: [], propagate: false }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ keywords })
  })
})

describe('project prompt settings', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-prompts-'))
    seedBoard(boardRoot)
    execFileSync('git', ['-C', boardRoot, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'commit', '-m', 'initial board'], { stdio: 'ignore' })
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('defaults safely and preserves unrelated settings when saving a valid template', async () => {
    const defaultTemplate = 'Use a workflow to run parallel actions and process every board ticket that is not blocked on a user action. '
      + 'The unblocked tickets right now are {ids}. '
      + 'Run {command} <id> for each one in its own parallel lane, and stop each ticket at its next human gate.'
    expect(await (await fetch(`${base}/api/settings/prompts`)).json()).toEqual({
      prompts: { runAll: defaultTemplate },
    })

    const settingsBeforeSave = {
      commandPrefix: '$',
      keywords: { maxShown: 3, items: [] },
      futureSetting: { enabled: true },
      prompts: { runAll: 42, futurePromptSetting: 'preserve me' },
    }
    writeFileSync(join(boardRoot, '.lfad-settings.json'), `${JSON.stringify(settingsBeforeSave, null, 2)}\n`)
    expect(await (await fetch(`${base}/api/settings/prompts`)).json()).toEqual({
      prompts: { runAll: defaultTemplate },
    })

    const runAll = 'Advance {ids} with {command} <id>.'
    const saved = await fetch(`${base}/api/settings/prompts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompts: { runAll } }),
    })

    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ prompts: { runAll } })
    expect(await (await fetch(`${base}/api/settings/prompts`)).json()).toEqual({ prompts: { runAll } })
    expect(JSON.parse(readFileSync(join(boardRoot, '.lfad-settings.json'), 'utf8'))).toEqual({
      commandPrefix: '$',
      keywords: { maxShown: 3, items: [] },
      futureSetting: { enabled: true },
      prompts: { runAll, futurePromptSetting: 'preserve me' },
    })
    expect(execFileSync('git', ['-C', boardRoot, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).trim()).toBe(
      'snapshot before edit to .lfad-settings.json',
    )
    expect(JSON.parse(execFileSync('git', ['-C', boardRoot, 'show', 'HEAD:.lfad-settings.json'], { encoding: 'utf8' }))).toEqual(
      settingsBeforeSave,
    )
  })

  it('rejects templates without {ids} and keeps the last valid value', async () => {
    const before = await (await fetch(`${base}/api/settings/prompts`)).json()
    for (const body of [
      {},
      { prompts: null },
      { prompts: { runAll: 7 } },
      { prompts: { runAll: '   ' } },
      { prompts: { runAll: 'Advance tickets with {command} <id>.' } },
    ]) {
      const response = await fetch(`${base}/api/settings/prompts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
      expect(((await response.json()) as { error: string }).error).toContain('{ids}')
    }
    expect(await (await fetch(`${base}/api/settings/prompts`)).json()).toEqual(before)
  })
})

describe('board.yml hot reload', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-reload-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  async function stepKeysOverApi(): Promise<string[]> {
    const body = (await (await fetch(`${base}/api/steps`)).json()) as { steps: { key: string }[] }
    return body.steps.map((s) => s.key)
  }

  it('an edited board.yml reloads: new step appears on /api/steps and its folder exists', async () => {
    const configPath = join(boardRoot, BOARD_CONFIG_FILE)
    // Inject a step that the nine-step default does NOT already carry, so the
    // appearance of its key proves a genuine reload.
    const withShip = readFileSync(configPath, 'utf8').replace(
      /- key: done/,
      '- key: ship\n    label: Ship\n    type: gate\n  - key: done',
    )
    // Give chokidar a beat to finish its initial scan (a write during the scan
    // can be dropped), then re-write once per second until the reload lands.
    await new Promise((resolve) => setTimeout(resolve, 400))
    let attempt = 0
    const reloaded = await waitUntil(async () => {
      if (attempt++ % 10 === 0) writeFileSync(configPath, withShip)
      return (await stepKeysOverApi()).includes('ship')
    }, 10000)
    expect(reloaded).toBe(true)
    expect(await stepKeysOverApi()).toEqual([
      'idea', 'research', 'interview', 'mock', 'design', 'todo', 'doing', 'review', 'ship', 'done', 'blocked',
    ])
  }, 15000)

  it('an INVALID board.yml edit keeps the previous config and the daemon alive', async () => {
    const before = await stepKeysOverApi()
    const configPath = join(boardRoot, BOARD_CONFIG_FILE)
    writeFileSync(configPath, 'version: 1\nsteps: []\n') // invalid: steps must be non-empty

    // Give the watcher a debounce cycle to (not) apply it.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await stepKeysOverApi()).toEqual(before)
    expect((await fetch(`${base}/api/health`)).status).toBe(200)

    // The board still serves tickets from the old config.
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    expect(board.tickets.length).toBeGreaterThan(0)
  })
})

describe('PUT /api/tickets/:id/artifact (git board)', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number

  /** Number of commits reachable from HEAD, or 0 when there are none yet. */
  function commitCount(): number {
    try {
      const out = execFileSync('git', ['-C', boardRoot, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return Number.parseInt(out.trim(), 10)
    } catch {
      return 0
    }
  }

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-git-'))
    seedBoard(boardRoot)
    // git-init the board with a local identity; leave the seed UNCOMMITTED so the
    // first pre-edit snapshot has something to commit.
    execFileSync('git', ['-C', boardRoot, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })

    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    ticketId = board.tickets.find((t) => t.status === 'doing')!.id
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('overwrites a named artifact, snapshots the pre-change state, and GET shows the new content', async () => {
    const before = commitCount()

    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plan.md', content: '# Updated Plan\n\nfresh plan body\n' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ticket: Ticket
      artifacts: { name: string, content: string }[]
    }
    expect(body.ticket.id).toBe(ticketId)
    expect(body.artifacts.find((a) => a.name === 'plan.md')?.content).toBe(
      '# Updated Plan\n\nfresh plan body\n',
    )

    // A new pre-edit snapshot commit now exists.
    expect(commitCount()).toBeGreaterThan(before)
    const subject = execFileSync('git', ['-C', boardRoot, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf8',
    }).trim()
    expect(subject).toBe(`snapshot before edit to #${ticketId}/plan.md`)

    // GET reflects the new content from disk.
    const got = (await (await fetch(`${base}/api/tickets/${ticketId}`)).json()) as {
      artifacts: { name: string, content: string }[]
    }
    expect(got.artifacts.find((a) => a.name === 'plan.md')?.content).toBe(
      '# Updated Plan\n\nfresh plan body\n',
    )
  })

  it('rewrites the ticket body when name is "Idea", preserving frontmatter', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Idea', content: '# New idea\n\nrewritten idea body\n' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ticket: Ticket
      artifacts: { name: string, content: string }[]
    }
    // The ticket spine survives a body rewrite.
    expect(body.ticket.id).toBe(ticketId)
    expect(body.artifacts.find((a) => a.name === 'Idea')?.content).toContain('rewritten idea body')
  })

  it('returns 404 for an unknown ticket id', async () => {
    const res = await fetch(`${base}/api/tickets/999999/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plan.md', content: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 when name is missing', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects the reserved "ticket.md" name with 400 and leaves the spine intact', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ticket.md', content: 'clobbered\n' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/Reserved/)
    // No pre-edit snapshot was taken, and the frontmatter spine still parses.
    expect(commitCount()).toBe(before)
    const got = await fetch(`${base}/api/tickets/${ticketId}`)
    expect(got.status).toBe(200)
    expect((((await got.json()) as { ticket: Ticket }).ticket).id).toBe(ticketId)
  })

  it('rejects writes into the append-only log/ directory (both slash forms) with 400', async () => {
    for (const name of ['log/12.ndjson', 'log/note.md', 'log\\evil.md']) {
      const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, content: 'tamper\n' }),
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/Reserved/)
    }
  })

  it('still allows a nested plan/ artifact write next to the reserved names', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plan/01-x.md', content: '# Nested plan\n' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { artifacts: { name: string, content: string }[] }
    expect(body.artifacts.find((a) => a.name === 'plan/01-x.md')?.content).toBe('# Nested plan\n')
  })
})

describe('POST /api/tickets/:id/note (git board)', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number

  /** Number of commits reachable from HEAD, or 0 when there are none yet. */
  function commitCount(): number {
    try {
      const out = execFileSync('git', ['-C', boardRoot, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return Number.parseInt(out.trim(), 10)
    } catch {
      return 0
    }
  }

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-note-'))
    seedBoard(boardRoot)
    // Leave the seed UNCOMMITTED so the first pre-edit snapshot has something to commit.
    execFileSync('git', ['-C', boardRoot, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })

    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    ticketId = board.tickets.find((t) => t.status === 'doing')!.id
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('records the fast-pass note in stepNotes, snapshots the pre-change board, and GET shows it', async () => {
    const before = commitCount()

    const res = await fetch(`${base}/api/tickets/${ticketId}/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'research', skip: true, reason: 'config-only change; nothing to explore' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.id).toBe(ticketId)
    expect(body.ticket.stepNotes?.research).toEqual({
      applicable: false,
      reason: 'config-only change; nothing to explore',
    })

    // A note MODIFIES ticket.md, so a pre-edit snapshot commit now exists.
    expect(commitCount()).toBeGreaterThan(before)
    const subject = execFileSync('git', ['-C', boardRoot, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf8',
    }).trim()
    expect(subject).toBe(`snapshot before edit to #${ticketId}/ticket.md`)

    // GET reflects the note from disk.
    const got = (await (await fetch(`${base}/api/tickets/${ticketId}`)).json()) as { ticket: Ticket }
    expect(got.ticket.stepNotes?.research).toEqual({
      applicable: false,
      reason: 'config-only change; nothing to explore',
    })
  })

  it('records a note with no reason when reason is omitted (mirrors the CLI: reason optional)', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'todo', skip: true }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ticket: Ticket }
    expect(body.ticket.stepNotes?.todo).toEqual({ applicable: false })
  })

  it('returns 404 for an unknown ticket id and takes no snapshot', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/999999/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'research', skip: true, reason: 'x' }),
    })
    expect(res.status).toBe(404)
    expect(commitCount()).toBe(before)
  })

  it('returns 400 for an unknown step key and takes no snapshot', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/${ticketId}/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'nope', skip: true, reason: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/step/i)
    expect(commitCount()).toBe(before)
  })

  it('returns 400 when skip is not true and takes no snapshot', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/${ticketId}/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'research', reason: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(commitCount()).toBe(before)
  })
})

describe('POST /api/tickets/:id/automation-level (git board)', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number

  /** Number of commits reachable from HEAD, or 0 when there are none yet. */
  function commitCount(): number {
    try {
      const out = execFileSync('git', ['-C', boardRoot, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return Number.parseInt(out.trim(), 10)
    } catch {
      return 0
    }
  }

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-automation-'))
    seedBoard(boardRoot)
    // Leave the seed UNCOMMITTED so the first pre-edit snapshot has something to commit.
    execFileSync('git', ['-C', boardRoot, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })

    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    ticketId = board.tickets.find((t) => t.status === 'doing')!.id
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('persists each level to the frontmatter, snapshots the pre-change board, and GET shows it', async () => {
    for (const level of ['manual', 'express', 'normal'] as const) {
      const before = commitCount()
      const res = await fetch(`${base}/api/tickets/${ticketId}/automation-level`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ticket: Ticket }
      expect(body.ticket.id).toBe(ticketId)
      expect(body.ticket.automationLevel).toBe(level)

      // A level change MODIFIES ticket.md, so a pre-edit snapshot commit now exists.
      expect(commitCount()).toBeGreaterThan(before)

      // GET reflects the level from disk.
      const got = (await (await fetch(`${base}/api/tickets/${ticketId}`)).json()) as { ticket: Ticket }
      expect(got.ticket.automationLevel).toBe(level)
    }
  })

  it('returns 400 for an unknown level and takes no snapshot', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/${ticketId}/automation-level`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'turbo' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/normal\|express\|manual/)
    expect(commitCount()).toBe(before)
  })

  it('returns 404 for an unknown ticket id and takes no snapshot', async () => {
    const before = commitCount()
    const res = await fetch(`${base}/api/tickets/999999/automation-level`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'manual' }),
    })
    expect(res.status).toBe(404)
    expect(commitCount()).toBe(before)
  })
})

describe('POST /api/tickets entryStep on a multi-entry board', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-multientry-'))
    seedBoard(boardRoot)
    // Flag a second entry step BEFORE the server starts: idea (default) + todo.
    const configPath = join(boardRoot, BOARD_CONFIG_FILE)
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(/- key: todo/, '- key: todo\n    entry: true'))
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('accepts every entry-flagged step and still rejects a non-entry one', async () => {
    for (const entryStep of ['idea', 'todo']) {
      const res = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `Enter at ${entryStep}`, category: 'logic', entryStep }),
      })
      expect(res.status).toBe(201)
      expect(((await res.json()) as { ticket: Ticket }).ticket.status).toBe(entryStep)
    }

    const rejected = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Enter at review', category: 'logic', entryStep: 'review' }),
    })
    expect(rejected.status).toBe(400)
  })
})

describe('ticket files: canonical artifact order, files route, nested artifact writes', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number
  let ticketDir: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-files-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`

    const created = (await (
      await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Rail ticket', category: 'ui', body: 'The idea body.' }),
      })
    ).json()) as { ticket: Ticket }
    ticketId = created.ticket.id
    ticketDir = join(boardRoot, 'idea', `${String(ticketId).padStart(5, '0')}-${created.ticket.slug}`)

    // Root files, two step subfolders (out of pipeline order on disk), an
    // unknown subfolder, and never-listed folders — written straight to disk.
    writeFileSync(join(ticketDir, 'blocked.md'), 'blocked\n')
    mkdirSync(join(ticketDir, 'doing'), { recursive: true })
    writeFileSync(join(ticketDir, 'doing', '00-progress.md'), 'progress\n')
    mkdirSync(join(ticketDir, 'research'), { recursive: true })
    writeFileSync(join(ticketDir, 'research', '00-shared-context.md'), 'shared\n')
    writeFileSync(join(ticketDir, 'research', '10-later.md'), 'later\n')
    writeFileSync(join(ticketDir, 'research', '2-earlier.md'), 'earlier\n')
    mkdirSync(join(ticketDir, 'notes'), { recursive: true })
    writeFileSync(join(ticketDir, 'notes', 'scratch.md'), 'scratch\n')
    mkdirSync(join(ticketDir, 'images'), { recursive: true })
    writeFileSync(join(ticketDir, 'images', 'never-listed.md'), 'x\n')
    writeFileSync(join(ticketDir, 'secret.txt'), 'nope\n')
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('GET /api/tickets/:id orders artifacts: Idea → root .md → step groups in pipeline order → unknown folders', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { artifacts: { name: string }[] }
    expect(body.artifacts.map((a) => a.name)).toEqual([
      'Idea',
      'blocked.md',
      'research/00-shared-context.md',
      'research/2-earlier.md',
      'research/10-later.md',
      'doing/00-progress.md',
      'notes/scratch.md',
    ])
  })

  it('GET /api/tickets/:id/files/* serves markdown and image bytes with the right Content-Type', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    writeFileSync(join(ticketDir, 'images', 'shot.png'), png)

    const image = await fetch(`${base}/api/tickets/${ticketId}/files/images/shot.png`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await image.arrayBuffer()).equals(png)).toBe(true)

    const md = await fetch(`${base}/api/tickets/${ticketId}/files/research/00-shared-context.md`)
    expect(md.status).toBe(200)
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(await md.text()).toBe('shared\n')
  })

  it('GET /api/tickets/:id/files/* serves html sandboxed (content-type + CSP), markdown without CSP', async () => {
    writeFileSync(join(ticketDir, 'mock.html'), '<!doctype html><h1>Design mock</h1><script>1</script>\n')

    const html = await fetch(`${base}/api/tickets/${ticketId}/files/mock.html`)
    expect(html.status).toBe(200)
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(html.headers.get('content-security-policy')).toBe('sandbox allow-scripts')
    expect(await html.text()).toContain('Design mock')

    const md = await fetch(`${base}/api/tickets/${ticketId}/files/blocked.md`)
    expect(md.status).toBe(200)
    expect(md.headers.get('content-security-policy')).toBeNull()
  })

  it('GET /api/tickets/:id/files/* sandboxes svg (script-capable) but not raster images', async () => {
    // SVG can carry inline <script>; served without a sandbox it would execute
    // in the board's origin. It must get the same CSP as html; PNG stays inert.
    writeFileSync(
      join(ticketDir, 'diagram.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    )
    const svg = await fetch(`${base}/api/tickets/${ticketId}/files/diagram.svg`)
    expect(svg.status).toBe(200)
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg.headers.get('content-security-policy')).toBe('sandbox allow-scripts')

    const raster = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    writeFileSync(join(ticketDir, 'images', 'raster.png'), raster)
    const png = await fetch(`${base}/api/tickets/${ticketId}/files/images/raster.png`)
    expect(png.status).toBe(200)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(png.headers.get('content-security-policy')).toBeNull()
  })

  it('GET /api/tickets/:id/files/* rejects traversal with 403', async () => {
    // `..%2F` survives WHATWG URL normalization; a literal `../` would be
    // collapsed by fetch before it ever reached the route.
    const res = await fetch(`${base}/api/tickets/${ticketId}/files/..%2Fboard.yml`)
    expect(res.status).toBe(403)
    const nested = await fetch(`${base}/api/tickets/${ticketId}/files/research/..%2F..%2Fboard.yml`)
    expect(nested.status).toBe(403)
    const dotted = await fetch(`${base}/api/tickets/${ticketId}/files/.draft.md`)
    expect(dotted.status).toBe(403)
  })

  it('GET /api/tickets/:id/files/* returns 404 for non-allowlisted, missing, or unknown-ticket paths', async () => {
    expect((await fetch(`${base}/api/tickets/${ticketId}/files/secret.txt`)).status).toBe(404)
    expect((await fetch(`${base}/api/tickets/${ticketId}/files/research/missing.md`)).status).toBe(404)
    expect((await fetch(`${base}/api/tickets/999999/files/research/00-shared-context.md`)).status).toBe(404)
  })

  it('PUT /api/tickets/:id/artifact accepts nested names and writes into the subfolder', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'todo/00-breakdown.md', content: '# Breakdown\n' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { artifacts: { name: string, content: string }[] }
    expect(body.artifacts.find((a) => a.name === 'todo/00-breakdown.md')?.content).toBe('# Breakdown\n')
    expect(readFileSync(join(ticketDir, 'todo', '00-breakdown.md'), 'utf8')).toBe('# Breakdown\n')
  })

  it('PUT /api/tickets/:id/artifact rejects a traversal name with 400 and writes nothing', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '../escape.md', content: 'evil' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/Invalid artifact name/)
    expect(existsSync(join(boardRoot, 'idea', 'escape.md'))).toBe(false)
  })
})

describe('POST /api/tickets/:id/files: image upload failure modes', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number
  let ticketDir: string
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

  /** Absolute ticket-folder path for a just-created (idea-step) ticket. */
  function ideaDir(ticket: Ticket): string {
    return join(boardRoot, 'idea', `${String(ticket.id).padStart(5, '0')}-${ticket.slug}`)
  }

  async function createIdeaTicket(title: string): Promise<Ticket> {
    const created = (await (
      await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, category: 'ui', body: 'body' }),
      })
    ).json()) as { ticket: Ticket }
    return created.ticket
  }

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-img-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
    const ticket = await createIdeaTicket('Image ticket')
    ticketId = ticket.id
    ticketDir = ideaDir(ticket)
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('stores a pasted image and returns its files/ ref', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ref: string }
    expect(body.ref).toMatch(/^files\/paste-\d+\.png$/)
    expect(existsSync(join(ticketDir, body.ref))).toBe(true)
  })

  it('returns 404 (not a write error) for an unknown ticket id', async () => {
    const res = await fetch(`${base}/api/tickets/999999/files`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    })
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: string }).error).toMatch(/not found/i)
  })

  it('returns 415 for an unsupported content type', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: png,
    })
    expect(res.status).toBe(415)
  })

  it('rejects reserved target names (ticket.md, log/) with 400', async () => {
    for (const file of ['ticket.md', 'log/x.md']) {
      const res = await fetch(`${base}/api/tickets/${ticketId}/files?file=${encodeURIComponent(file)}`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/Reserved/)
    }
  })

  it('returns 500 (not 404) when the target files/ dir cannot be created', async () => {
    // Occupy the artifact's `files/` path with a regular FILE so mkdirSync fails
    // — a genuine write failure on a KNOWN ticket, distinct from a missing one.
    const ticket = await createIdeaTicket('Unwritable ticket')
    writeFileSync(join(ideaDir(ticket), 'files'), 'blocking file\n')

    const res = await fetch(`${base}/api/tickets/${ticket.id}/files`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toMatch(/save/i)
  })
})

describe('open inputs: question blocks surface on board, detail, and artifact-PUT payloads', () => {
  interface QuestionWire {
    file: string
    id?: string
    ask?: string
    type?: string
    options?: string[]
    context?: string
    open: boolean
    decisionLine: number
  }
  type TicketWithInputs = Ticket & { openInputs: number }

  let boardRoot: string
  let server: RunningServer
  let base: string
  let ticketId: number

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-inputs-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`

    // A ticket whose body (the Idea artifact) already carries one OPEN bare-Decision slot.
    const created = (await (
      await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Question ticket',
          category: 'logic',
          body: 'Pick the rollout order.\n\n**Decision:**\n',
        }),
      })
    ).json()) as { ticket: Ticket }
    ticketId = created.ticket.id
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  const planWithQuestions = [
    'Plan intro.',
    '',
    '```question',
    'id: D1',
    'ask: Which storage engine?',
    'type: choice',
    'options:',
    '  - sqlite',
    '  - postgres',
    '```',
    '**Decision:**',
    '',
    '```question',
    'id: D2',
    'type: confirm',
    '```',
    '**Decision:** yes ·2026-07-07',
    '',
  ].join('\n')

  it('PUT /api/tickets/:id/artifact responds with the recount and the questions[]', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plan/01-decisions.md', content: planWithQuestions }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { openInputs: number, questions: QuestionWire[] }
    // 1 open bare slot in the Idea body + D1 open; D2 is answered.
    expect(body.openInputs).toBe(2)
    expect(body.questions).toHaveLength(3)
  })

  it('GET /api/tickets/:id carries openInputs and the full questions[] shape', async () => {
    const res = await fetch(`${base}/api/tickets/${ticketId}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { openInputs: number, questions: QuestionWire[] }
    expect(body.openInputs).toBe(2)

    const [ideaQ, d1, d2] = body.questions
    expect(ideaQ).toEqual({
      file: 'Idea',
      context: 'Pick the rollout order.',
      open: true,
      decisionLine: 2,
    })
    expect(d1).toEqual({
      file: 'plan/01-decisions.md',
      id: 'D1',
      ask: 'Which storage engine?',
      type: 'option', // legacy `choice` normalizes to `option`
      options: ['sqlite', 'postgres'],
      context: 'Plan intro.',
      open: true,
      decisionLine: 10,
    })
    expect(d2).toMatchObject({ file: 'plan/01-decisions.md', id: 'D2', type: 'approve', open: false, decisionLine: 16 }) // `confirm` → `approve`
  })

  it('GET /api/board carries the cached per-ticket openInputs', async () => {
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: TicketWithInputs[] }
    const withQuestions = board.tickets.find((t) => t.id === ticketId)
    expect(withQuestions?.openInputs).toBe(2)
    // The seeded tickets have no Decision slots.
    for (const ticket of board.tickets.filter((t) => t.id !== ticketId)) {
      expect(ticket.openInputs).toBe(0)
    }
  })

  it('answering a question drops the count everywhere', async () => {
    const answered = planWithQuestions.replace('```\n**Decision:**', '```\n**Decision:** postgres ·2026-07-07')
    const res = await fetch(`${base}/api/tickets/${ticketId}/artifact`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plan/01-decisions.md', content: answered }),
    })
    expect(((await res.json()) as { openInputs: number }).openInputs).toBe(1)

    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: TicketWithInputs[] }
    expect(board.tickets.find((t) => t.id === ticketId)?.openInputs).toBe(1)
  })
})

describe('guidance: board.yml guidance reaches /api/steps, /api/manual, and the step prompt', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-guidance-'))
    seedBoard(boardRoot)
    // Add board-level + step-level guidance to the seeded board.yml before boot.
    const configPath = join(boardRoot, BOARD_CONFIG_FILE)
    const yamlText = readFileSync(configPath, 'utf8')
      .replace('version: 1', 'version: 1\nguidance: Ship small, verified slices.')
      .replace('- key: doing\n    label: Doing', '- key: doing\n    label: Doing\n    guidance: Run the full gate before FLOW_DONE.')
    writeFileSync(configPath, yamlText)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('GET /api/steps carries the board guidance and per-step guidance', async () => {
    const res = await fetch(`${base}/api/steps`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { steps: StepPayload[], guidance?: string }
    expect(body.guidance).toBe('Ship small, verified slices.')
    expect(body.steps.find((s) => s.key === 'doing')?.guidance).toBe('Run the full gate before FLOW_DONE.')
    expect(body.steps.find((s) => s.key === 'todo')?.guidance).toBeUndefined()
  })

  it('GET /api/manual includes the board-level guidance', async () => {
    const res = await fetch(`${base}/api/manual`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { skills: unknown[], actions: unknown[], guidance?: string }
    expect(body.guidance).toBe('Ship small, verified slices.')
  })

  it('buildStepPrompt injects board guidance then step guidance after the goal line', () => {
    const now = '2026-07-07T00:00:00.000Z'
    const ticket: Ticket = {
      id: 1,
      slug: 'x',
      title: 'X',
      status: 'doing',
      category: 'logic',
      tags: [],
      createdAt: now,
      updatedAt: now,
      history: [{ step: 'doing', at: now }],
    }
    const stepConfig = {
      key: 'doing',
      label: 'Doing',
      type: 'agent' as const,
      row: 'agents' as const,
      goal: 'Build it.',
      guidance: 'Step-level rule.',
    }
    const prompt = buildStepPrompt(ticket, [], 'doing', stepConfig, { dryRun: true, autopilot: false, timeoutMs: 1000, killGraceMs: 2000 }, { boardGuidance: 'Board-level rule.' })
    const lines = prompt.split('\n')
    const goalIndex = lines.indexOf('Step goal: Build it.')
    expect(goalIndex).toBeGreaterThan(-1)
    expect(lines[goalIndex + 1]).toBe('Board guidance: Board-level rule.')
    expect(lines[goalIndex + 2]).toBe('Step guidance: Step-level rule.')

    // Without guidance, neither line appears.
    const bare = buildStepPrompt(ticket, [], 'doing', { ...stepConfig, guidance: undefined }, { dryRun: true, autopilot: false, timeoutMs: 1000, killGraceMs: 2000 })
    expect(bare).not.toContain('guidance:')
  })
})

describe('watcher: a new .md inside a ticket subfolder broadcasts board-changed', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-watch-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('fires the default SSE event for a ticket-subfolder file (the ignore predicate must pass it)', async () => {
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    const doing = board.tickets.find((t) => t.status === 'doing')!
    const dir = join(boardRoot, 'doing', `${String(doing.id).padStart(5, '0')}-${doing.slug}`)

    const res = await fetch(`${base}/api/events`)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    // board-changed rides the DEFAULT (unnamed) event: a frame with no `event:` line.
    const sawBoardChanged = (): boolean =>
      buffer.split('\n\n').some((frame) => !frame.includes('event:') && frame.includes('board-changed'))
    void (async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
      }
    })().catch(() => {})

    // Give chokidar a beat past its initial scan, then create the subfolder
    // .md, re-writing once per second until the watcher event lands.
    await new Promise((resolve) => setTimeout(resolve, 400))
    mkdirSync(join(dir, 'doing'), { recursive: true })
    let attempt = 0
    const fired = await waitUntil(async () => {
      if (attempt++ % 10 === 0) writeFileSync(join(dir, 'doing', '00-progress.md'), `progress ${attempt}\n`)
      return sawBoardChanged()
    }, 10000)
    await reader.cancel().catch(() => {})
    expect(fired).toBe(true)
  }, 15000)
})

describe('running ticket leases', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  let ticketId: number

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-running-'))
    seedBoard(boardRoot)
    server = await createServer({
      boardRoot,
      runningRegistry: { ttlMs: 1_000, now: () => now, sweepIntervalMs: 60_000 },
    }).start(0)
    base = `http://127.0.0.1:${server.port}`
    const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
    ticketId = board.tickets[0]!.id
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  const post = (path: string, body?: unknown) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  it('claims, rejects conflicts, supports force, heartbeat, release, clear, projection, and expiry', async () => {
    const first = await post(`/api/tickets/${ticketId}/claim`, { label: 'codex' })
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { token: string, expiresAt: string }

    const conflict = await post(`/api/tickets/${ticketId}/claim`)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ holder: { count: 1, label: 'codex' } })

    const forced = await post(`/api/tickets/${ticketId}/claim`, { force: true, label: 'claude' })
    const forcedBody = (await forced.json()) as { token: string }
    expect(forced.status).toBe(200)
    let board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: (Ticket & { running?: { count: number } })[] }
    expect(board.tickets.find((ticket) => ticket.id === ticketId)?.running?.count).toBe(2)

    now += 500
    const heartbeat = await post(`/api/tickets/${ticketId}/heartbeat`, { token: firstBody.token })
    expect(heartbeat.status).toBe(200)
    expect(Date.parse(((await heartbeat.json()) as { expiresAt: string }).expiresAt)).toBe(now + 1_000)

    expect(await (await post(`/api/tickets/${ticketId}/release`, { token: forcedBody.token })).json()).toEqual({ released: true })
    expect(await (await post(`/api/tickets/${ticketId}/release`, { token: forcedBody.token })).json()).toEqual({ released: false })

    expect(await (await post(`/api/tickets/${ticketId}/clear-running`)).json()).toEqual({ cleared: 1 })
    board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: (Ticket & { running?: { count: number } })[] }
    expect(board.tickets.find((ticket) => ticket.id === ticketId)?.running).toBeUndefined()

    await post(`/api/tickets/${ticketId}/claim`)
    now += 1_001
    board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: (Ticket & { running?: { count: number } })[] }
    expect(board.tickets.find((ticket) => ticket.id === ticketId)?.running).toBeUndefined()
  })

  it('excludes live claims from batch moves until release, clear, or expiry while named moves remain allowed', async () => {
    const created = await post('/api/tickets', { title: 'Batch running ticket', category: 'logic' })
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { ticket: Ticket }).ticket.id
    const move = (toStep: string, batch?: boolean): Promise<Response> =>
      post(`/api/tickets/${id}/move`, { toStep, ...(batch !== undefined ? { batch } : {}) })
    const status = async (): Promise<string> => {
      const board = (await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }
      return board.tickets.find((ticket) => ticket.id === id)!.status
    }

    expect((await move('todo')).status).toBe(200)

    const releaseClaim = await post(`/api/tickets/${id}/claim`)
    const releaseToken = ((await releaseClaim.json()) as { token: string }).token
    const claimedBatch = await move('doing', true)
    expect(claimedBatch.status).toBe(409)
    expect(((await claimedBatch.json()) as { error: string }).error).toContain('live-running')
    expect(await status()).toBe('todo')

    // A named move intentionally retains its existing semantics while claimed.
    expect((await move('doing')).status).toBe(200)
    expect((await move('todo')).status).toBe(200)
    expect(await (await post(`/api/tickets/${id}/release`, { token: releaseToken })).json()).toEqual({ released: true })
    expect((await move('doing', true)).status).toBe(200)

    expect((await move('todo')).status).toBe(200)
    await post(`/api/tickets/${id}/claim`)
    expect((await move('doing', true)).status).toBe(409)
    expect(await (await post(`/api/tickets/${id}/clear-running`)).json()).toEqual({ cleared: 1 })
    expect((await move('doing', true)).status).toBe(200)

    expect((await move('todo')).status).toBe(200)
    await post(`/api/tickets/${id}/claim`)
    now += 1_001
    expect((await move('doing', true)).status).toBe(200)
  })
})

describe('POST /api/tickets/:id/archive + /reactivate', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-archive-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  async function board(): Promise<Ticket[]> {
    return ((await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }).tickets
  }
  async function archive(): Promise<Ticket[]> {
    return ((await (await fetch(`${base}/api/archive`)).json()) as { tickets: Ticket[] }).tickets
  }
  async function makeTicket(title: string): Promise<Ticket> {
    const res = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, category: 'logic' }),
    })
    return ((await res.json()) as { ticket: Ticket }).ticket
  }
  async function moveTicket(ticket: Ticket, toStep = 'done'): Promise<void> {
    const res = await fetch(`${base}/api/tickets/${ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep, reason: 'pipeline complete' }),
    })
    expect(res.status).toBe(200)
  }

  it('archives a ticket: it leaves /api/board and appears in /api/archive', async () => {
    const t = await makeTicket('Archive me')
    await moveTicket(t)
    const res = await fetch(`${base}/api/tickets/${t.id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'shipped and merged' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ticket: Ticket }).ticket.id).toBe(t.id)

    expect((await board()).some((x) => x.id === t.id)).toBe(false)
    expect((await archive()).some((x) => x.id === t.id)).toBe(true)
    // The reason lands in the ticket log (archived event).
    const log = readFileSync(
      join(boardRoot, '_archive', `${String(t.id).padStart(5, '0')}-${t.slug}`, 'log', `${t.id}.ndjson`),
      'utf8',
    )
    expect(log).toContain('"event":"archived"')
    expect(log).toContain('shipped and merged')
  })

  it('rejects archive before the last applicable step without moving or logging the ticket', async () => {
    const t = await makeTicket('Not finished')
    const res = await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(
      /cannot be archived from 'idea'.*last applicable step 'done'/,
    )
    expect((await board()).find((x) => x.id === t.id)?.status).toBe('idea')
    expect((await archive()).some((x) => x.id === t.id)).toBe(false)
    const logPath = join(boardRoot, 'idea', `${String(t.id).padStart(5, '0')}-${t.slug}`, 'log', `${t.id}.ndjson`)
    expect(existsSync(logPath)).toBe(false)
  })

  it('rejects re-archiving an already-archived ticket (409, readable message)', async () => {
    const t = await makeTicket('Archive twice')
    await moveTicket(t)
    await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    const res = await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/already archived/i)
  })

  it('archive 404s an unknown id', async () => {
    const res = await fetch(`${base}/api/tickets/999999/archive`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('reactivates an archived ticket back onto the board at the requested step', async () => {
    const t = await makeTicket('Reactivate me')
    await moveTicket(t)
    await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    const res = await fetch(`${base}/api/tickets/${t.id}/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'todo', reason: 'reopened' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ticket: Ticket }).ticket.status).toBe('todo')

    expect((await board()).find((x) => x.id === t.id)?.status).toBe('todo')
    expect((await archive()).some((x) => x.id === t.id)).toBe(false)
    const log = readFileSync(
      join(boardRoot, 'todo', `${String(t.id).padStart(5, '0')}-${t.slug}`, 'log', `${t.id}.ndjson`),
      'utf8',
    )
    expect(log).toContain('"event":"reactivated"')
    expect(log).toContain('reopened')
  })

  it('reactivate defaults toStep to the step the ticket was archived from', async () => {
    const t = await makeTicket('Default step') // enters at idea
    await moveTicket(t)
    await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    const res = await fetch(`${base}/api/tickets/${t.id}/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { ticket: Ticket }).ticket.status).toBe('done')
  })

  it('rejects reactivating a live (non-archived) ticket (409, readable message)', async () => {
    const t = await makeTicket('Still live')
    const res = await fetch(`${base}/api/tickets/${t.id}/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'todo' }),
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toMatch(/not archived/i)
  })

  it('reactivate 404s an unknown id', async () => {
    const res = await fetch(`${base}/api/tickets/999999/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'todo' }),
    })
    expect(res.status).toBe(404)
  })

  it('reactivate rejects an invalid step with 400', async () => {
    const t = await makeTicket('Bad step')
    await moveTicket(t)
    await fetch(`${base}/api/tickets/${t.id}/archive`, { method: 'POST' })
    const res = await fetch(`${base}/api/tickets/${t.id}/reactivate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'nonexistent-step' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/tickets/:id/park + /unpark', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-parked-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  async function create(title: string): Promise<Ticket> {
    const response = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, category: 'logic' }),
    })
    return ((await response.json()) as { ticket: Ticket }).ticket
  }

  async function parked(): Promise<Ticket[]> {
    return ((await (await fetch(`${base}/api/parked`)).json()) as { tickets: Ticket[] }).tickets
  }

  it('parks from a configured step, leaves the live board, and restores automatically', async () => {
    const ticket = await create('Pause and resume')
    await fetch(`${base}/api/tickets/${ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'todo' }),
    })
    const park = await fetch(`${base}/api/tickets/${ticket.id}/park`, { method: 'POST' })
    expect(park.status).toBe(200)
    expect(((await park.json()) as { ticket: Ticket }).ticket).toMatchObject({ status: 'parked', returnStep: 'todo' })
    expect(((await (await fetch(`${base}/api/board`)).json()) as { tickets: Ticket[] }).tickets.some((item) => item.id === ticket.id)).toBe(false)
    expect((await parked()).some((item) => item.id === ticket.id)).toBe(true)

    const restore = await fetch(`${base}/api/tickets/${ticket.id}/unpark`, { method: 'POST' })
    expect(restore.status).toBe(200)
    const restored = ((await restore.json()) as { ticket: Ticket }).ticket
    expect(restored).toMatchObject({ status: 'todo' })
    expect(restored).not.toHaveProperty('returnStep')
    expect((await parked()).some((item) => item.id === ticket.id)).toBe(false)
  })

  it('returns readable conflicts for duplicate park and unpark of a live ticket', async () => {
    const ticket = await create('Park twice')
    expect((await fetch(`${base}/api/tickets/${ticket.id}/park`, { method: 'POST' })).status).toBe(200)
    const duplicate = await fetch(`${base}/api/tickets/${ticket.id}/park`, { method: 'POST' })
    expect(duplicate.status).toBe(409)
    expect(((await duplicate.json()) as { error: string }).error).toMatch(/already parked/i)

    const live = await create('Not parked')
    const wrongState = await fetch(`${base}/api/tickets/${live.id}/unpark`, { method: 'POST' })
    expect(wrongState.status).toBe(409)
    expect(((await wrongState.json()) as { error: string }).error).toMatch(/not parked/i)
  })

  it('rejects park and unpark for an archived ticket', async () => {
    const ticket = await create('Archived lifecycle conflict')
    await fetch(`${base}/api/tickets/${ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'done' }),
    })
    expect((await fetch(`${base}/api/tickets/${ticket.id}/archive`, { method: 'POST' })).status).toBe(200)

    const park = await fetch(`${base}/api/tickets/${ticket.id}/park`, { method: 'POST' })
    expect(park.status).toBe(409)
    expect(((await park.json()) as { error: string }).error).toMatch(/archived.*cannot be parked/i)

    const unpark = await fetch(`${base}/api/tickets/${ticket.id}/unpark`, { method: 'POST' })
    expect(unpark.status).toBe(409)
    expect(((await unpark.json()) as { error: string }).error).toMatch(/not parked/i)
  })

  it('falls back to the entry step when the recorded origin is removed', async () => {
    const ticket = await create('Removed origin')
    await fetch(`${base}/api/tickets/${ticket.id}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toStep: 'research' }),
    })
    await fetch(`${base}/api/tickets/${ticket.id}/park`, { method: 'POST' })
    const config = loadBoardConfig(boardRoot)
    writeBoardConfig(boardRoot, { ...config, steps: config.steps.filter((step) => step.key !== 'research') })
    expect(await waitUntil(async () => {
      const steps = ((await (await fetch(`${base}/api/steps`)).json()) as { steps: StepPayload[] }).steps
      return !steps.some((step) => step.key === 'research')
    })).toBe(true)

    const restore = await fetch(`${base}/api/tickets/${ticket.id}/unpark`, { method: 'POST' })
    expect(restore.status).toBe(200)
    expect(((await restore.json()) as { ticket: Ticket }).ticket.status).toBe('idea')
  })

  it('404s unknown ids', async () => {
    expect((await fetch(`${base}/api/tickets/999999/park`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${base}/api/tickets/999999/unpark`, { method: 'POST' })).status).toBe(404)
  })
})

describe('board layout settings', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string

  beforeAll(async () => {
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-layout-'))
    seedBoard(boardRoot)
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('reads settings from a board created before the rename and saves them under the new name', async () => {
    writeFileSync(join(boardRoot, '.hitloop-settings.json'), `${JSON.stringify({ layout: 'portrait' }, null, 2)}\n`)
    expect(await (await fetch(`${base}/api/settings/layout`)).json()).toEqual({ layout: 'portrait' })

    const saved = await fetch(`${base}/api/settings/layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'landscape' }),
    })
    expect(saved.status).toBe(200)
    expect(JSON.parse(readFileSync(join(boardRoot, '.lfad-settings.json'), 'utf8'))).toMatchObject({ layout: 'landscape' })
    rmSync(join(boardRoot, '.hitloop-settings.json'))
    rmSync(join(boardRoot, '.lfad-settings.json'))
  })

  it('defaults to auto, round-trips a value, preserves other settings, and rejects invalid input', async () => {
    expect(await (await fetch(`${base}/api/settings/layout`)).json()).toEqual({ layout: 'auto' })

    // A pre-existing, unrelated setting must survive the layout write.
    writeFileSync(join(boardRoot, '.lfad-settings.json'), `${JSON.stringify({ commandPrefix: '$' }, null, 2)}\n`)

    const saved = await fetch(`${base}/api/settings/layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'landscape' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ layout: 'landscape' })
    expect(await (await fetch(`${base}/api/settings/layout`)).json()).toEqual({ layout: 'landscape' })
    expect(JSON.parse(readFileSync(join(boardRoot, '.lfad-settings.json'), 'utf8'))).toMatchObject({
      commandPrefix: '$',
      layout: 'landscape',
    })

    const rejected = await fetch(`${base}/api/settings/layout`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ layout: 'sideways' }),
    })
    expect(rejected.status).toBe(400)
    // The rejected write left the stored value untouched.
    expect(await (await fetch(`${base}/api/settings/layout`)).json()).toEqual({ layout: 'landscape' })
  })
})
