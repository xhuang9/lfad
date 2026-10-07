/**
 * Unreadable ticket folders must reach the board surface instead of silently
 * vanishing: BoardIndex carries the degraded entry (open inputs pinned to 0,
 * one console.error per unreadable folder per rebuild), and /api/board ships
 * it through the ordinary ticket mapping. Detail/mutation routes keep failing
 * loudly on the broken id.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTicket, type Ticket } from '@lfad/core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { BoardIndex } from '../src/board-index.js'
import { createServer, type RunningServer } from '../src/index.js'
import { seedBoard } from '../src/seed.js'
import { makeFullFixtureBoard } from './helpers.js'

/** YAML frontmatter that reliably fails to parse (unterminated double quote). */
const BROKEN_TICKET_MD = '---\nid: 99\ntitle: "unterminated\n---\n\nBody.\n'

/** Plants a `NNNN-slug` ticket folder with a corrupt ticket.md in `step`. */
function plantBrokenFolder(root: string, step: string, id: number, slug: string): void {
  const dir = join(root, step, `${String(id).padStart(5, '0')}-${slug}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'ticket.md'), BROKEN_TICKET_MD, 'utf8')
}

describe('BoardIndex: degraded entries index gracefully and log once per rebuild', () => {
  it('carries the degraded ticket, pins openInputs to 0, and console.errors the folder', () => {
    const { root, config } = makeFullFixtureBoard('lfad-unreadable-')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const healthy = createTicket(root, config, { title: 'Healthy', category: 'logic' })
      plantBrokenFolder(root, 'todo', 99, 'broken')

      const index = new BoardIndex(root, () => config)
      index.rebuild()

      expect(index.all().map((t) => t.id)).toEqual([healthy.id, 99])
      const degraded = index.get(99)!
      expect(degraded.unreadable).toBe(true)
      expect(degraded.status).toBe('todo')
      expect(index.openInputs(99)).toBe(0)

      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0]![0])).toContain('todo/00099-broken')

      index.rebuild()
      expect(spy).toHaveBeenCalledTimes(2) // one more rebuild, one more line
    } finally {
      spy.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('GET /api/board surfaces unreadable ticket folders (seeded board + corrupt folder)', () => {
  let boardRoot: string
  let server: RunningServer
  let base: string
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // The daemon legitimately console.errors each unreadable folder per
    // rebuild; keep the test output clean while the fixture is corrupt.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    boardRoot = mkdtempSync(join(tmpdir(), 'lfad-unreadable-srv-'))
    seedBoard(boardRoot)
    plantBrokenFolder(boardRoot, 'todo', 99, 'broken')
    server = await createServer({ boardRoot }).start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterAll(async () => {
    await server.close()
    errorSpy.mockRestore()
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('ships the degraded entry through the ordinary ticket mapping', async () => {
    const res = await fetch(`${base}/api/board`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { tickets: (Ticket & { openInputs?: number })[] }

    const degraded = body.tickets.find((t) => t.id === 99)
    expect(degraded).toMatchObject({
      id: 99,
      slug: 'broken',
      status: 'todo',
      title: '(unreadable ticket.md)',
      unreadable: true,
      openInputs: 0,
    })
    expect(degraded!.unreadableError).toBeTruthy()

    // The seeded healthy tickets are untouched by the corrupt neighbour.
    const healthy = body.tickets.filter((t) => t.id !== 99)
    expect(healthy.length).toBeGreaterThan(0)
    expect(healthy.every((t) => t.unreadable === undefined)).toBe(true)
  })

  it('the detail route still fails loudly (404) for the unreadable id', async () => {
    const res = await fetch(`${base}/api/tickets/99`)
    expect(res.status).toBe(404)
  })
})
