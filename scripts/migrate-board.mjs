#!/usr/bin/env node
/**
 * One-time board migration: legacy numbered step folders → config-driven steps.
 *
 *   node scripts/migrate-board.mjs <boardRoot>
 *
 * What it does:
 *   1. renames each numbered step dir to its bare key (0-idea → idea …
 *      13-monitor → monitor) — `git mv` when the board is a git repo, plain
 *      rename otherwise;
 *   2. writes a board.yml (`steps:` key) containing the steps that actually
 *      exist on disk (canonical order), binding `skill:` only to skills that
 *      exist in the flow plugin library.
 *
 * Guarantees:
 *   - touches NOTHING inside ticket folders and never rewrites frontmatter
 *     (ticket status/history already store bare keys) or `.counter`;
 *   - `blocked/`, `parked/`, and `_archive/` are left exactly as they are;
 *   - refuses half-migrated boards (old and new dirs both present, or a
 *     board.yml alongside numbered dirs);
 *   - verifies the ticket count is identical before and after the renames;
 *   - idempotent: re-running on a migrated board is a no-op.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Legacy numbered folder → bare step key, in canonical pipeline order. */
export const RENAMES = [
  ['0-idea', 'idea'],
  ['1-shape', 'shape'],
  ['2-plan', 'plan'],
  ['3-design', 'design'],
  ['4-design-review', 'design-review'],
  ['5-todo', 'todo'],
  ['6-doing', 'doing'],
  ['7-checks', 'checks'],
  ['8-review', 'review'],
  ['9-add-test', 'add-test'],
  ['10-done', 'done'],
  ['11-document', 'document'],
  ['12-uat', 'uat'],
  ['13-monitor', 'monitor'],
]

/**
 * Per-step board.yml attributes for the legacy 14-step lineup. `skill:` is
 * bound only where the flow plugin still ships that skill (idea/build).
 */
const STEP_DEFS = {
  'idea': { label: 'Idea', type: 'agent', row: 'needs-you', entry: true, skill: 'flow:idea', artifact: 'body' },
  'shape': { label: 'Shape', type: 'gate', artifact: 'shape.md' },
  // The legacy `plan` gate stays skill-less: flow:plan was retired and has no replacement.
  'plan': { label: 'Plan', type: 'gate', artifact: 'plan.md' },
  'design': { label: 'Design', type: 'agent', skipUnless: 'needsDesign', artifact: 'design.md', agent: 'deep' },
  'design-review': { label: 'Design Review', type: 'gate', skipUnless: 'needsDesign', artifact: 'design-review.md' },
  'todo': { label: 'Todo', type: 'queue', entry: true },
  'doing': { label: 'Doing', type: 'agent', skill: 'flow:build', agent: 'deep' },
  'checks': { label: 'Checks', type: 'agent', artifact: 'checks.md', agent: 'light' },
  'review': { label: 'Review', type: 'gate', artifact: 'review.md' },
  'add-test': { label: 'Add Test', type: 'agent', artifact: 'tests.md', agent: 'light' },
  'done': { label: 'Done', type: 'terminal' },
  'document': { label: 'Document', type: 'agent', artifact: 'doc.md', agent: 'light' },
  'uat': { label: 'UAT', type: 'gate', artifact: 'uat.md' },
  'monitor': { label: 'Monitor', type: 'terminal' },
}

/** The agents section written into the generated board.yml. */
const AGENTS_YAML = `agents:
  default:
    cmd: claude
    args: ["-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--model", "{model}", "--effort", "{effort}"]
    output: stream-json
    model: opus
    effort: high
  deep:
    cmd: claude
    args: ["-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--model", "{model}", "--effort", "{effort}"]
    output: stream-json
    model: fable
    effort: xhigh
    workflow: true
  light:
    cmd: claude
    args: ["-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--model", "{model}"]
    output: stream-json
    model: sonnet`

