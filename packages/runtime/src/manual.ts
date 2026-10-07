/**
 * The in-app manual, generated from the actual `flow` plugin skills so it never
 * drifts from them. {@link readManual} scans `plugins/lfad/skills/<name>/SKILL.md`,
 * reads each skill's frontmatter `name` + `description`, and returns that list
 * alongside a static list of board actions the UI surfaces. Served at
 * `GET /api/manual`; rendered by the UI's "Manual" modal.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One skill entry shown in the manual. */
export interface ManualSkill {
  /** The value that matches a step's `skill` binding — `flow:idea` (plugin) or
   *  `flow-add-test` (project-local). The UI keys skill lookups by this. */
  key: string
  command: string
  name: string
  /** Short, scannable one-liner (the collapsed row). */
  summary: string
  /** Full description (revealed on expand). */
  description: string
}

/** One board capability shown in the manual (UI affordances, not skills). */
export interface ManualAction {
  label: string
  detail: string
}

/** The full manual payload. */
export interface Manual {
  skillPrefix: string
  skills: ManualSkill[]
  actions: ManualAction[]
}

/** Board affordances — kept here so the manual is a single source of truth. */
const BOARD_ACTIONS: ManualAction[] = [
  { label: 'View, don’t drag', detail: 'Agents move tickets; you view & guide.' },
  { label: 'Deep links', detail: '/t/<id> opens a ticket; #heading scrolls to it.' },
  { label: 'Copy id', detail: 'Click the #id, or press c in the drawer.' },
  { label: 'Edit inline', detail: 'Edit → Save writes the markdown to disk.' },
  { label: 'Copy command', detail: 'Step buttons copy /<prefix>:<skill> <id> (⌃1…⌃9); paste into your Claude Code session.' },
  { label: 'Run', detail: 'The top-bar button copies one prompt to process every unblocked ticket in parallel; paste into your agent session.' },
  { label: 'Keys', detail: '/ search · c new · g d / g b nav · f (⌘⇧F) full height · Esc close.' },
]

/**
 * The installed tool's flow plugin folder (parent of the skills dir) — handed
 * to headless runs via the `{pluginDir}` adapter placeholder so `claude -p`
 * sessions load the flow skills (user-level plugin registration does not).
 */
export function findFlowPluginDir(): string | null {
  const skills = findSkillsDir()
  return skills === null ? null : resolve(skills, '..')
}

/** Locates the plugin skills by walking up from this module's location. */
function findSkillsDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i += 1) {
    for (const plugin of ['lfad', 'flow']) {
      const candidate = resolve(dir, 'plugins', plugin, 'skills')
      if (existsSync(candidate)) return candidate
    }
    dir = resolve(dir, '..')
  }
  return null
}

/** Claude Code uses the installed plugin manifest's name as its skill prefix. */
export function pluginPrefix(): string {
  const dir = findFlowPluginDir()
  if (dir === null) return 'lfad'
  try {
    const manifest: unknown = JSON.parse(readFileSync(resolve(dir, '.claude-plugin/plugin.json'), 'utf8'))
    if (typeof manifest === 'object' && manifest !== null && 'name' in manifest
      && typeof manifest.name === 'string' && manifest.name.trim().length > 0) return manifest.name
  } catch {
    // An absent or unreadable manifest uses the default installation prefix.
  }
  return 'lfad'
}

/** Extracts `name` / `summary` / `description` from a SKILL.md frontmatter block. */
function parseSkillFrontmatter(md: string): { name?: string, summary?: string, description?: string } {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const out: { name?: string, summary?: string, description?: string } = {}
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^(name|summary|description):\s*(.*)$/)
    if (m) out[m[1] as 'name' | 'summary' | 'description'] = m[2].trim()
  }
  return out
}

/** The board's project-local skills dir (`<project>/.claude/skills`), where a
 *  board's own step skills (e.g. flow-add-test, flow-doc, flow-ship) live. The
 *  board root is `<project>/.flow`, so the project is its parent. */
function projectSkillsDir(boardRoot: string): string {
  return resolve(boardRoot, '..', '.claude', 'skills')
}

/** Reads every SKILL.md under `dir`, keying/commanding each folder via the
 *  caller's scheme (plugin `flow:<name>` vs project-local `<name>`). */
function scanSkills(dir: string | null, key: (folder: string) => string, command: (name: string) => string): ManualSkill[] {
  const out: ManualSkill[] = []
  if (dir === null || !existsSync(dir)) return out
  for (const folder of readdirSync(dir).sort()) {
    const file = resolve(dir, folder, 'SKILL.md')
    if (!existsSync(file)) continue
    const fm = parseSkillFrontmatter(readFileSync(file, 'utf8'))
    if (fm.name === undefined || fm.description === undefined) continue
    const summary = fm.summary ?? `${fm.description.split(/(?<=\.)\s/)[0]}`
    out.push({ key: key(folder), command: command(fm.name), name: fm.name, summary, description: fm.description })
  }
  return out
}

/** Reads the manual: skills (plugin + the board's project-local) + board actions. */
export function readManual(boardRoot?: string): Manual {
  const skillPrefix = pluginPrefix()
  const plugin = scanSkills(findSkillsDir(), (f) => `${skillPrefix}:${f}`, (n) => `/${skillPrefix}:${n}`)
  const project = boardRoot === undefined ? [] : scanSkills(projectSkillsDir(boardRoot), (f) => f, (n) => `/${n}`)
  return { skillPrefix, skills: [...plugin, ...project], actions: BOARD_ACTIONS }
}

/** Strips a leading `--- … ---` frontmatter block, returning the markdown body. */
function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m === null ? md : md.slice(m[0].length).replace(/^\s+/, '')
}

/** True when `name` is one safe folder segment — no separators, no dot-leading
 *  (the `?key=` query is caller-controlled, so it must never traverse). */
function isSafeSkillFolder(name: string): boolean {
  return name.length > 0 && !name.startsWith('.') && !name.includes('/') && !name.includes('\\')
}

/** Returns the raw SKILL.md body for a skill key (`flow:idea` or `flow-add-test`),
 *  or null if not found. Current-prefix and legacy `flow:*` keys use the plugin; anything else
 *  under the board's project-local `.claude/skills`. */
export function readSkillBody(key: string, boardRoot?: string): string | null {
  let file: string | null = null
  const separator = key.indexOf(':')
  const prefix = separator < 0 ? null : key.slice(0, separator)
  if (prefix === pluginPrefix() || prefix === 'flow') {
    const folder = key.slice(separator + 1)
    if (!isSafeSkillFolder(folder)) return null
    const dir = findSkillsDir()
    if (dir !== null) file = resolve(dir, folder, 'SKILL.md')
  } else if (boardRoot !== undefined) {
    if (!isSafeSkillFolder(key)) return null
    file = resolve(projectSkillsDir(boardRoot), key, 'SKILL.md')
  }
  if (file === null || !existsSync(file)) return null
  return stripFrontmatter(readFileSync(file, 'utf8'))
}
