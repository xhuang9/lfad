/** Tests for the board-local UI resolution (`<board>/.ui`, gitignored). */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ensureBoardGitignore, resolveUiDir } from '../src/ui-dir.js'

let board: string
let toolUi: string

beforeEach(() => {
  board = mkdtempSync(join(tmpdir(), 'lfad-board-'))
  toolUi = mkdtempSync(join(tmpdir(), 'lfad-ui-'))
  writeFileSync(join(toolUi, 'index.html'), '<div id="root"></div>')
  mkdirSync(join(toolUi, 'assets'))
  writeFileSync(join(toolUi, 'assets', 'app.js'), '// built')
})

afterEach(() => {
  rmSync(board, { recursive: true, force: true })
  rmSync(toolUi, { recursive: true, force: true })
})

describe('resolveUiDir', () => {
  it('returns the explicit override untouched (no copy, no gitignore)', () => {
    expect(resolveUiDir(board, '/custom/ui', toolUi)).toBe('/custom/ui')
    expect(existsSync(resolve(board, '.gitignore'))).toBe(false)
    expect(existsSync(resolve(board, '.ui'))).toBe(false)
  })

  it('copies the tool UI into <board>/.ui and returns it', () => {
    const out = resolveUiDir(board, undefined, toolUi)
    expect(out).toBe(resolve(board, '.ui'))
    expect(existsSync(resolve(board, '.ui', 'index.html'))).toBe(true)
    expect(existsSync(resolve(board, '.ui', 'assets', 'app.js'))).toBe(true)
  })

  it('ensures the board .gitignore ignores .ui/, log/, .lfad/ and .hitloop/', () => {
    resolveUiDir(board, undefined, toolUi)
    const gi = readFileSync(resolve(board, '.gitignore'), 'utf8')
    expect(gi).toContain('.ui/')
    expect(gi).toContain('log/')
    expect(gi).toContain('.lfad/')
    expect(gi).toContain('.hitloop/')
  })

  it('returns undefined when no tool UI and no existing board .ui', () => {
    expect(resolveUiDir(board, undefined, null)).toBeUndefined()
  })

  it('does not duplicate existing .gitignore entries', () => {
    writeFileSync(resolve(board, '.gitignore'), '.ui/\nlog/\n')
    ensureBoardGitignore(board)
    const gi = readFileSync(resolve(board, '.gitignore'), 'utf8')
    expect(gi.match(/\.ui\//g)?.length).toBe(1)
    expect(gi.match(/log\//g)?.length).toBe(1)
  })
})
