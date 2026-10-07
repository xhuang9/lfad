/**
 * Shared fixtures for the runtime tests: temp fixture boards WITH a board.yml
 * whose adapters point at the fake agent (never real `claude`, never tokens).
 * The full 14-step lineup mirrors the grown-board example in
 * docs/board.example.yml so the pre-config routing tests keep their exact
 * semantics.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  loadBoardConfig,
  parseBoardConfig,
  writeBoardConfig,
  type AgentAdapter,
  type BoardConfig,
} from '@lfad/core'

/** Absolute path to the sentinel-emitting fake agent script. */
export const FAKE_AGENT = join(dirname(fileURLToPath(import.meta.url)), 'fake-agent.mjs')

/** A board.yml adapter that runs the fake agent via node (multi-token args). */
export function fakeAdapter(overrides: Partial<AgentAdapter> = {}): AgentAdapter {
  return {
    cmd: process.execPath,
    args: [FAKE_AGENT, '{prompt}'],
    output: 'stream-json',
    ...overrides,
  }
}

/** Raw step lineup of the full 14-step example board (docs/board.example.yml). */
export function fullBoardSteps(): Record<string, unknown>[] {
  return [
    { key: 'idea', label: 'Idea', type: 'agent', row: 'needs-you', entry: true, artifact: 'body' },
    { key: 'shape', label: 'Shape', type: 'gate', artifact: 'shape.md' },
    { key: 'plan', label: 'Plan', type: 'gate', artifact: 'plan.md' },
    { key: 'design', label: 'Design', type: 'agent', skipUnless: 'needsDesign', artifact: 'design.md' },
    { key: 'design-review', label: 'Design Review', type: 'gate', skipUnless: 'needsDesign', artifact: 'design-review.md' },
    { key: 'todo', label: 'Todo', type: 'queue', entry: true },
    { key: 'doing', label: 'Doing', type: 'agent' },
    { key: 'checks', label: 'Checks', type: 'agent', artifact: 'checks.md' },
    { key: 'review', label: 'Review', type: 'gate', artifact: 'review.md' },
    { key: 'add-test', label: 'Add Test', type: 'agent', artifact: 'add-test.md' },
    { key: 'done', label: 'Done', type: 'terminal' },
    { key: 'document', label: 'Document', type: 'agent', artifact: 'doc.md' },
    { key: 'uat', label: 'UAT', type: 'gate', artifact: 'uat.md' },
    { key: 'monitor', label: 'Monitor', type: 'terminal' },
  ]
}

/**
 * Creates a temp board root with the given raw board.yml content (agents
 * default to a single fake-agent `default` adapter) and returns the root plus
 * the loaded config (step folders created by the load).
 */
export function makeFixtureBoard(
  raw: { agents?: Record<string, unknown>, steps: Record<string, unknown>[] },
  prefix = 'lfad-run-',
): { root: string, config: BoardConfig } {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const config = parseBoardConfig({
    version: 1,
    agents: raw.agents ?? { default: fakeAdapter() },
    steps: raw.steps,
  })
  writeBoardConfig(root, config)
  return { root, config: loadBoardConfig(root) }
}

/** A temp board running the full 14-step lineup on the fake agent. */
export function makeFullFixtureBoard(prefix = 'lfad-run-'): { root: string, config: BoardConfig } {
  return makeFixtureBoard({ steps: fullBoardSteps() }, prefix)
}

/** Decodes the fake agent's `FAKE_ARGV_B64:` line back into the argv array. */
export function decodeFakeArgv(line: string): string[] {
  const b64 = line.replace(/^FAKE_ARGV_B64:\s*/, '').trim()
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as string[]
}
