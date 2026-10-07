/**
 * Board configuration for @lfad/core — the `board.yml` contract.
 *
 * Steps are per-board data, not code: `<boardRoot>/board.yml` declares the
 * ordered step columns (a step's key IS its on-disk folder name) plus named
 * agent adapters (any CLI that prints FLOW_BLOCK:/FLOW_DONE sentinels). This
 * module owns the schema, parsing/validation, the disk⇄config consistency
 * guard, and the pure helpers the run engine derives its routing from.
 * `blocked/`, `parked/`, and `_archive/` are system directories — never config steps.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'

import { atomicWriteFileSync } from './fs-atomic.js'
import { parseTicketFolder } from './ids.js'
import { ARCHIVE_DIR, BLOCKED_DIR, PARKED_DIR } from './steps.js'
import type { Step, Ticket } from './types.js'

/** Name of the per-board configuration file at the board root. */
export const BOARD_CONFIG_FILE = 'board.yml'

/** How a step participates in the pipeline (the engine derives routing from this). */
export type StepType = 'agent' | 'gate' | 'queue' | 'terminal'

/** Which UI row a step's column belongs to. */
export type StepRow = 'agents' | 'needs-you'

/** How an adapter's stdout is scanned for the FLOW_BLOCK:/FLOW_DONE sentinels. */
export type AdapterOutput = 'stream-json' | 'text'

/**
 * One named agent adapter: an arbitrary CLI invocation template. `args` may
 * contain the placeholders {prompt} {model} {effort} {ticketId} {step}
 * {boardRoot} {pluginDir} (plus {stage}, a deprecated alias of {step}),
 * substituted per token before spawning (no shell).
 */
export interface AgentAdapter {
  cmd: string
  args: string[]
  /** Filled by parse; defaults to 'stream-json'. */
  output: AdapterOutput
  /** Value substituted for the {model} placeholder. */
  model?: string
  /** Value substituted for the {effort} placeholder. */
  effort?: string
  /** When true, the word `ultracode` is prepended to the prompt text. */
  workflow?: boolean
}

/**
 * One board column. `key` doubles as the on-disk folder name; order in the
 * config array is pipeline order (order lives ONLY here).
 */
export interface StepConfig {
  /** Folder-safe key (^[a-z][a-z0-9-]*$); system directory names are reserved. */
  key: string
  label: string
  type: StepType
  /** Filled by parse; defaults to 'needs-you' for gates, 'agents' otherwise. */
  row: StepRow
  /** Skill that drives this step (informational for the prompt; policy lives in the skill). */
  skill?: string
  /**
   * Skills that can PROCESS a ticket sitting in this step — the drawer's run
   * buttons, in order. Each entry's logic (including where the ticket moves
   * when done) lives in that skill. Absent ⇒ the UI derives a default pair
   * (this step's skill + the next step's).
   */
  actions?: string[]
  /** One-line done-criteria injected into the step prompt. */
  goal?: string
  /** Free-form per-step guidance injected into the step prompt after the goal. */
  guidance?: string
  /** Artifact filename this step writes (e.g. 'plan.md'), or the literal 'body' for the ticket body. */
  artifact?: string
  /** True when tickets may be created directly into this step. */
  entry?: boolean
  /** Named adapter reference; must exist in `agents`. Absent ⇒ 'default' adapter if present, else built-in. */
  agent?: string
  /** Ticket frontmatter boolean flag name; the step is skipped when the flag is falsy. */
  skipUnless?: string
}

/** The full parsed `board.yml`: named adapters plus the ordered step array. */
export interface BoardConfig {
  version: 1
  /** Free-form board-level guidance injected into every step prompt. */
  guidance?: string
  /** Filled by parse; `{}` when the agents section is absent. */
  agents: Record<string, AgentAdapter>
  steps: StepConfig[]
}

/**
 * The adapter used when the board declares no `agents` section (and no
 * `default` adapter): plain `claude -p` with stream-json output.
 */
export const BUILT_IN_ADAPTER: AgentAdapter = {
  cmd: 'claude',
  // --plugin-dir hands the flow skills to the headless session: user-level
  // plugin registration does NOT load in `claude -p`, so without it the step
  // prompt's "invoke the Skill <prefix>:<step>" line hits "Unknown skill".
  // {pluginDir} resolves to the installed tool's plugins/lfad at spawn time;
  // a flag whose placeholder resolves empty is dropped from the argv.
  args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--plugin-dir', '{pluginDir}'],
  output: 'stream-json',
}

export const DEFAULT_SKILL_PREFIX = 'lfad'

/**
 * The out-of-the-box board: the nine-step two-row pipeline
 * (idea → research → interview → mock → design → todo → doing → review → done),
 * driven by the plugin skills. `mock` and `design` are human gates that apply only
 * to tickets whose `needsDesign` flag is truthy (skipUnless). This is the single
 * canonical default; the prefix follows the installed plugin's name.
 */
