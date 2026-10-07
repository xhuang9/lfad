/**
 * The plugin's skill prefix: the name a user types before each skill, as in
 * `/lfad:up` (Claude Code) or `$lfad:up` (Codex). Claude Code takes it from
 * `plugins/<dir>/.claude-plugin/plugin.json` `name`; Codex from
 * `.codex-plugin/plugin.json` and the marketplace entries. Setup writes the
 * chosen prefix into all four so both CLIs agree.
 *
 * The published default is `lfad`. A different local prefix (for example
 * `flow`) is marked skip-worktree in git so it is never committed over the
 * published default.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export const DEFAULT_PREFIX = 'lfad'
const PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,30}$/

/** True when `prefix` is a valid plugin name (lowercase, digits, hyphens). */
export function isValidPrefix(prefix) {
  return typeof prefix === 'string' && PREFIX_PATTERN.test(prefix)
}

/** The plugin folder: `plugins/lfad`, or the older `plugins/flow`. */
export function pluginDir(root) {
  for (const name of ['lfad', 'flow']) {
    const dir = resolve(root, 'plugins', name)
    if (existsSync(resolve(dir, '.claude-plugin/plugin.json'))) return dir
  }
  throw new Error(`no plugin folder under ${resolve(root, 'plugins')}`)
}

/** The prefix the plugin is installed under right now. */
export function currentPrefix(root) {
  const manifest = JSON.parse(readFileSync(resolve(pluginDir(root), '.claude-plugin/plugin.json'), 'utf8'))
  return isValidPrefix(manifest.name) ? manifest.name : DEFAULT_PREFIX
}

/** The four files that carry the prefix, relative to `root`. */
export function prefixFiles(root) {
  const dir = relative(root, pluginDir(root))
  return [
    `${dir}/.claude-plugin/plugin.json`,
    `${dir}/.codex-plugin/plugin.json`,
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
  ]
}

/**
 * Writes `prefix` into the plugin manifests and marketplace entries.
 * Returns the files that changed.
 */
export function applyPrefix(root, prefix) {
  if (!isValidPrefix(prefix)) throw new Error(`invalid skill prefix "${prefix}": use lowercase letters, digits and hyphens`)
  const dir = pluginDir(root)
  const changed = []
  for (const file of prefixFiles(root)) {
    const path = resolve(root, file)
    if (!existsSync(path)) continue
    const json = JSON.parse(readFileSync(path, 'utf8'))
    let touched = false
    if (!file.endsWith('marketplace.json')) {
      if (json.name !== prefix) { json.name = prefix; touched = true }
    } else {
      for (const entry of json.plugins ?? []) {
        // Marketplace sources are relative to the repo root.
        const source = typeof entry.source === 'string' ? entry.source : entry.source?.path
        if (typeof source === 'string' && resolve(root, source) === dir && entry.name !== prefix) {
          entry.name = prefix
          touched = true
        }
      }
    }
    if (touched) {
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
      changed.push(file)
    }
  }
  markLocal(root, prefix)
  return changed
}

/** Keeps a non-default prefix out of commits; clears the mark for the default. */
function markLocal(root, prefix) {
  const inGit = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }).status === 0
  if (!inGit) return
  const flag = prefix === DEFAULT_PREFIX ? '--no-skip-worktree' : '--skip-worktree'
  spawnSync('git', ['-C', root, 'update-index', flag, ...prefixFiles(root)], { stdio: 'ignore' })
}
