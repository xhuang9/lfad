import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { listArchive, listParked, readBoard, readTicket, type BoardConfig, type Ticket } from '@lfad/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  archiveCommand,
  createCommand,
  moveCommand,
  noteCommand,
  parkCommand,
  parseTags,
  reactivateCommand,
  renderShow,
  showCommand,
  unparkCommand,
} from '../src/ticket-commands.js'
import { makeFixtureBoard, makeFullFixtureBoard } from './helpers.js'

/** Runs `git -C <root> <args>` and returns trimmed stdout. */
function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

/** Number of commits on the board repo's HEAD. */
function commitCount(root: string): number {
  return Number.parseInt(git(root, ['rev-list', '--count', 'HEAD']), 10)
}

describe('flow ticket command bodies (temp board)', () => {
  let boardRoot: string
  let config: BoardConfig

  beforeAll(() => {
    const fixture = makeFullFixtureBoard('lfad-tickets-')
    boardRoot = fixture.root
    config = fixture.config
  })

  afterAll(() => {
    rmSync(boardRoot, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates a ticket in the default entry step with tags and body', () => {
      const ticket = createCommand(boardRoot, {
        title: 'Fix the login flow',
        category: 'bug',
        tags: ['auth', 'ui'],
        body: 'Login bounces back to the sign-in page.',
      })
      expect(ticket.id).toBeGreaterThan(0)
      expect(ticket.status).toBe('idea') // first entry: true step of the full board
      expect(ticket.tags).toEqual(['auth', 'ui'])
      const onDisk = readTicket(boardRoot, config, ticket.id)
      expect(onDisk.title).toBe('Fix the login flow')
      const { artifacts } = showCommand(boardRoot, ticket.id)
      expect(artifacts.find((a) => a.name === 'Idea')?.content).toContain('bounces back')
    })

    it('honors an explicit --step entry override', () => {
      const ticket = createCommand(boardRoot, { title: 'Straight to todo', category: 'logic', step: 'todo' })
      expect(ticket.status).toBe('todo')
    })

    it('rejects an unknown category and an unknown step with readable messages', () => {
      expect(() => createCommand(boardRoot, { title: 'x', category: 'nope' }))
        .toThrow(/category must be one of ui\|bug\|logic\|business\|refactor\|hotfix/)
      expect(() => createCommand(boardRoot, { title: 'x', category: 'bug', step: 'not-a-step' }))
        .toThrow(/Unknown step 'not-a-step' \(valid: /)
    })
  })

  describe('move', () => {
    it('moves the ticket, updates status + history, and logs the reason', () => {
      const id = createCommand(boardRoot, { title: 'Mover', category: 'refactor' }).id
      const moved = moveCommand(boardRoot, id, 'doing', 'plan approved')
      expect(moved.status).toBe('doing')
      expect(moved.history.at(-1)?.step).toBe('doing')
      const log = readFileSync(join(boardRoot, 'doing', `${String(id).padStart(5, '0')}-mover`, 'log', `${id}.ndjson`), 'utf8')
      expect(log).toContain('"event":"move"')
      expect(log).toContain('plan approved')
    })

    it('rejects an unknown step (naming the valid keys) and an unknown id', () => {
      const id = createCommand(boardRoot, { title: 'Stays put', category: 'ui' }).id
      expect(() => moveCommand(boardRoot, id, 'nowhere', 'r')).toThrow(/Unknown step 'nowhere' \(valid: .*blocked\)/)
      expect(() => moveCommand(boardRoot, 999999, 'doing', 'r')).toThrow(/Ticket 999999 not found/)
    })
  })

  describe('show', () => {
    it('returns the ticket + artifacts and renders summary, file list, and body', () => {
      const id = createCommand(boardRoot, {
        title: 'Showable',
        category: 'business',
        tags: ['a'],
        body: 'The intent.',
      }).id
      writeFileSync(join(boardRoot, 'idea', `${String(id).padStart(5, '0')}-showable`, 'plan.md'), '# Plan\n')

      const result = showCommand(boardRoot, id)
      expect(result.ticket.id).toBe(id)
      expect(result.artifacts.map((a) => a.name)).toEqual(['Idea', 'plan.md'])

      const rendered = renderShow(result)
      expect(rendered).toContain(`#${id} Showable`)
      expect(rendered).toContain('step: idea  category: business')
      expect(rendered).toContain('tags: a')
      expect(rendered).toContain('  - plan.md')
      expect(rendered).toContain('body:\nThe intent.')
    })

    it('throws on an unknown id', () => {
      expect(() => showCommand(boardRoot, 999999)).toThrow(/Ticket 999999 not found/)
    })
  })

  describe('note', () => {
    it('records the fast-pass marker { applicable: false, reason } for the step', () => {
      const id = createCommand(boardRoot, { title: 'Trivial', category: 'ui' }).id
      const ticket = noteCommand(boardRoot, id, { step: 'document', skip: true, reason: 'nothing to document' })
      expect(ticket.stepNotes?.document).toEqual({ applicable: false, reason: 'nothing to document' })
      expect(readTicket(boardRoot, config, id).stepNotes?.document?.applicable).toBe(false)
    })

    it('requires --skip and rejects unknown step/id with readable messages', () => {
      const id = createCommand(boardRoot, { title: 'Noted', category: 'ui' }).id
      expect(() => noteCommand(boardRoot, id, { step: 'document', skip: false })).toThrow(/pass --skip/)
      expect(() => noteCommand(boardRoot, id, { step: 'bogus', skip: true })).toThrow(/Unknown step 'bogus'/)
      expect(() => noteCommand(boardRoot, 999999, { step: 'document', skip: true })).toThrow(/Ticket 999999 not found/)
    })
  })
})

  describe('archive / reactivate command bodies', () => {
  let boardRoot: string
  let config: BoardConfig

  beforeAll(() => {
    const fixture = makeFullFixtureBoard('lfad-archive-')
    boardRoot = fixture.root
    config = fixture.config
  })

  afterAll(() => {
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('archives a ticket into _archive, logs the reason, and rejects re-archiving', () => {
    const id = createCommand(boardRoot, { title: 'Ship it', category: 'logic' }).id
    moveCommand(boardRoot, id, 'monitor', 'pipeline complete')
    const archived = archiveCommand(boardRoot, id, 'shipped and merged')
    expect(archived.id).toBe(id)
    // Gone from the live board, present in the archive.
    expect(readBoard(boardRoot, config).some((t) => t.id === id)).toBe(false)
    expect(listArchive(boardRoot, config).some((t) => t.id === id)).toBe(true)
    const log = readFileSync(join(boardRoot, '_archive', `${String(id).padStart(5, '0')}-ship-it`, 'log', `${id}.ndjson`), 'utf8')
    expect(log).toContain('"event":"archived"')
    expect(log).toContain('shipped and merged')
    expect(() => archiveCommand(boardRoot, id)).toThrow(/already archived/i)
  })

  it('rejects archive before the last applicable step without moving or logging the ticket', () => {
    const id = createCommand(boardRoot, { title: 'Not finished', category: 'logic' }).id
    expect(() => archiveCommand(boardRoot, id)).toThrow(
      /cannot be archived from 'idea'.*last applicable step 'monitor'/,
    )
    expect(readTicket(boardRoot, config, id).status).toBe('idea')
    expect(listArchive(boardRoot, config).some((t) => t.id === id)).toBe(false)
    const logPath = join(boardRoot, 'idea', `${String(id).padStart(5, '0')}-not-finished`, 'log', `${id}.ndjson`)
    expect(existsSync(logPath)).toBe(false)
  })

  it('respects skipUnless flags and fast-pass notes when finding the last applicable step', () => {
    const skippedFixture = makeFixtureBoard({
      steps: [
        { key: 'idea', label: 'Idea', type: 'agent', entry: true },
        { key: 'done', label: 'Done', type: 'terminal' },
        { key: 'doc', label: 'Doc', type: 'agent', skipUnless: 'needsDesign' },
      ],
    }, 'lfad-archive-skip-unless-')
    try {
      const id = createCommand(skippedFixture.root, { title: 'No design docs', category: 'logic' }).id
      moveCommand(skippedFixture.root, id, 'done')
      expect(archiveCommand(skippedFixture.root, id).status).toBe('done')
    } finally {
      rmSync(skippedFixture.root, { recursive: true, force: true })
    }

    const id = createCommand(boardRoot, { title: 'Fast pass monitor', category: 'logic' }).id
    noteCommand(boardRoot, id, { step: 'monitor', skip: true, reason: 'no monitoring required' })
    moveCommand(boardRoot, id, 'uat')
    expect(archiveCommand(boardRoot, id).status).toBe('uat')
  })

  it('reactivates an archived ticket to an explicit step and logs the reason', () => {
    const id = createCommand(boardRoot, { title: 'Bring back', category: 'logic' }).id
    moveCommand(boardRoot, id, 'monitor')
    archiveCommand(boardRoot, id)
    const ticket = reactivateCommand(boardRoot, id, 'todo', 'reopened')
    expect(ticket.status).toBe('todo')
    expect(listArchive(boardRoot, config).some((t) => t.id === id)).toBe(false)
    expect(readTicket(boardRoot, config, id).status).toBe('todo')
    const log = readFileSync(join(boardRoot, 'todo', `${String(id).padStart(5, '0')}-bring-back`, 'log', `${id}.ndjson`), 'utf8')
    expect(log).toContain('"event":"reactivated"')
  })

  it('reactivate defaults to the archived-from final step when none is given', () => {
    const id = createCommand(boardRoot, { title: 'Resume where left', category: 'logic' }).id
    moveCommand(boardRoot, id, 'monitor', 'pipeline complete')
    archiveCommand(boardRoot, id)
    const ticket = reactivateCommand(boardRoot, id)
    expect(ticket.status).toBe('monitor')
  })

  it('rejects reactivating a live ticket and unknown ids with readable messages', () => {
    const id = createCommand(boardRoot, { title: 'Live one', category: 'ui' }).id
    expect(() => reactivateCommand(boardRoot, id, 'todo')).toThrow(/not archived/i)
    expect(() => reactivateCommand(boardRoot, 999999)).toThrow(/Ticket 999999 not found/)
    expect(() => archiveCommand(boardRoot, 999999)).toThrow(/Ticket 999999 not found/)
  })
})

describe('park / unpark command bodies', () => {
  const fixture = makeFullFixtureBoard('lfad-parked-')

  afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

  it('parks from any configured step and restores to the recorded origin', () => {
    const id = createCommand(fixture.root, { title: 'Pause this', category: 'logic' }).id
    moveCommand(fixture.root, id, 'todo')
    const parked = parkCommand(fixture.root, id)
    expect(parked).toMatchObject({ status: 'parked', returnStep: 'todo' })
    expect(readBoard(fixture.root, fixture.config).some((ticket) => ticket.id === id)).toBe(false)
    expect(listParked(fixture.root, fixture.config).some((ticket) => ticket.id === id)).toBe(true)

    const restored = unparkCommand(fixture.root, id)
    expect(restored.status).toBe('todo')
    expect(restored.returnStep).toBeUndefined()
  })

  it('rejects duplicate park, unpark of a live ticket, and unknown ids', () => {
    const parkedId = createCommand(fixture.root, { title: 'Already parked', category: 'logic' }).id
    parkCommand(fixture.root, parkedId)
    expect(() => parkCommand(fixture.root, parkedId)).toThrow(/already parked/i)

    const liveId = createCommand(fixture.root, { title: 'Still live', category: 'logic' }).id
    expect(() => unparkCommand(fixture.root, liveId)).toThrow(/not parked/i)
    expect(() => parkCommand(fixture.root, 999999)).toThrow(/Ticket 999999 not found/)
    expect(() => unparkCommand(fixture.root, 999999)).toThrow(/Ticket 999999 not found/)
  })
})

describe('board git snapshot semantics (mirror the daemon)', () => {
  let boardRoot: string
  let ticket: Ticket

  beforeAll(() => {
    boardRoot = makeFullFixtureBoard('lfad-tickets-git-').root
    execFileSync('git', ['-C', boardRoot, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.email', 'test@lfad.local'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'config', 'user.name', 'lfad Test'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', boardRoot, 'commit', '-m', 'initial board'], { stdio: 'ignore' })
  })

  afterAll(() => {
    rmSync(boardRoot, { recursive: true, force: true })
  })

  it('create and move write NO snapshot; note commits a pre-change snapshot first', () => {
    const before = commitCount(boardRoot)

    ticket = createCommand(boardRoot, { title: 'Snapshot semantics', category: 'logic', body: 'v1' })
    expect(commitCount(boardRoot)).toBe(before) // addition: no snapshot

    moveCommand(boardRoot, ticket.id, 'todo', 'queueing')
    expect(commitCount(boardRoot)).toBe(before) // move: no snapshot

    noteCommand(boardRoot, ticket.id, { step: 'design', skip: true, reason: 'no UI' })
    expect(commitCount(boardRoot)).toBe(before + 1) // modification: snapshot BEFORE the write
    expect(git(boardRoot, ['log', '-1', '--format=%s'])).toBe(`snapshot before edit to #${ticket.id}/ticket.md`)

    // The snapshot captured the PRE-note state: the committed ticket.md has no stepNotes.
    const folder = `todo/${String(ticket.id).padStart(5, '0')}-snapshot-semantics/ticket.md`
    expect(git(boardRoot, ['show', `HEAD:${folder}`])).not.toContain('stepNotes')
  })

  it('archive and reactivate write NO snapshot (both are moves)', () => {
    const t = createCommand(boardRoot, { title: 'Move only', category: 'logic', body: 'x' })
    moveCommand(boardRoot, t.id, 'monitor', 'pipeline complete')
    const before = commitCount(boardRoot)
    archiveCommand(boardRoot, t.id, 'done')
    expect(commitCount(boardRoot)).toBe(before) // archive: move, no snapshot
    reactivateCommand(boardRoot, t.id, 'todo', 'reopen')
    expect(commitCount(boardRoot)).toBe(before) // reactivate: move, no snapshot
  })

  it('park and unpark write NO snapshot (both are moves)', () => {
    const t = createCommand(boardRoot, { title: 'Pause only', category: 'logic', body: 'x' })
    const before = commitCount(boardRoot)
    parkCommand(boardRoot, t.id)
    expect(commitCount(boardRoot)).toBe(before)
    unparkCommand(boardRoot, t.id)
    expect(commitCount(boardRoot)).toBe(before)
  })
})

describe('parseTags', () => {
  it('splits, trims, and drops empties; undefined/empty input stays undefined', () => {
    expect(parseTags('a, b ,c')).toEqual(['a', 'b', 'c'])
    expect(parseTags('a,,')).toEqual(['a'])
    expect(parseTags(',')).toBeUndefined()
    expect(parseTags(undefined)).toBeUndefined()
  })
})
