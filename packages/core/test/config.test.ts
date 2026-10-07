/**
 * Test suite for the board.yml config surface: schema validation, the
 * loader's three paths (fresh board / legacy layout / existing config), the
 * legacy `stages:` alias, the disk⇄config consistency guard, and the pure
 * routing helpers.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import {
  BOARD_CONFIG_FILE,
  BUILT_IN_ADAPTER,
  DEFAULT_BOARD_CONFIG,
  DEFAULT_SKILL_PREFIX,
  adapterForStep,
  defaultBoardConfig,
  defaultEntryStep,
  isAgentStep,
  isGate,
  isQueue,
  isTerminal,
  linearSteps,
  loadBoardConfig,
  nextStep,
  parseBoardConfig,
  stepByKey,
  stepKeys,
  verifyConfigMatchesDisk,
  writeBoardConfig,
} from '../src/index.js'
import type { Ticket } from '../src/index.js'
import { FULL_BOARD_RAW, makeTestConfig } from './helpers.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lfad-config-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A minimal valid raw config for mutation in schema tests. */
function minimalRaw(): Record<string, unknown> {
  return {
    version: 1,
    steps: [
      { key: 'todo', label: 'Todo', type: 'queue', entry: true },
      { key: 'doing', label: 'Doing', type: 'agent' },
      { key: 'done', label: 'Done', type: 'terminal' },
    ],
  }
}

/** A contract-valid ticket for nextStep routing assertions. */
function makeTicket(over: Partial<Ticket> = {}): Ticket {
  const now = '2026-07-01T00:00:00.000Z'
  return {
    id: 1,
    slug: 'foo',
    title: 'Foo',
    status: 'plan',
    category: 'logic',
    tags: [],
    createdAt: now,
    updatedAt: now,
    history: [{ step: 'idea', at: now }],
    ...over,
  }
}

describe('parseBoardConfig', () => {
  it('normalizes defaults: agents {}, output stream-json, row derived from type', () => {
    const config = parseBoardConfig(minimalRaw())
    expect(config.agents).toEqual({})
    expect(config.steps.map((s) => s.row)).toEqual(['agents', 'agents', 'agents'])

    const full = parseBoardConfig(FULL_BOARD_RAW)
    expect(full.agents.default!.output).toBe('stream-json')
    expect(stepByKey(full, 'shape')!.row).toBe('needs-you') // gate default
    expect(stepByKey(full, 'idea')!.row).toBe('needs-you') // explicit override on an agent step
    expect(stepByKey(full, 'doing')!.row).toBe('agents')
  })

  it('accepts the legacy stages: key as an alias of steps:', () => {
    const raw = minimalRaw()
    const legacy = { version: raw.version, stages: raw.steps }
    const config = parseBoardConfig(legacy)
    expect(stepKeys(config)).toEqual(['todo', 'doing', 'done'])
    expect(config.steps.map((s) => s.type)).toEqual(['queue', 'agent', 'terminal'])
  })

  it('accepts board-level and step-level guidance strings', () => {
    const raw = minimalRaw()
    raw.guidance = 'Keep every change surgical.'
    ;(raw.steps as Record<string, unknown>[])[1]!.guidance = 'Run the full gate before finishing.'
    const config = parseBoardConfig(raw)
    expect(config.guidance).toBe('Keep every change surgical.')
    expect(stepByKey(config, 'doing')?.guidance).toBe('Run the full gate before finishing.')
    expect(stepByKey(config, 'todo')?.guidance).toBeUndefined()
  })

  it('rejects duplicate step keys', () => {
    const raw = minimalRaw()
    ;(raw.steps as Record<string, unknown>[]).push({ key: 'todo', label: 'Todo 2', type: 'queue' })
    expect(() => parseBoardConfig(raw)).toThrow(/duplicate step key 'todo'/)
  })

  it('rejects the reserved keys blocked, parked, and _archive', () => {
    const blocked = minimalRaw()
    ;(blocked.steps as Record<string, unknown>[]).push({ key: 'blocked', label: 'Blocked', type: 'queue' })
    expect(() => parseBoardConfig(blocked)).toThrow(/reserved/)

    const parked = minimalRaw()
    ;(parked.steps as Record<string, unknown>[]).push({ key: 'parked', label: 'Parked', type: 'queue' })
    expect(() => parseBoardConfig(parked)).toThrow(/reserved/)

    const archive = minimalRaw()
    ;(archive.steps as Record<string, unknown>[]).push({ key: '_archive', label: 'Archive', type: 'queue' })
    expect(() => parseBoardConfig(archive)).toThrow(/steps\.3\.key/)
  })

  it('rejects folder-unsafe step keys', () => {
    for (const key of ['Todo', '5-todo', 'my step', '-x']) {
      const raw = minimalRaw()
      ;(raw.steps as Record<string, unknown>[])[0]!.key = key
      expect(() => parseBoardConfig(raw), key).toThrow(/step key/)
    }
  })

  it('rejects an unknown step type', () => {
    const raw = minimalRaw()
    ;(raw.steps as Record<string, unknown>[])[0]!.type = 'human'
    expect(() => parseBoardConfig(raw)).toThrow(/steps\.0\.type/)
  })

  it('rejects a step referencing an adapter missing from the agents section', () => {
    const raw = minimalRaw()
    ;(raw.steps as Record<string, unknown>[])[1]!.agent = 'ghost'
    expect(() => parseBoardConfig(raw)).toThrow(/unknown agent adapter 'ghost'/)
  })

  it('rejects a wrong version and an empty steps array', () => {
    expect(() => parseBoardConfig({ ...minimalRaw(), version: 2 })).toThrow(/version/)
    expect(() => parseBoardConfig({ version: 1, steps: [] })).toThrow(/steps/)
  })
})

