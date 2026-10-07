/**
 * Test suite for scripts/migrate-board.mjs — legacy numbered step folders →
 * bare-key folders + a generated board.yml. Every test runs against a fresh
 * temp board dir, cleaned up afterwards.
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { loadBoardConfig, parseBoardConfig, stepByKey, stepKeys } from '../src/index.js'
// @ts-expect-error — plain .mjs module without type declarations
import { migrate } from '../../../scripts/migrate-board.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'migrate-board.mjs')

const OLD_DIRS = [
  '0-idea',
  '1-shape',
  '2-plan',
  '3-design',
  '4-design-review',
  '5-todo',
  '6-doing',
  '7-checks',
  '8-review',
  '9-add-test',
  '10-done',
  '11-document',
  '12-uat',
  '13-monitor',
]

const NEW_DIRS = [
  'idea',
  'shape',
  'plan',
  'design',
  'design-review',
  'todo',
  'doing',
  'checks',
  'review',
  'add-test',
  'done',
  'document',
  'uat',
  'monitor',
]

const TICKET_MD = '---\nid: 1\n---\n# A ticket\n'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lfad-migrate-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Builds a full legacy board: all 14 numbered dirs, tickets spread around, blocked/_archive, .counter. */
function makeOldBoard(): void {
  for (const dir of OLD_DIRS) mkdirSync(join(root, dir), { recursive: true })
  writeTicket('0-idea', '00001-one')
  writeTicket('5-todo', '00002-two')
  writeTicket('6-doing', '00003-three')
  writeTicket('blocked', '00004-four')
  writeTicket('_archive', '00005-five')
  writeFileSync(join(root, '.counter'), '5\n', 'utf8')
}

/** Writes one minimal ticket folder (ticket.md + log dir) under a step dir. */
function writeTicket(stepDir: string, ticketFolder: string): void {
  const dir = join(root, stepDir, ticketFolder)
  mkdirSync(join(dir, 'log'), { recursive: true })
  writeFileSync(join(dir, 'ticket.md'), TICKET_MD, 'utf8')
}

describe('migrate-board.mjs', () => {
  it('renames all numbered dirs, writes board.yml, and never touches ticket contents', () => {
    makeOldBoard()
    // Happy path exercised through the real CLI entry.
    const res = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' })
    expect(res.status, res.stderr).toBe(0)

    for (const dir of OLD_DIRS) expect(existsSync(join(root, dir)), dir).toBe(false)
    for (const dir of NEW_DIRS) expect(existsSync(join(root, dir)), dir).toBe(true)

    // Tickets moved with their folders, byte-for-byte untouched; .counter kept.
    expect(readFileSync(join(root, 'idea', '00001-one', 'ticket.md'), 'utf8')).toBe(TICKET_MD)
    expect(readFileSync(join(root, 'todo', '00002-two', 'ticket.md'), 'utf8')).toBe(TICKET_MD)
    expect(readFileSync(join(root, 'blocked', '00004-four', 'ticket.md'), 'utf8')).toBe(TICKET_MD)
    expect(readFileSync(join(root, '_archive', '00005-five', 'ticket.md'), 'utf8')).toBe(TICKET_MD)
    expect(readFileSync(join(root, '.counter'), 'utf8')).toBe('5\n')

    // The generated board.yml uses the steps: key, parses through the config
    // contract, keeps the canonical step order, and binds skills only where
    // the flow plugin still ships them (idea/build).
    const yamlText = readFileSync(join(root, 'board.yml'), 'utf8')
    expect(yamlText).toContain('steps:')
    expect(yamlText).not.toMatch(/^stages:/m)
    const generated = parseBoardConfig(parseYaml(yamlText))
    expect(stepKeys(generated)).toEqual(NEW_DIRS)
    expect(stepByKey(generated, 'idea')?.skill).toBe('flow:idea')
    expect(stepByKey(generated, 'plan')?.skill).toBeUndefined() // flow:plan retired: plan gate is skill-less
    expect(stepByKey(generated, 'doing')?.skill).toBe('flow:build')
    expect(stepByKey(generated, 'checks')?.skill).toBeUndefined() // removed skill: no binding
    expect(stepKeys(loadBoardConfig(root))).toEqual(NEW_DIRS)
  })

  it('is idempotent: a second run is a no-op', () => {
    makeOldBoard()
    expect(migrate(root).status).toBe('migrated')
    const boardYml = readFileSync(join(root, 'board.yml'), 'utf8')
    const listing = readdirSync(root).sort()

    const second = migrate(root)
    expect(second.status).toBe('noop')
    expect(readFileSync(join(root, 'board.yml'), 'utf8')).toBe(boardYml)
    expect(readdirSync(root).sort()).toEqual(listing)
  })

  it('refuses a half-migrated board (old and new dirs both present)', () => {
    mkdirSync(join(root, '0-idea'), { recursive: true })
    mkdirSync(join(root, 'todo'), { recursive: true })
    expect(() => migrate(root)).toThrow(/half-migrated/)
  })

  it('refuses when board.yml already exists alongside numbered dirs', () => {
    mkdirSync(join(root, '0-idea'), { recursive: true })
    writeFileSync(join(root, 'board.yml'), 'version: 1\n', 'utf8')
    expect(() => migrate(root)).toThrow(/half-migrated/)
  })

  it('refuses to write board.yml when the ticket count changes mid-migration', () => {
    makeOldBoard()
    expect(() =>
      migrate(root, {
        afterRename: () => rmSync(join(root, 'todo', '00002-two'), { recursive: true, force: true }),
      }),
    ).toThrow(/ticket count changed/)
    expect(existsSync(join(root, 'board.yml'))).toBe(false)
  })

  it('completes an interrupted migration (dirs renamed, board.yml missing)', () => {
    for (const dir of NEW_DIRS) mkdirSync(join(root, dir), { recursive: true })
    const result = migrate(root)
    expect(result.status).toBe('completed')
    expect(existsSync(join(root, 'board.yml'))).toBe(true)
    expect(stepKeys(loadBoardConfig(root))).toEqual(NEW_DIRS)
  })

  it('reports a no-op on a board with nothing to migrate', () => {
    expect(migrate(root).status).toBe('noop')
    expect(existsSync(join(root, 'board.yml'))).toBe(false) // never invents a config
  })

  it('uses git mv when the board is a git repo, keeping history staged', () => {
    makeOldBoard()
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' })
    expect(git('init', '-q').status).toBe(0)
    expect(git('add', '-A').status).toBe(0)
    expect(git('commit', '-q', '-m', 'pre-migration').status).toBe(0)

    expect(migrate(root).status).toBe('migrated')
    const tracked = git('ls-files').stdout
    expect(tracked).toContain('idea/00001-one/ticket.md')
    expect(tracked).not.toContain('0-idea/')
  })
})
