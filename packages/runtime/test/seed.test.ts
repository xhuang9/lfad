import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { seedBoard } from '../src/seed.js'

describe('seedBoard', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      const parent = dirname(root)
      const prefix = `${basename(root)}.bak-`
      rmSync(root, { recursive: true, force: true })
      for (const entry of readdirSync(parent).filter(name => name.startsWith(prefix))) {
        rmSync(join(parent, entry), { recursive: true, force: true })
      }
    }
  })

  it('refuses to replace an existing board and leaves it intact', () => {
    const root = mkdtempSync(join(tmpdir(), 'lfad-seed-'))
    roots.push(root)
    seedBoard(root)
    const marker = join(root, 'history-marker')
    writeFileSync(marker, 'keep me')

    expect(() => seedBoard(root)).toThrow(/--force.*backs the existing board up first/)
    expect(readFileSync(marker, 'utf8')).toBe('keep me')
    expect(existsSync(join(root, 'board.yml'))).toBe(true)
  })

  it('backs up an existing board before force-seeding a fresh one', () => {
    const root = mkdtempSync(join(tmpdir(), 'lfad-seed-'))
    roots.push(root)
    seedBoard(root)
    writeFileSync(join(root, 'history-marker'), 'old board')

    seedBoard(root, { force: true })

    const backups = readdirSync(dirname(root))
      .filter(name => name.startsWith(`${basename(root)}.bak-`))
    expect(backups).toHaveLength(1)
    const backup = join(dirname(root), backups[0]!)
    expect(readFileSync(join(backup, 'history-marker'), 'utf8')).toBe('old board')
    expect(existsSync(join(backup, 'board.yml'))).toBe(true)
    expect(existsSync(join(root, 'board.yml'))).toBe(true)
    expect(existsSync(join(root, 'history-marker'))).toBe(false)
  })
})
