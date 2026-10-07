/**
 * Behavioural test suite for the @lfad/core file-operation surface.
 * Every test runs against a fresh temp board dir (with the full 14-step test
 * config threaded explicitly), cleaned up afterwards.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  allocateId,
  appendArtifact,
  appendLog,
  appendLogAt,
  archiveTicket,
  createTicket,
  listArchive,
  listParked,
  listStep,
  listTicketFiles,
  moveTicket,
  parkTicket,
  nextStep,
  reactivateTicket,
  readBoard,
  readTicket,
  renameActiveTicketTags,
  reconcileStatus,
  resolveBlock,
  setBlocked,
  setBody,
  setSession,
  setStepNote,
  setWorktree,
  updateFrontmatter,
  unparkTicket,
  validateTicket,
} from '../src/index.js'
import type { BoardConfig, Ticket } from '../src/index.js'
import { parseTicketFile, serializeTicketFile } from '../src/frontmatter.js'
import { makeTestConfig } from './helpers.js'

let root: string
let config: BoardConfig

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lfad-'))
  config = makeTestConfig()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Builds a minimal, contract-valid ticket for validation-only assertions. */
function makeValidTicket(over: Partial<Ticket> = {}): Ticket {
  const now = '2026-06-29T00:00:00.000Z'
  return {
    id: 1,
    slug: 'foo',
    title: 'Foo',
    status: 'idea',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'idea', at: now }],
    ...over,
  }
}

/** Absolute path to a ticket's on-disk folder for a given step. */
function ticketDir(stepFolder: string, id: number, slug: string): string {
  return join(root, stepFolder, `${String(id).padStart(5, '0')}-${slug}`)
}

describe('createTicket / readTicket', () => {
  it('round-trips a ticket through disk with a stable frontmatter spine', () => {
    const created = createTicket(root, config, {
      title: 'Add dark mode',
      category: 'ui',
      body: 'We want a dark theme.\n',
      tags: ['theme', 'ux'],
      needsDesign: true,
    })

    expect(created.id).toBe(1)
    expect(created.slug).toBe('add-dark-mode')
    expect(created.status).toBe('idea')
    expect(created.category).toBe('ui')
    expect(created.tags).toEqual(['theme', 'ux'])
    expect(created.needsDesign).toBe(true)
    // createdAt parseable and history seeded with the entry step at the same instant.
    expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false)
    expect(created.createdAt).toBe(created.updatedAt)
    expect(created.history).toEqual([{ step: 'idea', at: created.createdAt }])

    // The persisted ticket is byte-for-byte equal to the returned object.
    expect(readTicket(root, config, created.id)).toEqual(created)
    expect(validateTicket(config, created)).toEqual([])
    expect(existsSync(join(ticketDir('idea', 1, 'add-dark-mode'), 'ticket.md'))).toBe(true)
  })

  it('defaults entryStep to the first entry:true step and respects an explicit entryStep', () => {
    const t = createTicket(root, config, { title: 'Straight to plan', category: 'logic', entryStep: 'plan' })
    expect(t.status).toBe('plan')
    expect(existsSync(ticketDir('plan', t.id, t.slug))).toBe(true)
  })
})

describe('allocateId', () => {
  it('is monotonic on a fresh board', () => {
    expect(allocateId(root, config)).toBe(1)
    expect(allocateId(root, config)).toBe(2)
    expect(allocateId(root, config)).toBe(3)
  })

  it('recomputes from disk when the .counter file is missing', () => {
    createTicket(root, config, { title: 'One', category: 'logic' }) // id 1
    createTicket(root, config, { title: 'Two', category: 'logic' }) // id 2
    rmSync(join(root, '.counter'), { force: true })
    // No counter on disk -> max existing id (2) + 1.
    expect(allocateId(root, config)).toBe(3)
    // And the counter is re-established, so subsequent allocations stay monotonic.
    expect(allocateId(root, config)).toBe(4)
  })

  it('never re-issues an existing id when the .counter lags the tickets on disk', () => {
    createTicket(root, config, { title: 'One', category: 'logic' }) // id 1
    createTicket(root, config, { title: 'Two', category: 'logic' }) // id 2
    // A stale counter (partial snapshot restore, hand-copied ticket folder)
    // must reconcile with the disk max instead of re-issuing id 2.
    writeFileSync(join(root, '.counter'), '1\n', 'utf8')
    expect(allocateId(root, config)).toBe(3)
    expect(allocateId(root, config)).toBe(4)
  })
})