export function defaultBoardConfig(prefix = DEFAULT_SKILL_PREFIX): BoardConfig {
  return {
    version: 1,
    agents: {},
    steps: [
      { key: 'idea', label: 'Idea', type: 'agent', row: 'needs-you', entry: true, skill: `${prefix}:idea`, actions: [`${prefix}:next`] },
      { key: 'research', label: 'Research', type: 'agent', row: 'agents', skill: `${prefix}:research`, actions: [`${prefix}:next`] },
      { key: 'interview', label: 'Interview', type: 'gate', row: 'needs-you', skill: `${prefix}:interview`, actions: [`${prefix}:next`] },
      { key: 'mock', label: 'Mock', type: 'gate', row: 'needs-you', skill: `${prefix}:mock`, skipUnless: 'needsDesign', actions: [`${prefix}:next`] },
      { key: 'design', label: 'Design', type: 'gate', row: 'needs-you', skill: `${prefix}:design`, skipUnless: 'needsDesign', actions: [`${prefix}:next`] },
      { key: 'todo', label: 'Todo', type: 'agent', row: 'agents', skill: `${prefix}:todo`, actions: [`${prefix}:next`] },
      { key: 'doing', label: 'Doing', type: 'agent', row: 'agents', skill: `${prefix}:build`, actions: [`${prefix}:next`] },
      { key: 'review', label: 'Review', type: 'gate', row: 'needs-you', skill: `${prefix}:review`, actions: [`${prefix}:next`] },
      { key: 'done', label: 'Done', type: 'terminal', row: 'agents' },
    ],
  }
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = defaultBoardConfig()

/** Step keys that can never be configured (system directories). */
const RESERVED_STEP_KEYS = new Set([BLOCKED_DIR, PARKED_DIR, ARCHIVE_DIR])

/** Folder-safe step key pattern. */
const STEP_KEY_PATTERN = /^[a-z][a-z0-9-]*$/

/** Board-root directories (besides dotfolders and system dirs) never treated as steps. */
const IGNORED_BOARD_DIRS = new Set(['log', 'chunks', 'session'])

/** zod schema for one named agent adapter. */
const agentAdapterSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()),
  output: z.enum(['stream-json', 'text']).default('stream-json'),
  model: z.string().optional(),
  effort: z.string().optional(),
  workflow: z.boolean().optional(),
})

/** zod schema for one step entry (row default derived from type). */
const stepConfigSchema = z
  .object({
    key: z
      .string()
      .regex(STEP_KEY_PATTERN, 'step key must match ^[a-z][a-z0-9-]*$')
      .refine((k) => !RESERVED_STEP_KEYS.has(k), {
        message: `step key is reserved ('${BLOCKED_DIR}', '${PARKED_DIR}', and '${ARCHIVE_DIR}' are system directories)`,
      }),
    label: z.string().min(1),
    type: z.enum(['agent', 'gate', 'queue', 'terminal']),
    row: z.enum(['agents', 'needs-you']).optional(),
    skill: z.string().optional(),
    actions: z.array(z.string().min(1)).optional(),
    goal: z.string().optional(),
    guidance: z.string().optional(),
    artifact: z.string().optional(),
    entry: z.boolean().optional(),
    agent: z.string().optional(),
    skipUnless: z.string().optional(),
  })
  .transform((s) => ({
    ...s,
    row: s.row ?? (s.type === 'gate' ? ('needs-you' as const) : ('agents' as const)),
  }))

/** zod schema for the complete `board.yml` document (cross-field rules in superRefine). */
const boardConfigSchema = z
  .object({
    version: z.literal(1),
    guidance: z.string().optional(),
    agents: z.record(agentAdapterSchema).default({}),
    steps: z.array(stepConfigSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>()
    data.steps.forEach((step, i) => {
      if (seen.has(step.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', i, 'key'],
          message: `duplicate step key '${step.key}'`,
        })
      }
      seen.add(step.key)
      if (step.agent !== undefined && data.agents[step.agent] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', i, 'agent'],
          message: `unknown agent adapter '${step.agent}' (not in the agents section)`,
        })
      }
    })
  })

/** Maps a zod issue path to a readable dotted label. */
function issuePath(path: ReadonlyArray<string | number | symbol>): string {
  return path.length > 0 ? path.map((segment) => String(segment)).join('.') : 'config'
}

/**
 * Normalizes the legacy `stages:` board.yml key to `steps:` on read, so boards
 * written before the rename keep loading. Writes always emit `steps:`.
 */
function normalizeLegacyKeys(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (record.steps !== undefined || record.stages === undefined) return data
  const { stages, ...rest } = record
  return { ...rest, steps: stages }
}