/** True when the path exists and is a directory. */
function isDir(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Renders one board.yml step entry. */
function stepBlock(key) {
  const def = STEP_DEFS[key]
  const lines = [`  - key: ${key}`, `    label: ${def.label}`, `    type: ${def.type}`]
  if (def.row !== undefined) lines.push(`    row: ${def.row}`)
  if (def.skipUnless !== undefined) lines.push(`    skipUnless: ${def.skipUnless}`)
  if (def.skill !== undefined) lines.push(`    skill: ${def.skill}`)
  if (def.artifact !== undefined) lines.push(`    artifact: ${def.artifact}`)
  if (def.entry === true) lines.push('    entry: true')
  if (def.agent !== undefined) lines.push(`    agent: ${def.agent}`)
  return lines.join('\n')
}

/** Writes `<root>/board.yml` for the given step keys (canonical order assumed). */
function writeGeneratedConfig(root, keys) {
  const yaml = [
    'version: 1',
    '',
    AGENTS_YAML,
    '',
    'steps:',
    ...keys.map((key) => stepBlock(key)),
    '',
  ].join('\n')
  writeFileSync(join(root, 'board.yml'), yaml, 'utf8')
}

/** Counts `NNNNN-slug` ticket folders directly inside each named dir (missing dirs count 0). */
export function countTickets(root, dirNames) {
  let count = 0
  for (const name of dirNames) {
    let entries
    try {
      entries = readdirSync(join(root, name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d+-.+$/.test(entry.name)) count += 1
    }
  }
  return count
}

/** Renames one step dir, preferring `git mv` inside a git repo (plain rename fallback). */
function renameStepDir(root, oldName, newName, useGit) {
  if (useGit) {
    const res = spawnSync('git', ['-C', root, 'mv', oldName, newName], { stdio: 'ignore' })
    if (res.status === 0) return
  }
  renameSync(join(root, oldName), join(root, newName))
}

/**
 * Runs the migration against one board root. Returns `{ status, message }`
 * where status is 'migrated' | 'completed' | 'noop'; throws on refusal.
 * `hooks.afterRename` is a test-only seam invoked between the renames and the
 * ticket-count verification.
 */
export function migrate(root, hooks = {}) {
  if (!isDir(root)) throw new Error(`board root not found: ${root}`)
  const configPath = join(root, 'board.yml')
  const oldPresent = RENAMES.filter(([oldName]) => isDir(join(root, oldName)))
  const newPresent = RENAMES.filter(([, newName]) => isDir(join(root, newName)))

  if (oldPresent.length === 0) {
    if (newPresent.length > 0 && !existsSync(configPath)) {
      // Interrupted after the renames: finish by writing board.yml.
      writeGeneratedConfig(root, newPresent.map(([, n]) => n))
      return { status: 'completed', message: `board.yml written for ${newPresent.length} already-renamed step folder(s)` }
    }
    return {
      status: 'noop',
      message: existsSync(configPath)
        ? 'already migrated — nothing to do'
        : 'no numbered step folders found — nothing to migrate',
    }
  }

  if (newPresent.length > 0) {
    throw new Error(
      `half-migrated board: old (${oldPresent.map(([o]) => o).join(', ')}) and new `
      + `(${newPresent.map(([, n]) => n).join(', ')}) step folders both exist. `
      + 'Restore from the board\'s git history (or finish/undo the renames by hand), then re-run.',
    )
  }
  if (existsSync(configPath)) {
    throw new Error(
      'half-migrated board: board.yml already exists but numbered step folders remain. '
      + 'Remove board.yml (or finish the renames by hand), then re-run.',
    )
  }

  const systemDirs = ['blocked', 'parked', '_archive']
  const before = countTickets(root, [...oldPresent.map(([o]) => o), ...systemDirs])
  const useGit = existsSync(join(root, '.git'))
  for (const [oldName, newName] of oldPresent) {
    renameStepDir(root, oldName, newName, useGit)
  }
  hooks.afterRename?.()
  const after = countTickets(root, [...oldPresent.map(([, n]) => n), ...systemDirs])
  if (before !== after) {
    throw new Error(
      `ticket count changed during migration (${before} → ${after}); `
      + 'refusing to write board.yml — restore the board from its git history and investigate.',
    )
  }
  writeGeneratedConfig(root, oldPresent.map(([, n]) => n))
  return {
    status: 'migrated',
    message: `renamed ${oldPresent.length} step folder(s) (${useGit ? 'git mv' : 'rename'}), `
      + `verified ${before} ticket(s), wrote board.yml`,
  }
}

const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  const root = process.argv[2]
  if (root === undefined) {
    console.error('usage: node scripts/migrate-board.mjs <boardRoot>')
    process.exit(1)
  }
  try {
    const result = migrate(resolve(root))
    console.log(`migrate-board: ${result.message}`)
  } catch (err) {
    console.error(`migrate-board: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