describe('moveTicket', () => {
  it('relocates the folder, updates status, appends history, and reflects on the board', () => {
    const t = createTicket(root, config, { title: 'Move me', category: 'logic' })
    const moved = moveTicket(root, config, t.id, 'plan', { reason: 'ready', actor: 'tester' })

    expect(moved.status).toBe('plan')
    expect(moved.history.map((h) => h.step)).toEqual(['idea', 'plan'])
    expect(moved.updatedAt >= moved.createdAt).toBe(true)

    // Folder physically moved from idea -> plan.
    expect(existsSync(ticketDir('idea', t.id, t.slug))).toBe(false)
    expect(existsSync(ticketDir('plan', t.id, t.slug))).toBe(true)

    // Board + step listings reflect the move.
    const board = readBoard(root, config)
    expect(board).toHaveLength(1)
    expect(board[0]!.status).toBe('plan')
    expect(listStep(root, config, 'plan').map((x) => x.id)).toEqual([t.id])
    expect(listStep(root, config, 'idea')).toEqual([])

    // The move reason/actor were logged.
    const log = readFileSync(join(ticketDir('plan', t.id, t.slug), 'log', `${t.id}.ndjson`), 'utf8')
    expect(log).toContain('"event":"move"')
    expect(log).toContain('"actor":"tester"')
  })

  it('preserves history and step notes after a past step is removed from config', () => {
    const created = createTicket(root, config, { title: 'Pipeline changed', category: 'logic' })
    moveTicket(root, config, created.id, 'shape')
    setStepNote(root, config, created.id, 'shape', { applicable: true, reason: 'completed' })
    const current = moveTicket(root, config, created.id, 'plan')
    const configWithoutShape: BoardConfig = {
      ...config,
      steps: config.steps.filter((step) => step.key !== 'shape'),
    }

    expect(validateTicket(configWithoutShape, current)).toEqual([])

    const moved = moveTicket(root, configWithoutShape, created.id, 'doing')
    expect(moved.status).toBe('doing')
    expect(moved.history.map((entry) => entry.step)).toEqual(['idea', 'shape', 'plan', 'doing'])
    expect(moved.stepNotes?.shape).toEqual({ applicable: true, reason: 'completed' })

    const issues = validateTicket(configWithoutShape, { ...moved, status: 'bogus' })
    expect(issues.some((issue) => issue.field === 'status')).toBe(true)
  })
})

describe('setBlocked / resolveBlock', () => {
  it('sets returnStep on block and restores it on resolve', () => {
    const t = createTicket(root, config, { title: 'Block me', category: 'bug' })
    moveTicket(root, config, t.id, 'doing')

    const blocked = setBlocked(root, config, t.id, {
      question: 'Which API?',
      context: 'The client contract must stay stable.',
      options: ['A', 'B'],
      recommendation: 'Choose B.',
    })
    expect(blocked.status).toBe('blocked')
    expect(blocked.returnStep).toBe('doing')
    expect(validateTicket(config, blocked)).toEqual([])
    const blockPath = join(ticketDir('blocked', t.id, t.slug), 'blocked.md')
    expect(existsSync(blockPath)).toBe(true)
    expect(readFileSync(blockPath, 'utf8')).toBe([
      '# Blocked',
      '',
      '**Question:** Which API?',
      '',
      '## Context',
      '',
      'The client contract must stay stable.',
      '',
      '## Options',
      '',
      '- A',
      '- B',
      '',
      '**Recommendation:** Choose B.',
      '',
      '**Decision:**',
      '',
    ].join('\n'))
    expect(listStep(root, config, 'blocked').map((x) => x.id)).toEqual([t.id])

    const resolved = resolveBlock(root, config, t.id, { choice: 'A' })
    expect(resolved.status).toBe('doing')
    expect(resolved.returnStep).toBeUndefined()
    expect(validateTicket(config, resolved)).toEqual([])
    expect(existsSync(ticketDir('doing', t.id, t.slug))).toBe(true)
    expect(existsSync(ticketDir('blocked', t.id, t.slug))).toBe(false)
  })

  it('does not create an input slot for a block without a question', () => {
    const t = createTicket(root, config, { title: 'Reason only', category: 'logic' })
    const blocked = setBlocked(root, config, t.id, { context: 'Waiting for an external dependency.' })
    const content = readFileSync(join(ticketDir('blocked', t.id, t.slug), 'blocked.md'), 'utf8')

    expect(blocked.returnStep).toBe('idea')
    expect(content).toContain('Waiting for an external dependency.')
    expect(content).not.toContain('**Decision:**')
  })

  it('throws when resolving a ticket that is not blocked', () => {
    const t = createTicket(root, config, { title: 'Not blocked', category: 'logic' })
    expect(() => resolveBlock(root, config, t.id)).toThrow(/not blocked/)
  })
})