describe('loadBoardConfig', () => {
  it('creates and returns the nine-step default config on a fresh board', () => {
    const config = loadBoardConfig(root)
    expect(config).toEqual(DEFAULT_BOARD_CONFIG)
    expect(existsSync(join(root, BOARD_CONFIG_FILE))).toBe(true)
    const nineSteps = ['idea', 'research', 'interview', 'mock', 'design', 'todo', 'doing', 'review', 'done']
    expect(stepKeys(config)).toEqual(nineSteps)
    for (const key of nineSteps) {
      expect(existsSync(join(root, key))).toBe(true)
    }
    // The written file loads back to the same config.
    expect(loadBoardConfig(root)).toEqual(DEFAULT_BOARD_CONFIG)
  })

  it('the default board carries the lfad skill bindings, rows, and entry step', () => {
    const config = loadBoardConfig(root)
    expect(config.steps.map((s) => [s.key, s.type, s.row, s.skill])).toEqual([
      ['idea', 'agent', 'needs-you', 'lfad:idea'],
      ['research', 'agent', 'agents', 'lfad:research'],
      ['interview', 'gate', 'needs-you', 'lfad:interview'],
      ['mock', 'gate', 'needs-you', 'lfad:mock'],
      ['design', 'gate', 'needs-you', 'lfad:design'],
      ['todo', 'agent', 'agents', 'lfad:todo'],
      ['doing', 'agent', 'agents', 'lfad:build'],
      ['review', 'gate', 'needs-you', 'lfad:review'],
      ['done', 'terminal', 'agents', undefined],
    ])
    // mock and design are the needsDesign-gated steps.
    expect(stepByKey(config, 'mock')?.skipUnless).toBe('needsDesign')
    expect(stepByKey(config, 'design')?.skipUnless).toBe('needsDesign')
    expect(defaultEntryStep(config)).toBe('idea')
    expect(config.agents).toEqual({}) // built-in claude adapter applies
  })

  it('scripts/setup.mjs writes the same board as defaultBoardConfig for any prefix', () => {
    const setupPath = fileURLToPath(new URL('../../../scripts/setup.mjs', import.meta.url))
    const setupSrc = readFileSync(setupPath, 'utf8')
    const match = setupSrc.match(/const DEFAULT_BOARD_YML = `([\s\S]*?)`/)
    expect(match, 'DEFAULT_BOARD_YML template not found in scripts/setup.mjs').not.toBeNull()
    for (const prefix of ['lfad', 'flow']) {
      const yaml = match![1]!.replaceAll('__PREFIX__:', `${prefix}:`)
      expect(parseBoardConfig(parseYaml(yaml))).toEqual(defaultBoardConfig(prefix))
    }
  })

  it('uses lfad by default and gives each default config independent steps', () => {
    expect(DEFAULT_SKILL_PREFIX).toBe('lfad')
    const config = defaultBoardConfig()
    expect(config).toEqual(DEFAULT_BOARD_CONFIG)
    expect(config.steps.slice(0, -1).every((step) => step.actions?.[0] === 'lfad:next')).toBe(true)
    config.steps[0]!.actions!.push('custom:action')
    expect(DEFAULT_BOARD_CONFIG.steps[0]!.actions).toEqual(['lfad:next'])
  })

  it('scaffolds with the selected prefix and preserves existing bindings on later loads', () => {
    expect(loadBoardConfig(root, 'flow')).toEqual(defaultBoardConfig('flow'))
    expect(loadBoardConfig(root, 'custom')).toEqual(defaultBoardConfig('flow'))
    expect(loadBoardConfig(root)).toEqual(defaultBoardConfig('flow'))
  })

  it('refuses a legacy numbered-folder board without board.yml, pointing at the migration', () => {
    mkdirSync(join(root, '0-idea'), { recursive: true })
    expect(() => loadBoardConfig(root)).toThrow(/migrate-board\.mjs/)
    expect(existsSync(join(root, BOARD_CONFIG_FILE))).toBe(false) // nothing written
  })

  it('refuses to fabricate the default config when unknown dirs already hold tickets', () => {
    mkdirSync(join(root, 'custom-step', '00001-orphan'), { recursive: true })
    expect(() => loadBoardConfig(root)).toThrow(/custom-step/)
    // The refusal persists NOTHING: no default board.yml, no default step folders.
    expect(existsSync(join(root, BOARD_CONFIG_FILE))).toBe(false)
    expect(existsSync(join(root, 'idea'))).toBe(false)
  })

  it('parses an existing board.yml and creates missing step folders', () => {
    writeBoardConfig(root, makeTestConfig())
    const config = loadBoardConfig(root)
    expect(stepKeys(config)).toEqual([
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
    ])
    expect(existsSync(join(root, 'design-review'))).toBe(true)
  })

  it('loads a legacy board.yml written with the stages: key', () => {
    writeFileSync(
      join(root, BOARD_CONFIG_FILE),
      [
        'version: 1',
        'stages:',
        '  - key: todo',
        '    label: Todo',
        '    type: queue',
        '    entry: true',
        '  - key: done',
        '    label: Done',
        '    type: terminal',
        '',
      ].join('\n'),
      'utf8',
    )
    const config = loadBoardConfig(root)
    expect(stepKeys(config)).toEqual(['todo', 'done'])
    // Re-writing the same config emits the new steps: key.
    writeBoardConfig(root, config)
    const yamlText = readFileSync(join(root, BOARD_CONFIG_FILE), 'utf8')
    expect(yamlText).toContain('steps:')
    expect(yamlText).not.toContain('stages:')
  })

  it('surfaces YAML/contract errors with the board.yml path', () => {
    writeFileSync(join(root, BOARD_CONFIG_FILE), 'version: 1\nsteps: []\n', 'utf8')
    expect(() => loadBoardConfig(root)).toThrow(/board\.yml/)
  })
})