/**
 * Parses and validates a raw (already YAML-decoded) value into a normalized
 * `BoardConfig` (row/output defaults filled, agents defaulted to `{}`, the
 * legacy `stages:` key accepted as an alias of `steps:`). Throws an `Error`
 * listing every violation when the contract is broken.
 */
export function parseBoardConfig(data: unknown): BoardConfig {
  const result = boardConfigSchema.safeParse(normalizeLegacyKeys(data))
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid board config: ${detail}`)
  }
  return result.data as BoardConfig
}

/**
 * Strips parse-filled defaults back out so the serialized `board.yml` stays
 * minimal and human-friendly (row/output/entry/workflow only when meaningful,
 * agents section only when non-empty).
 */
function toSerializable(config: BoardConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { version: config.version }
  if (config.guidance !== undefined) out.guidance = config.guidance
  const agentNames = Object.keys(config.agents)
  if (agentNames.length > 0) {
    const agents: Record<string, unknown> = {}
    for (const name of agentNames) {
      const adapter = config.agents[name]!
      const entry: Record<string, unknown> = { cmd: adapter.cmd, args: adapter.args }
      if (adapter.output !== 'stream-json') entry.output = adapter.output
      if (adapter.model !== undefined) entry.model = adapter.model
      if (adapter.effort !== undefined) entry.effort = adapter.effort
      if (adapter.workflow === true) entry.workflow = true
      agents[name] = entry
    }
    out.agents = agents
  }
  out.steps = config.steps.map((step) => {
    const entry: Record<string, unknown> = { key: step.key, label: step.label, type: step.type }
    const defaultRow = step.type === 'gate' ? 'needs-you' : 'agents'
    if (step.row !== defaultRow) entry.row = step.row
    if (step.skill !== undefined) entry.skill = step.skill
    if (step.actions !== undefined) entry.actions = step.actions
    if (step.goal !== undefined) entry.goal = step.goal
    if (step.guidance !== undefined) entry.guidance = step.guidance
    if (step.artifact !== undefined) entry.artifact = step.artifact
    if (step.entry === true) entry.entry = true
    if (step.agent !== undefined) entry.agent = step.agent
    if (step.skipUnless !== undefined) entry.skipUnless = step.skipUnless
    return entry
  })
  return out
}

/** Validates `config` and atomically writes it to `<root>/board.yml` as minimal YAML (always `steps:`). */
export function writeBoardConfig(root: string, config: BoardConfig): void {
  const serializable = toSerializable(config)
  parseBoardConfig(serializable) // never persist an invalid config
  atomicWriteFileSync(join(root, BOARD_CONFIG_FILE), stringifyYaml(serializable))
}

/** True when `dirPath` directly contains at least one `NNNNN-slug` ticket folder. */
function containsTicketFolders(dirPath: string): boolean {
  let entries
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((entry) => entry.isDirectory() && parseTicketFolder(entry.name) !== undefined)
}

/** True when the board root has legacy numbered step folders (`0-idea` style). */
function hasLegacyNumberedStepDirs(root: string): boolean {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
}

/**
 * Reconciles the config with the board directory. Missing config step folders
 * are created (empty dirs are safe). Any on-disk directory that is NOT a config
 * step / `blocked` / `parked` / `_archive` / a dotfolder / an ignored board dir (log,
 * chunks, session) but CONTAINS ticket folders makes this throw — the board
 * must refuse to start rather than silently skip a directory holding tickets.
 */
export function verifyConfigMatchesDisk(root: string, config: BoardConfig): void {
  for (const step of config.steps) {
    mkdirSync(join(root, step.key), { recursive: true })
  }
  assertNoOffenders(root, findOffenderDirs(root, config))
}

/**
 * Ticket-holding directories under `root` that appear in no config step and
 * are not system/ignored dirs — the mismatch the board refuses to start on.
 * Pure scan: creates and writes nothing (safe to run before persisting a
 * fresh board's default config).
 */
function findOffenderDirs(root: string, config: BoardConfig): string[] {
  const known = new Set([...config.steps.map((s) => s.key), BLOCKED_DIR, PARKED_DIR, ARCHIVE_DIR])
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return [] // no root yet ⇒ nothing to lose
  }
  const offenders: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (known.has(name) || name.startsWith('.') || IGNORED_BOARD_DIRS.has(name)) continue
    if (containsTicketFolders(join(root, name))) offenders.push(name)
  }
  return offenders
}

/** Throws the config/disk-mismatch refusal when `offenders` is non-empty. */
function assertNoOffenders(root: string, offenders: string[]): void {
  if (offenders.length > 0) {
    throw new Error(
      `Board config/disk mismatch at ${root}: ${offenders.join(', ')} contain(s) ticket folders `
      + `but appear(s) in no ${BOARD_CONFIG_FILE} step. Refusing to start so no ticket is silently lost — `
      + 'add the step(s) to the config or move the tickets.',
    )
  }
}

/**
 * Loads `<root>/board.yml`. Missing file on a fresh board ⇒ writes and returns
 * `defaultBoardConfig(prefix)` (creating its step folders). Missing file on a board
 * with legacy numbered step folders (`0-idea` style) ⇒ throws with a "run
 * migration" message. Present ⇒ YAML-parse, zod-validate, and reconcile with
 * the disk (see {@link verifyConfigMatchesDisk}) before returning.
 */
export function loadBoardConfig(root: string, prefix = DEFAULT_SKILL_PREFIX): BoardConfig {
  const path = join(root, BOARD_CONFIG_FILE)
  if (!existsSync(path)) {
    if (hasLegacyNumberedStepDirs(root)) {
      throw new Error(
        `Board at ${root} has legacy numbered step folders but no ${BOARD_CONFIG_FILE}; `
        + 'run migration first: node scripts/migrate-board.mjs <boardRoot>',
      )
    }
    // Guard BEFORE persisting anything: a config-less root that already holds
    // ticket-bearing directories is a mismatched board (e.g. its board.yml was
    // deleted), not a fresh one — writing the default config + step folders
    // first would pollute the very board the error tells the user to repair.
    const config = defaultBoardConfig(prefix)
    assertNoOffenders(root, findOffenderDirs(root, config))
    writeBoardConfig(root, config)
    verifyConfigMatchesDisk(root, config)
    return config
  }
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  let config: BoardConfig
  try {
    config = parseBoardConfig(raw)
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  verifyConfigMatchesDisk(root, config)
  return config
}

/** Returns the step config for `key`, or undefined ('blocked'/'_archive' are never config steps). */
export function stepByKey(config: BoardConfig, key: string): StepConfig | undefined {
  return config.steps.find((s) => s.key === key)
}

/** All config step keys in pipeline order (excludes the lateral 'blocked'). */
export function stepKeys(config: BoardConfig): string[] {
  return config.steps.map((s) => s.key)
}

/** The ordered pipeline steps (every config step is linear; blocked/_archive are system dirs). */
export function linearSteps(config: BoardConfig): StepConfig[] {
  return config.steps
}

/** True when `key` is a config step of the given type (false for unknown keys and 'blocked'). */
function isType(config: BoardConfig, key: string, type: StepType): boolean {
  return stepByKey(config, key)?.type === type
}

/** True when the step is a human gate (complete-in-place; no auto-advance). */
export function isGate(config: BoardConfig, key: string): boolean {
  return isType(config, key, 'gate')
}

/** True when the step is terminal (complete-in-place; autopilot stops). */
export function isTerminal(config: BoardConfig, key: string): boolean {
  return isType(config, key, 'terminal')
}

/** True when the step is a queue (no agent run is spawned; autopilot passes through). */
export function isQueue(config: BoardConfig, key: string): boolean {
  return isType(config, key, 'queue')
}

/** True when the step is agent work (autopilot advances on completion). */
export function isAgentStep(config: BoardConfig, key: string): boolean {
  return isType(config, key, 'agent')
}

/** The step new tickets enter by default: the first `entry: true` step, else the first step. */
export function defaultEntryStep(config: BoardConfig): string {
  return (config.steps.find((s) => s.entry === true) ?? config.steps[0]!).key
}

/**
 * The next pipeline step after `step` in config order, skipping any step
 * whose `skipUnless` frontmatter flag is falsy on the ticket. Returns undefined
 * at the end of the pipeline or when `step` is not a config step (e.g. 'blocked').
 */
export function nextStep(config: BoardConfig, step: Step, ticket: Ticket): Step | undefined {
  const index = config.steps.findIndex((s) => s.key === step)
  if (index < 0) return undefined
  const flags = ticket as unknown as Record<string, unknown>
  for (const candidate of config.steps.slice(index + 1)) {
    if (candidate.skipUnless !== undefined) {
      // Known frontmatter field first; a custom flag lives in ticket.extras.
      const flag = flags[candidate.skipUnless] ?? ticket.extras?.[candidate.skipUnless]
      if (!flag) continue
    }
    return candidate.key
  }
  return undefined
}

/**
 * Resolves the adapter that runs a step: the step's named `agent` if set,
 * else the board's `default` adapter, else {@link BUILT_IN_ADAPTER}.
 */
export function adapterForStep(config: BoardConfig, key: string): AgentAdapter {
  const name = stepByKey(config, key)?.agent
  if (name !== undefined) {
    const adapter = config.agents[name]
    if (adapter === undefined) throw new Error(`Step '${key}' references unknown agent adapter '${name}'`)
    return adapter
  }
  return config.agents['default'] ?? BUILT_IN_ADAPTER
}