describe('archiveTicket / reactivateTicket', () => {
  it('removes from the board on archive and restores it on reactivate', () => {
    const t = createTicket(root, config, { title: 'Archive me', category: 'refactor' })

    archiveTicket(root, config, t.id, { reason: 'superseded' })
    expect(readBoard(root, config)).toEqual([]) // gone from live board
    expect(readTicket(root, config, t.id).id).toBe(t.id) // still readable from _archive
    expect(existsSync(ticketDir('_archive', t.id, t.slug))).toBe(true)
    expect(listArchive(root, config).map((ticket) => ticket.id)).toEqual([t.id])

    const back = reactivateTicket(root, config, t.id, 'todo')
    expect(back.status).toBe('todo')
    expect(readBoard(root, config).map((x) => x.id)).toEqual([t.id])
    expect(listStep(root, config, 'todo').map((x) => x.id)).toEqual([t.id])
    expect(existsSync(ticketDir('_archive', t.id, t.slug))).toBe(false)
    expect(listArchive(root, config)).toEqual([])
  })

  it('lists archived tickets in id order, surfacing unreadable ticket folders as degraded entries', () => {
    const first = createTicket(root, config, { title: 'First archive', category: 'logic' })
    const second = createTicket(root, config, { title: 'Second archive', category: 'bug' })

    archiveTicket(root, config, second.id)
    archiveTicket(root, config, first.id)
    mkdirSync(join(root, '_archive', 'not-a-ticket'), { recursive: true })
    mkdirSync(join(root, '_archive', '00099-broken'), { recursive: true })

    // Non-ticket folder names stay invisible; a ticket-named folder without a
    // readable ticket.md surfaces as a degraded entry instead of vanishing.
    const archived = listArchive(root, config)
    expect(archived.map((ticket) => ticket.id)).toEqual([first.id, second.id, 99])
    expect(archived.map((ticket) => ticket.unreadable)).toEqual([undefined, undefined, true])
  })
})

describe('parkTicket / unparkTicket', () => {
  it('moves a ticket out of the board, preserves artifacts, and restores its origin', () => {
    const ticket = createTicket(root, config, { title: 'Park me', category: 'logic' })
    moveTicket(root, config, ticket.id, 'doing')
    appendArtifact(root, config, ticket.id, 'doing/00-note.md', 'Built so far.\n')

    const parked = parkTicket(root, config, ticket.id)
    expect(parked).toMatchObject({ status: 'parked', returnStep: 'doing' })
    expect(readBoard(root, config)).toEqual([])
    expect(listParked(root, config).map((item) => item.id)).toEqual([ticket.id])
    expect(existsSync(join(ticketDir('parked', ticket.id, ticket.slug), 'doing', '00-note.md'))).toBe(true)

    const restored = unparkTicket(root, config, ticket.id)
    expect(restored.status).toBe('doing')
    expect(restored.returnStep).toBeUndefined()
    expect(readBoard(root, config).map((item) => item.id)).toEqual([ticket.id])
    expect(listParked(root, config)).toEqual([])
  })

  it('rejects duplicate park and falls back to the entry step when the origin was removed', () => {
    const ticket = createTicket(root, config, { title: 'Changed pipeline', category: 'logic' })
    moveTicket(root, config, ticket.id, 'plan')
    parkTicket(root, config, ticket.id)
    expect(() => parkTicket(root, config, ticket.id)).toThrow(/already parked/i)

    const changed = { ...config, steps: config.steps.filter((step) => step.key !== 'plan') }
    const restored = unparkTicket(root, changed, ticket.id)
    expect(restored.status).toBe('idea')
    const log = readFileSync(join(ticketDir('idea', ticket.id, ticket.slug), 'log', `${ticket.id}.ndjson`), 'utf8')
    expect(log).toContain("Recorded origin 'plan' no longer exists")
  })
})