describe('verifyConfigMatchesDisk', () => {
  it('refuses to start when a non-config directory contains ticket folders', () => {
    const config = parseBoardConfig(minimalRaw())
    mkdirSync(join(root, 'rogue', '00042-lost-ticket'), { recursive: true })
    expect(() => verifyConfigMatchesDisk(root, config)).toThrow(/rogue/)
  })

  it('tolerates empty unknown dirs, dotfolders, and the ignored board dirs', () => {
    const config = parseBoardConfig(minimalRaw())
    mkdirSync(join(root, 'notes'), { recursive: true }) // unknown but ticket-free
    mkdirSync(join(root, '.ui', '00001-x'), { recursive: true }) // dotfolder
    mkdirSync(join(root, 'chunks', '00002-y'), { recursive: true }) // ignored board dir
    mkdirSync(join(root, 'blocked', '00003-z'), { recursive: true }) // system dir
    mkdirSync(join(root, 'parked', '00005-v'), { recursive: true }) // system dir
    mkdirSync(join(root, '_archive', '00004-w'), { recursive: true }) // system dir
    expect(() => verifyConfigMatchesDisk(root, config)).not.toThrow()
  })
})

describe('writeBoardConfig', () => {
  it('round-trips through disk and serializes minimally (defaults stripped)', () => {
    const config = makeTestConfig()
    writeBoardConfig(root, config)
    expect(loadBoardConfig(root)).toEqual(config)

    const yamlText = readFileSync(join(root, BOARD_CONFIG_FILE), 'utf8')
    expect(yamlText).toContain('steps:') // the new primary key
    expect(yamlText).not.toContain('output: stream-json') // adapter default stripped
    expect(yamlText).not.toContain('row: agents') // step default stripped
    expect(yamlText).toContain('row: needs-you') // idea's non-default row kept
  })

  it('round-trips board-level and step-level guidance through disk', () => {
    const config = makeTestConfig()
    config.guidance = 'No scope creep, ever.'
    stepByKey(config, 'doing')!.guidance = 'Commit only inside the worktree.'
    writeBoardConfig(root, config)
    const loaded = loadBoardConfig(root)
    expect(loaded.guidance).toBe('No scope creep, ever.')
    expect(stepByKey(loaded, 'doing')?.guidance).toBe('Commit only inside the worktree.')
    expect(loaded).toEqual(config)

    const yamlText = readFileSync(join(root, BOARD_CONFIG_FILE), 'utf8')
    expect(yamlText).toContain('guidance: No scope creep, ever.')
  })

  it('refuses to persist an invalid config', () => {
    const config = makeTestConfig()
    config.steps.push({ ...config.steps[0]! }) // duplicate key
    expect(() => writeBoardConfig(root, config)).toThrow(/duplicate/)
  })
})

