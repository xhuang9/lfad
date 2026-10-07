/**
 * Degraded-entry behaviour for unreadable ticket folders: a `NNNN-slug` folder
 * whose ticket.md is corrupt, missing, or id-less must SURFACE in board
 * listings (with the `unreadable` marker) instead of silently vanishing, while
 * healthy tickets and mutations keep their exact existing behaviour.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { BoardConfig, Ticket } from '../src/index.js'
import {
  createTicket,
  listArchive,
  listStep,
  moveTicket,
  readBoard,
  updateFrontmatter,
} from '../src/index.js'
import { makeTestConfig } from './helpers.js'

let root: string
let config: BoardConfig

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lfad-unreadable-'))
  config = makeTestConfig()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** YAML frontmatter that reliably fails to parse (unterminated double quote). */
const BROKEN_TICKET_MD = '---\nid: 7\ntitle: "unterminated\n---\n\nBody text.\n'

/** Creates a `NNNN-slug` folder in `step`, optionally writing a ticket.md. */
function plantFolder(step: string, id: number, slug: string, ticketMd?: string): void {
  const dir = join(root, step, `${String(id).padStart(5, '0')}-${slug}`)
  mkdirSync(dir, { recursive: true })
  if (ticketMd !== undefined) writeFileSync(join(dir, 'ticket.md'), ticketMd, 'utf8')
}

describe('unreadable ticket folders surface as degraded entries', () => {
  it('readBoard includes a corrupted ticket.md as a marked degraded entry', () => {
    const healthy = createTicket(root, config, { title: 'Healthy', category: 'logic' })
    plantFolder('todo', 7, 'broken-ticket', BROKEN_TICKET_MD)

    const board = readBoard(root, config)
    expect(board.map((t) => t.id)).toEqual([healthy.id, 7])

    const degraded = board.find((t) => t.id === 7)!
    expect(degraded).toMatchObject({
      id: 7,
      slug: 'broken-ticket',
      title: '(unreadable ticket.md)',
      status: 'todo',
      unreadable: true,
      tags: [],
      history: [],
    })
    expect(degraded.unreadableError).toBeTruthy()

    const ok = board.find((t) => t.id === healthy.id)!
    expect(ok.unreadable).toBeUndefined()
    expect(ok.title).toBe('Healthy')
  })

  it('listStep includes the degraded entry in the step it physically sits in', () => {
    plantFolder('todo', 7, 'broken-ticket', BROKEN_TICKET_MD)
    const todo = listStep(root, config, 'todo')
    expect(todo.map((t) => [t.id, t.unreadable])).toEqual([[7, true]])
    expect(listStep(root, config, 'idea')).toEqual([])
  })

  it('a ticket folder with no ticket.md at all degrades instead of vanishing', () => {
    plantFolder('plan', 8, 'no-ticket-md')
    const degraded = readBoard(root, config).find((t) => t.id === 8)!
    expect(degraded.unreadable).toBe(true)
    expect(degraded.status).toBe('plan')
    expect(degraded.slug).toBe('no-ticket-md')
  })

  it('valid YAML without a usable id degrades under the folder id — never a NaN ticket', () => {
    plantFolder('todo', 9, 'id-less', '---\ntitle: Lost my id\nstatus: todo\n---\n')
    const board = readBoard(root, config)
    expect(board.every((t) => Number.isSafeInteger(t.id))).toBe(true)
    const degraded = board.find((t) => t.id === 9)!
    expect(degraded.unreadable).toBe(true)
    expect(degraded.unreadableError).toContain('no usable id')
  })

  it('degraded entries appear in the archive listing too', () => {
    plantFolder('_archive', 12, 'broken-archived', BROKEN_TICKET_MD)
    const archived = listArchive(root, config)
    expect(archived.map((t) => [t.id, t.unreadable])).toEqual([[12, true]])
  })

  it('mutations on an unreadable id still fail loudly', () => {
    plantFolder('todo', 7, 'broken-ticket', BROKEN_TICKET_MD)
    expect(() => moveTicket(root, config, 7, 'doing')).toThrow()
    expect(() => updateFrontmatter(root, config, 7, { title: 'nope' })).toThrow()
    // The broken folder is untouched — the degraded entry is still listed.
    expect(listStep(root, config, 'todo').map((t) => t.id)).toEqual([7])
  })

  it('repeated reads stay deterministically degraded with the same parse error (no gray-matter cache poisoning)', () => {
    plantFolder('todo', 7, 'broken-ticket', BROKEN_TICKET_MD)
    const first = readBoard(root, config).find((t) => t.id === 7)!
    const second = readBoard(root, config).find((t) => t.id === 7)!
    expect(first.unreadable).toBe(true)
    expect(second.unreadable).toBe(true)
    // Same YAML error both times — never the NaN-id fallback a poisoned
    // gray-matter cache used to produce on the second read of one content.
    expect(second.unreadableError).toBe(first.unreadableError)
    expect(first.unreadableError).toContain('double quoted scalar')
  })

  it('a healthy board is unchanged: no entry carries the unreadable marker', () => {
    createTicket(root, config, { title: 'One', category: 'ui' })
    const two = createTicket(root, config, { title: 'Two', category: 'bug' })
    moveTicket(root, config, two.id, 'doing')

    const board = readBoard(root, config)
    expect(board).toHaveLength(2)
    for (const ticket of board) {
      expect('unreadable' in ticket).toBe(false)
      expect('unreadableError' in ticket).toBe(false)
    }
  })

  it('degraded entries sort by id among healthy tickets', () => {
    const a = createTicket(root, config, { title: 'A', category: 'logic' })
    plantFolder('idea', 5, 'broken', BROKEN_TICKET_MD)
    const ids = readBoard(root, config).map((t: Ticket) => t.id)
    expect(ids).toEqual([...ids].sort((x, y) => x - y))
    expect(ids).toContain(a.id)
    expect(ids).toContain(5)
  })
})