describe('frontmatter round-trip', () => {
  it('serialize -> parse is lossless for the full spine and a newline-terminated body', () => {
    const ticket: Ticket = {
      id: 7,
      slug: 'full-ticket',
      title: 'Full ticket',
      status: 'blocked',
      category: 'business',
      tags: ['a', 'b'],
      needsDesign: true,
      automationLevel: 'express',
      worktree: '/wt/feature-x',
      sessionId: 'sess_123',
      returnStep: 'doing',
      dependencies: [
        { ticketId: 1, blockAtStage: 'doing', unblockWhen: 'done' },
        { ticketId: 2, blockAtStage: 'review', unblockWhen: 'design-approved' },
        { ticketId: 3, blockAtStage: 'done', unblockWhen: 'archived' },
      ],
      createdAt: '2026-06-29T01:02:03.456Z',
      updatedAt: '2026-06-29T04:05:06.789Z',
      history: [
        { step: 'idea', at: '2026-06-29T01:02:03.456Z' },
        { step: 'doing', at: '2026-06-29T02:00:00.000Z' },
        { step: 'blocked', at: '2026-06-29T04:05:06.789Z' },
      ],
      stepNotes: {
        design: { applicable: false, reason: 'no UI surface' },
        checks: { applicable: true },
      },
    }
    const body = '# Full ticket\n\nThe prompt body.\n'

    const { data, body: outBody } = parseTicketFile(serializeTicketFile(ticket, body))
    expect(data).toEqual(ticket)
    expect(outBody).toBe(body)
    expect(validateTicket(config, data)).toEqual([])
  })

  it('round-trips automationLevel for each level and omits the key when absent', () => {
    for (const level of ['normal', 'express', 'manual'] as const) {
      const ticket = makeValidTicket({ automationLevel: level })
      const { data } = parseTicketFile(serializeTicketFile(ticket, 'Body.\n'))
      expect(data).toEqual(ticket)
      expect(validateTicket(config, data)).toEqual([])
    }
    // Absent = 'normal': no automationLevel key is written, and none appears on read.
    const serialized = serializeTicketFile(makeValidTicket(), 'Body.\n')
    expect(serialized).not.toContain('automationLevel')
    expect(parseTicketFile(serialized).data.automationLevel).toBeUndefined()
  })

  it('normalizes legacy frontmatter keys (stageNotes / history[].stage / returnStage) on read', () => {
    const legacy = [
      '---',
      'id: 9',
      'slug: legacy-ticket',
      'title: Legacy ticket',
      'status: blocked',
      'category: bug',
      'tags: []',
      'returnStage: doing',
      "createdAt: '2026-06-29T01:00:00.000Z'",
      "updatedAt: '2026-06-29T02:00:00.000Z'",
      'history:',
      "  - stage: idea",
      "    at: '2026-06-29T01:00:00.000Z'",
      "  - stage: doing",
      "    at: '2026-06-29T01:30:00.000Z'",
      "  - stage: blocked",
      "    at: '2026-06-29T02:00:00.000Z'",
      'stageNotes:',
      '  design:',
      '    applicable: false',
      '    reason: no UI',
      '---',
      'A legacy body.',
      '',
    ].join('\n')

    const { data, body } = parseTicketFile(legacy)
    expect(data.returnStep).toBe('doing')
    expect(data.history.map((h) => h.step)).toEqual(['idea', 'doing', 'blocked'])
    expect(data.stepNotes?.design).toEqual({ applicable: false, reason: 'no UI' })
    expect(body).toBe('A legacy body.\n')
    expect(validateTicket(config, data)).toEqual([])

    // Serializing writes the new keys only.
    const serialized = serializeTicketFile(data, body)
    expect(serialized).toContain('returnStep: doing')
    expect(serialized).toContain('stepNotes:')
    expect(serialized).toContain('- step: idea')
    expect(serialized).not.toContain('returnStage')
    expect(serialized).not.toContain('stageNotes')
    expect(serialized).not.toContain('- stage:')
    // And the round-trip of the serialized form is stable.
    expect(parseTicketFile(serialized).data).toEqual(data)

    // Legacy keys are normalized, NOT preserved as extras — they never resurrect.
    expect(data.extras).toBeUndefined()
  })
})

describe('frontmatter extras (unknown-key preservation)', () => {
  /** A raw ticket.md with unknown keys: scalar, array, and nested map. */
  const rawWithExtras = [
    '---',
    'id: 4',
    'slug: extras-ticket',
    'title: Extras ticket',
    'status: idea',
    'category: logic',
    'tags: []',
    "createdAt: '2026-07-01T00:00:00.000Z'",
    "updatedAt: '2026-07-01T00:00:00.000Z'",
    'history:',
    '  - step: idea',
    "    at: '2026-07-01T00:00:00.000Z'",
    'needsMigration: true',
    'priority: 3',
    'aliases:',
    '  - obsidian-note',
    '  - extras',
    'reviewers:',
    '  lead: sam',
    '  backup:',
    '    - kim',
    '    - lee',
    '---',
    'Body.',
    '',
  ].join('\n')

  it('collects unknown keys into extras on parse (scalars, arrays, nested maps)', () => {
    const { data } = parseTicketFile(rawWithExtras)
    expect(data.extras).toEqual({
      needsMigration: true,
      priority: 3,
      aliases: ['obsidian-note', 'extras'],
      reviewers: { lead: 'sam', backup: ['kim', 'lee'] },
    })
    // The unknown keys do not leak onto the typed spine.
    expect(data.title).toBe('Extras ticket')
    expect(validateTicket(config, data)).toEqual([])
  })

  it('omits extras entirely when there are no unknown keys', () => {
    const t = createTicket(root, config, { title: 'No extras', category: 'logic' })
    expect(t.extras).toBeUndefined()
    expect(readTicket(root, config, t.id).extras).toBeUndefined()
  })

  it('parse -> serialize is stable for unknown keys (fixed point, no literal extras key)', () => {
    const first = parseTicketFile(rawWithExtras)
    const s1 = serializeTicketFile(first.data, first.body)
    const second = parseTicketFile(s1)
    expect(second.data).toEqual(first.data)
    const s2 = serializeTicketFile(second.data, second.body)
    expect(s2).toBe(s1) // byte-stable round-trip
    expect(s1).toContain('needsMigration: true')
    expect(s1).toContain('reviewers:')
    expect(s1).not.toContain('extras:') // flattened, never a literal extras map
  })

  it('a literal extras: map in raw frontmatter is flattened, not nested', () => {
    const raw = rawWithExtras.replace('needsMigration: true', 'extras:\n  fromOldWriter: yes-indeed')
    const { data, body } = parseTicketFile(raw)
    expect(data.extras?.fromOldWriter).toBe('yes-indeed')
    const serialized = serializeTicketFile(data, body)
    expect(serialized).toContain('fromOldWriter: yes-indeed')
    expect(serialized).not.toContain('extras:')
  })

  it('an extras key colliding with a known key cannot corrupt the ticket (known keys win)', () => {
    const ticket = makeValidTicket({
      extras: { status: 'evil', id: 999, stageNotes: { hack: true }, custom: 'kept' },
    })
    const serialized = serializeTicketFile(ticket, 'Body.\n')
    // The canonical values are emitted exactly once; the colliding extras are dropped.
    expect(serialized.match(/^status:/gm)).toHaveLength(1)
    expect(serialized).toContain('status: idea')
    expect(serialized.match(/^id:/gm)).toHaveLength(1)
    expect(serialized).toContain('id: 1')
    expect(serialized).not.toContain('stageNotes') // legacy aliases never resurrect
    expect(serialized).toContain('custom: kept')

    const { data } = parseTicketFile(serialized)
    expect(data.status).toBe('idea')
    expect(data.id).toBe(1)
    expect(data.extras).toEqual({ custom: 'kept' })
    expect(validateTicket(config, data)).toEqual([])
  })

  it('extras survive a moveTicket rewrite and nextStep honours a custom skipUnless flag', () => {
    const t = createTicket(root, config, { title: 'Custom flag', category: 'logic' })
    updateFrontmatter(root, config, t.id, { extras: { needsMigration: true } })
    const moved = moveTicket(root, config, t.id, 'plan')
    expect(moved.extras).toEqual({ needsMigration: true })

    // The flag is flat on disk after the relocate rewrite.
    const onDisk = readFileSync(join(ticketDir('plan', t.id, t.slug), 'ticket.md'), 'utf8')
    expect(onDisk).toContain('needsMigration: true')
    expect(onDisk).not.toContain('extras:')

    // A step gated on the custom flag is entered for this ticket, skipped otherwise.
    const gated = makeTestConfig()
    gated.steps.splice(3, 0, { key: 'migrate', label: 'Migrate', type: 'agent', row: 'agents', skipUnless: 'needsMigration' })
    expect(nextStep(gated, 'plan', moved)).toBe('migrate')
    const plain = createTicket(root, config, { title: 'No flag', category: 'logic' })
    expect(nextStep(gated, 'plan', plain)).not.toBe('migrate')
  })
})