describe('routing helpers', () => {
  const config = makeTestConfig()

  it('stepByKey / stepKeys / linearSteps expose the config steps (never blocked)', () => {
    expect(stepByKey(config, 'todo')?.type).toBe('queue')
    expect(stepByKey(config, 'blocked')).toBeUndefined()
    expect(stepKeys(config)).toHaveLength(14)
    expect(linearSteps(config)).toBe(config.steps)
  })

  it('type predicates derive from config type and are false for unknown keys', () => {
    expect(isQueue(config, 'todo')).toBe(true)
    expect(isAgentStep(config, 'doing')).toBe(true)
    expect(isGate(config, 'review')).toBe(true)
    expect(isTerminal(config, 'done')).toBe(true)
    expect(isTerminal(config, 'monitor')).toBe(true)
    expect(isGate(config, 'blocked')).toBe(false)
    expect(isAgentStep(config, 'nonsense')).toBe(false)
  })

  it('defaultEntryStep picks the first entry:true step, else the first step', () => {
    expect(defaultEntryStep(config)).toBe('idea')
    const noEntry = parseBoardConfig({
      version: 1,
      steps: [
        { key: 'a', label: 'A', type: 'queue' },
        { key: 'b', label: 'B', type: 'agent', entry: true },
      ],
    })
    expect(defaultEntryStep(noEntry)).toBe('b')
    const noneFlagged = parseBoardConfig({
      version: 1,
      steps: [{ key: 'solo', label: 'Solo', type: 'agent' }],
    })
    expect(defaultEntryStep(noneFlagged)).toBe('solo')
  })

  it('nextStep walks config order and honours skipUnless flags', () => {
    const designTicket = makeTicket({ needsDesign: true })
    const plainTicket = makeTicket()
    expect(nextStep(config, 'plan', designTicket)).toBe('design')
    expect(nextStep(config, 'plan', plainTicket)).toBe('todo') // design + design-review skipped
    expect(nextStep(config, 'design', designTicket)).toBe('design-review')
    expect(nextStep(config, 'doing', plainTicket)).toBe('checks')
    expect(nextStep(config, 'monitor', plainTicket)).toBeUndefined() // end of pipeline
    expect(nextStep(config, 'blocked', plainTicket)).toBeUndefined() // lateral, not on the pipeline
  })

  it('adapterForStep resolves named > default > built-in', () => {
    expect(adapterForStep(config, 'doing').model).toBe('fable') // named 'deep'
    expect(adapterForStep(config, 'shape').model).toBe('opus') // falls to 'default'
    const bare = parseBoardConfig(minimalRaw())
    expect(adapterForStep(bare, 'doing')).toEqual(BUILT_IN_ADAPTER) // no agents section
  })
})