describe('validateTicket', () => {
  it('returns no issues for a valid ticket', () => {
    expect(validateTicket(config, makeValidTicket())).toEqual([])
  })

  it('accepts the hotfix category', () => {
    expect(validateTicket(config, makeValidTicket({ category: 'hotfix' }))).toEqual([])
  })

  it('accepts each automation level and catches an unknown one', () => {
    for (const level of ['normal', 'express', 'manual'] as const) {
      expect(validateTicket(config, makeValidTicket({ automationLevel: level }))).toEqual([])
    }
    const issues = validateTicket(config, makeValidTicket({ automationLevel: 'turbo' as Ticket['automationLevel'] }))
    expect(issues.some((i) => i.field === 'automationLevel')).toBe(true)
  })

  it('catches a status that is not a config step', () => {
    const issues = validateTicket(config, makeValidTicket({ status: 'nonsense' }))
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.field === 'status')).toBe(true)
  })

  it('catches an empty title', () => {
    const issues = validateTicket(config, makeValidTicket({ title: '' }))
    expect(issues.some((i) => i.field === 'title')).toBe(true)
  })

  it('catches returnStep present without blocked status', () => {
    const issues = validateTicket(config, makeValidTicket({ status: 'todo', returnStep: 'todo' }))
    expect(issues.some((i) => i.field === 'returnStep')).toBe(true)
  })

  it('catches blocked status without returnStep', () => {
    const issues = validateTicket(config, makeValidTicket({ status: 'blocked' }))
    expect(issues.some((i) => i.field === 'returnStep')).toBe(true)
  })

  it('accepts parked with returnStep and rejects parked without it', () => {
    expect(validateTicket(config, makeValidTicket({ status: 'parked', returnStep: 'todo' }))).toEqual([])
    expect(validateTicket(config, makeValidTicket({ status: 'parked' })).some((issue) => issue.field === 'returnStep')).toBe(true)
  })
})

describe('frontmatter mutators', () => {
  it('updateFrontmatter renames the folder when the slug changes and bumps updatedAt', () => {
    const t = createTicket(root, config, { title: 'Rename me', category: 'logic' })
    const updated = updateFrontmatter(root, config, t.id, { slug: 'renamed', tags: ['x'] })
    expect(updated.slug).toBe('renamed')
    expect(updated.tags).toEqual(['x'])
    expect(existsSync(ticketDir('idea', t.id, 'rename-me'))).toBe(false)
    expect(existsSync(ticketDir('idea', t.id, 'renamed'))).toBe(true)
  })

  it('updateFrontmatter refuses to change id or status', () => {
    const t = createTicket(root, config, { title: 'Guarded', category: 'logic' })
    expect(() => updateFrontmatter(root, config, t.id, { status: 'plan' })).toThrow(/status/)
    expect(() => updateFrontmatter(root, config, t.id, { id: 999 })).toThrow(/id/)
  })

  it('setWorktree prefers path over branch, setSession stores the session id', () => {
    const t = createTicket(root, config, { title: 'Wt', category: 'logic' })
    expect(setWorktree(root, config, t.id, { path: '/wt/x', branch: 'feat' }).worktree).toBe('/wt/x')
    expect(setWorktree(root, config, t.id, { branch: 'only-branch' }).worktree).toBe('only-branch')
    expect(setSession(root, config, t.id, 'sess_abc').sessionId).toBe('sess_abc')
  })

  it('setStepNote records a per-step applicability note', () => {
    const t = createTicket(root, config, { title: 'Note', category: 'logic' })
    const noted = setStepNote(root, config, t.id, 'design', { applicable: false, reason: 'no UI' })
    expect(noted.stepNotes?.design).toEqual({ applicable: false, reason: 'no UI' })
    expect(readTicket(root, config, t.id).stepNotes?.design).toEqual({ applicable: false, reason: 'no UI' })
  })
})

describe('renameActiveTicketTags', () => {
  it('renames case-insensitive exact matches on live tickets in one pass', () => {
    const first = createTicket(root, config, {
      title: 'First',
      category: 'logic',
      tags: ['Blog', 'b', 'catalog'],
    })
    const second = createTicket(root, config, {
      title: 'Second',
      category: 'logic',
      tags: ['B', 'other'],
    })

    const result = renameActiveTicketTags(root, config, [
      { from: 'blog', to: 'writing' },
      { from: 'b', to: 'blog' },
    ])

    expect(result).toEqual({ updated: 2, ticketIds: [first.id, second.id] })
    expect(readTicket(root, config, first.id).tags).toEqual(['writing', 'blog', 'catalog'])
    expect(readTicket(root, config, second.id).tags).toEqual(['blog', 'other'])
  })

  it('leaves archived tickets unchanged', () => {
    const active = createTicket(root, config, { title: 'Active', category: 'logic', tags: ['blog'] })
    const archived = createTicket(root, config, { title: 'Archived', category: 'logic', tags: ['blog'] })
    archiveTicket(root, config, archived.id)

    expect(renameActiveTicketTags(root, config, [{ from: 'blog', to: 'writing' }])).toEqual({
      updated: 1,
      ticketIds: [active.id],
    })
    expect(readTicket(root, config, active.id).tags).toEqual(['writing'])
    expect(readTicket(root, config, archived.id).tags).toEqual(['blog'])
  })
})

describe('setBody', () => {
  it('replaces only the markdown body, leaving frontmatter intact and bumping updatedAt', () => {
    const created = createTicket(root, config, {
      title: 'Body edit',
      category: 'logic',
      body: '# Original\n\nold body text\n',
      tags: ['a', 'b'],
    })
    const dir = ticketDir('idea', created.id, created.slug)

    // Precondition: the original body is on disk.
    const before = parseTicketFile(readFileSync(join(dir, 'ticket.md'), 'utf8'))
    expect(before.body).toContain('old body text')

    const updated = setBody(root, config, created.id, '# New\n\nbrand new body\n')

    // The returned spine is unchanged except for a bumped updatedAt.
    expect(updated.id).toBe(created.id)
    expect(updated.title).toBe('Body edit')
    expect(updated.slug).toBe(created.slug)
    expect(updated.status).toBe('idea')
    expect(updated.category).toBe('logic')
    expect(updated.tags).toEqual(['a', 'b'])
    expect(updated.history).toEqual(created.history)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt >= created.updatedAt).toBe(true)

    // Disk shows the new body with the same frontmatter spine.
    const after = parseTicketFile(readFileSync(join(dir, 'ticket.md'), 'utf8'))
    expect(after.body).toBe('# New\n\nbrand new body\n')
    expect(after.data.title).toBe('Body edit')
    expect(after.data.id).toBe(created.id)
    expect(after.data.history).toEqual(created.history)

    // readTicket reflects the bumped updatedAt and the unchanged spine.
    const read = readTicket(root, config, created.id)
    expect(read.updatedAt).toBe(updated.updatedAt)
    expect(read.title).toBe('Body edit')
    expect(validateTicket(config, read)).toEqual([])
  })

  it('throws when the ticket id does not exist', () => {
    expect(() => setBody(root, config, 999, 'nope')).toThrow(/not found/)
  })
})

describe('artifacts and logs', () => {
  it('appendArtifact writes a named file into the ticket folder', () => {
    const t = createTicket(root, config, { title: 'Artifact', category: 'logic' })
    appendArtifact(root, config, t.id, 'plan.md', '# Plan\n')
    const dir = ticketDir('idea', t.id, t.slug)
    expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toBe('# Plan\n')
  })

  it('appendArtifact writes nested relative paths, creating parent folders', () => {
    const t = createTicket(root, config, { title: 'Nested', category: 'logic' })
    appendArtifact(root, config, t.id, 'plan/01-area.md', '# Area\n')
    expect(readFileSync(join(ticketDir('idea', t.id, t.slug), 'plan', '01-area.md'), 'utf8')).toBe('# Area\n')
  })

  it('appendArtifact rejects traversal, absolute, and dot-segment names', () => {
    const t = createTicket(root, config, { title: 'Guarded', category: 'logic' })
    const badNames = ['../evil.md', 'plan/../../evil.md', '/tmp/evil.md', './evil.md', 'plan/.hidden.md', '']
    for (const name of badNames) {
      expect(() => appendArtifact(root, config, t.id, name, 'x')).toThrow(/Invalid artifact name/)
    }
    expect(existsSync(join(root, 'evil.md'))).toBe(false)
    expect(existsSync(join(root, 'idea', 'evil.md'))).toBe(false)
  })

  it('appendLog appends NDJSON records to log/<id>.ndjson', () => {
    const t = createTicket(root, config, { title: 'Logged', category: 'logic' })
    appendLog(root, config, t.id, 'first line')
    appendLog(root, config, t.id, { event: 'custom', value: 42 })
    const dir = ticketDir('idea', t.id, t.slug)
    const lines = readFileSync(join(dir, 'log', `${t.id}.ndjson`), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).line).toBe('first line')
    expect(JSON.parse(lines[1]!)).toMatchObject({ event: 'custom', value: 42 })
  })

  it('appendLogAt writes the identical NDJSON record shape as appendLog', () => {
    const t = createTicket(root, config, { title: 'At-logged', category: 'logic' })
    const dir = ticketDir('idea', t.id, t.slug)
    // Same string entry through both surfaces, then the same record entry.
    appendLog(root, config, t.id, 'shared line')
    appendLogAt(dir, t.id, 'shared line')
    appendLog(root, config, t.id, { event: 'custom', value: 42 })
    appendLogAt(dir, t.id, { event: 'custom', value: 42 })

    const [viaLog, viaAt, recViaLog, recViaAt] = readFileSync(join(dir, 'log', `${t.id}.ndjson`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    // String entry: same keys ({ at, line }), same payload, both timestamped.
    expect(Object.keys(viaAt!).sort()).toEqual(Object.keys(viaLog!).sort())
    expect(viaAt!.line).toBe('shared line')
    expect(typeof viaAt!.at).toBe('string')
    // Record entry: same merged shape ({ at, ...entry }), same payload.
    expect(Object.keys(recViaAt!).sort()).toEqual(Object.keys(recViaLog!).sort())
    expect(recViaAt).toMatchObject({ event: 'custom', value: 42 })
    expect(typeof recViaAt!.at).toBe('string')
  })
})

describe('listTicketFiles', () => {
  it('lists root and one-level subfolder .md files, excluding ticket.md, log/, images/, and dot-entries', () => {
    const t = createTicket(root, config, { title: 'Files', category: 'logic', body: 'idea\n' })
    const dir = ticketDir('idea', t.id, t.slug)
    appendArtifact(root, config, t.id, 'blocked.md', 'b\n')
    appendArtifact(root, config, t.id, 'plan/00-shared-context.md', 'p0\n')
    appendArtifact(root, config, t.id, 'plan/01-server.md', 'p1\n')
    appendArtifact(root, config, t.id, 'notes/random.md', 'n\n')
    appendLog(root, config, t.id, 'never listed')
    mkdirSync(join(dir, 'images'), { recursive: true })
    writeFileSync(join(dir, 'images', 'never-listed.md'), 'x\n')
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    writeFileSync(join(dir, '.hidden', 'secret.md'), 'x\n')
    writeFileSync(join(dir, '.draft.md'), 'x\n')
    writeFileSync(join(dir, 'notes.txt'), 'x\n')

    expect(listTicketFiles(root, config, t.id)).toEqual([
      'blocked.md',
      'notes/random.md',
      'plan/00-shared-context.md',
      'plan/01-server.md',
    ])
  })

  it('natural-sorts: numeric on a leading NN- prefix, then localeCompare', () => {
    const t = createTicket(root, config, { title: 'Sort', category: 'logic' })
    appendArtifact(root, config, t.id, 'plan/10-later.md', 'x\n')
    appendArtifact(root, config, t.id, 'plan/2-earlier.md', 'x\n')
    appendArtifact(root, config, t.id, 'plan/02-tie.md', 'x\n')
    appendArtifact(root, config, t.id, 'plan/appendix.md', 'x\n')
    expect(listTicketFiles(root, config, t.id)).toEqual([
      'plan/02-tie.md',
      'plan/2-earlier.md',
      'plan/10-later.md',
      'plan/appendix.md',
    ])
  })

  it('throws for an unknown ticket id', () => {
    expect(() => listTicketFiles(root, config, 999)).toThrow(/not found/)
  })
})

describe('relocateTicket crash safety + reconcileStatus', () => {
  /** Rewrites a ticket.md frontmatter in place, bypassing fileops (simulating a torn move). */
  function tearTicketFile(path: string, mutate: (data: Ticket) => void): void {
    const { data, body } = parseTicketFile(readFileSync(path, 'utf8'))
    mutate(data)
    writeFileSync(path, serializeTicketFile(data, body))
  }

  it('writes the new status into the old dir BEFORE renaming: a failed rename leaves a folder-wins-repairable tear', () => {
    const t = createTicket(root, config, { title: 'Torn move', category: 'logic' })
    const oldDir = ticketDir('idea', t.id, t.slug)
    // Force renameSync to fail: a non-empty colliding target dir (ENOTEMPTY on
    // POSIX; existing-dir targets also fail on Windows).
    const collidingDir = ticketDir('plan', t.id, t.slug)
    mkdirSync(collidingDir, { recursive: true })
    writeFileSync(join(collidingDir, 'occupied.txt'), 'x\n')

    expect(() => moveTicket(root, config, t.id, 'plan')).toThrow()

    // Tear artifact proving the write-then-rename order: the folder did NOT
    // move, but its ticket.md already carries the new status.
    expect(existsSync(join(oldDir, 'ticket.md'))).toBe(true)
    const torn = parseTicketFile(readFileSync(join(oldDir, 'ticket.md'), 'utf8')).data
    expect(torn.status).toBe('plan')

    // Folder-wins reconcile rolls the failed move back.
    rmSync(collidingDir, { recursive: true, force: true })
    expect(reconcileStatus(root, config)).toEqual([{ id: t.id, folder: 'idea', fromStatus: 'plan' }])
    expect(readTicket(root, config, t.id).status).toBe('idea')
    // Idempotent: a second pass finds nothing to repair.
    expect(reconcileStatus(root, config)).toEqual([])
  })

  it('repairs a hand-crafted mismatch with the folder as truth and never rewrites healthy tickets', () => {
    const healthy = createTicket(root, config, { title: 'Healthy', category: 'logic' })
    moveTicket(root, config, healthy.id, 'plan')
    const healthyPath = join(ticketDir('plan', healthy.id, healthy.slug), 'ticket.md')
    const healthyBytes = readFileSync(healthyPath, 'utf8')

    const torn = createTicket(root, config, { title: 'Torn', category: 'ui' })
    tearTicketFile(join(ticketDir('idea', torn.id, torn.slug), 'ticket.md'), (d) => {
      d.status = 'doing'
    })

    expect(reconcileStatus(root, config)).toEqual([{ id: torn.id, folder: 'idea', fromStatus: 'doing' }])
    expect(readTicket(root, config, torn.id).status).toBe('idea')
    // Loop guard: the healthy ticket is byte-for-byte untouched, and a second
    // pass (as a repair-triggered watcher rebuild would run) writes nothing.
    expect(readFileSync(healthyPath, 'utf8')).toBe(healthyBytes)
    expect(reconcileStatus(root, config)).toEqual([])
  })

  it('repairs a torn setBlocked (status says blocked, folder is the origin step) by dropping returnStep', () => {
    const t = createTicket(root, config, { title: 'Torn block', category: 'logic' })
    tearTicketFile(join(ticketDir('idea', t.id, t.slug), 'ticket.md'), (d) => {
      d.returnStep = d.status
      d.status = 'blocked'
    })
    expect(reconcileStatus(root, config)).toEqual([{ id: t.id, folder: 'idea', fromStatus: 'blocked' }])
    const repaired = readTicket(root, config, t.id)
    expect(repaired.status).toBe('idea')
    expect(repaired.returnStep).toBeUndefined()
    expect(validateTicket(config, repaired)).toEqual([])
  })

  it('repairs a torn resolveBlock (folder still blocked, status says the target) by restoring returnStep', () => {
    const t = createTicket(root, config, { title: 'Torn resolve', category: 'logic' })
    moveTicket(root, config, t.id, 'plan')
    setBlocked(root, config, t.id, { question: 'stuck?' })
    // Simulate resolveBlock's write landing but its rename failing.
    tearTicketFile(join(ticketDir('blocked', t.id, t.slug), 'ticket.md'), (d) => {
      d.status = 'plan'
      delete d.returnStep
    })
    expect(reconcileStatus(root, config)).toEqual([{ id: t.id, folder: 'blocked', fromStatus: 'plan' }])
    const repaired = readTicket(root, config, t.id)
    expect(repaired.status).toBe('blocked')
    expect(repaired.returnStep).toBe('plan')
    expect(validateTicket(config, repaired)).toEqual([])
    // A retried resolve lands where the torn one was headed.
    expect(resolveBlock(root, config, t.id).status).toBe('plan')
  })

  it('leaves _archive alone: archived tickets keep their last live status', () => {
    const t = createTicket(root, config, { title: 'Archived', category: 'logic' })
    moveTicket(root, config, t.id, 'done')
    archiveTicket(root, config, t.id, { reason: 'shipped' })
    expect(reconcileStatus(root, config)).toEqual([])
    expect(listArchive(root, config)[0]?.status).toBe('done')
  })
})
