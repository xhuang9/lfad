#!/usr/bin/env node
/**
 * lfad one-time (idempotent) bootstrap — `pnpm bootstrap` / `node scripts/setup.mjs`.
 *
 * Reproduces, deterministically, the install steps a human/agent would otherwise do
 * by hand. Safe to re-run: it never wipes an existing board and never overwrites .env.
 *
 *   1. build the monorepo            (pnpm -r build)            — skip with --no-build
 *   2. ensure the board             (config-driven: board.yml + its step folders)
 *   3. seed example tickets          ONLY with --seed AND only when the board is empty
 *   4. git-init the board            (local-only recoverable history) + first snapshot
 *   5. scaffold .env from .env.example  (only if .env is missing)
 *   6. verify                        (build artifacts + board present) and print config
 *
 * Flags: --board <path>  --prefix <name>  --seed  --no-build
 * Skill prefix: --prefix, else LFAD_PREFIX, else asked at a terminal, else the
 * currently installed name (published default `lfad`). Users invoke skills as
 * /<prefix>:up in Claude Code and $<prefix>:up in Codex.
 * Board default: in-board install (tool folder named `.lfad`, or `.hitloop` before the rename) → the parent dir;
 * otherwise the sibling layout (../.flow). Override with --board or LFAD_BOARD.
 *
 * Steps are config-driven (board.yml owns the steps; a step key IS its bare
 * folder name — todo/, not 5-todo/). A fresh board is handed THIS script's
 * default board.yml — the nine-step two-row pipeline
 * (idea → research → interview → mock → design → todo → doing → review → done, with
 * mock/design gated on the ticket's needsDesign flag) — and its step folders;
 * an EXISTING board.yml is never touched (boards are never restructured by
 * setup). An OLD numbered layout (0-idea/ … with no board.yml) is NOT guessed
 * at — this script points at the migration and exits non-zero.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { applyPrefix, currentPrefix, isValidPrefix } from './skill-prefix.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

// A tool folder named `.lfad` (or `.hitloop` from before the rename) IS an in-board install —
// the board is its parent. Otherwise assume the sibling layout (../.flow).
const inBoard = ['.lfad', '.hitloop'].includes(basename(root))
const board = resolve(valOf('--board') ?? (process.env.LFAD_BOARD ?? process.env.HITLOOP_BOARD) ?? (inBoard ? resolve(root, '..') : resolve(root, '..', '.agent-dashboard')))

/** Run a command to completion, inheriting stdio; throw on failure. */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
  if (res.status !== 0) {
    console.error(`setup: \`${cmd} ${args.join(' ')}\` failed (exit ${res.status ?? res.signal})`)
    process.exit(res.status ?? 1)
  }
}

/** Best-effort git in the board repo; returns whether it succeeded. */
function git(args) {
  return spawnSync('git', ['-C', board, ...args], { stdio: 'ignore' }).status === 0
}

/** True when `dir` directly contains at least one `NNNNN-slug` ticket folder. */
function containsTicketFolders(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((entry) => entry.isDirectory() && /^\d+-.+$/.test(entry.name))
}

/** True when the board root has legacy numbered step folders (`0-idea` style). */
function hasLegacyNumberedStepDirs(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  return entries.some((entry) => entry.isDirectory() && /^\d+-/.test(entry.name))
}

/**
 * The default board this script writes on a FRESH board (no board.yml yet):
 * the nine-step two-row pipeline. Rows: agents = research/todo/doing/review/done;
 * needs-you = idea/interview/mock/design/review. mock and design are human gates that
 * apply only to tickets whose `needsDesign` frontmatter flag is truthy
 * (the idea skill sets it for ui-category tickets). `actions` follow the library
 * pattern: each step's own skill plus the next step's pull skill where
 * sensible. Gates carry no answer-collector action — the human answers on the
 * board (input mode) or inline with the agent working the ticket.
 * Interview's forward pull button is the todo skill (the unconditional pull);
 * design-flagged tickets reach mock via the mock skill, which the interview skill
 * names on completion.
 */
const DEFAULT_BOARD_YML = `version: 1
steps:
  - key: idea
    label: Idea
    type: agent
    row: needs-you
    entry: true
    entryWhen: Raw or unshaped intent, or anything that fits no later entry step.
    skill: __PREFIX__:idea
    actions:
      - __PREFIX__:next
  - key: research
    label: Research
    type: agent
    row: agents
    skill: __PREFIX__:research
    actions:
      - __PREFIX__:next
  - key: interview
    label: Interview
    type: gate
    row: needs-you
    entry: true
    entryWhen: The outcome and the code to change are already known, and only direction choices for a person remain.
    skill: __PREFIX__:interview
    actions:
      - __PREFIX__:next
  - key: mock
    label: Mock
    type: gate
    row: needs-you
    skill: __PREFIX__:mock
    skipUnless: needsDesign
    actions:
      - __PREFIX__:next
  - key: design
    label: Design
    type: gate
    row: needs-you
    skill: __PREFIX__:design
    skipUnless: needsDesign
    actions:
      - __PREFIX__:next
  - key: todo
    label: Todo
    type: agent
    row: agents
    entry: true
    entryWhen: "The work is fully specified: what to change, where, and how to check it, with no open decisions."
    skill: __PREFIX__:todo
    actions:
      - __PREFIX__:next
  - key: doing
    label: Doing
    type: agent
    row: agents
    skill: __PREFIX__:build
    actions:
      - __PREFIX__:next
  - key: review
    label: Review
    type: gate
    row: needs-you
    skill: __PREFIX__:review
    actions:
      - __PREFIX__:next
  - key: done
    label: Done
    type: terminal
    row: agents
`

/** DEFAULT_BOARD_YML with the chosen skill prefix filled in. */
const defaultBoardYml = (prefix) => DEFAULT_BOARD_YML.replaceAll('__PREFIX__:', `${prefix}:`)

/** Step folders matching DEFAULT_BOARD_YML (created alongside it on a fresh board). */
const DEFAULT_STEP_KEYS = ['idea', 'research', 'interview', 'mock', 'design', 'todo', 'doing', 'review', 'done']

// 0 — the skill prefix (what users type before each skill: /<prefix>:up).
const installed = currentPrefix(root)
let prefix = valOf('--prefix') ?? process.env.LFAD_PREFIX
if (prefix === undefined && process.stdin.isTTY && process.stdout.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`Skill prefix (skills run as /<prefix>:up) [${installed}]: `)).trim()
  rl.close()
  prefix = answer.length > 0 ? answer : installed
}
prefix ??= installed
if (!isValidPrefix(prefix)) {
  console.error(`setup: invalid skill prefix "${prefix}". Use lowercase letters, digits and hyphens.`)
  process.exit(1)
}
const prefixChanged = applyPrefix(root, prefix)

console.log(`lfad setup — tool ${root}`)
console.log(`               board ${board}`)
console.log(`               skill prefix ${prefix} (/${prefix}:up in Claude Code, $${prefix}:up in Codex)${prefixChanged.length > 0 ? ` — updated ${prefixChanged.length} manifest(s)` : ''}`)

// 1 — build (the runtime bundles core's dist, so build all).
if (has('--no-build')) {
  console.log('1/6 build      — skipped (--no-build)')
} else {
  console.log('1/6 build      — pnpm -r build')
  run('pnpm', ['-r', 'build'])
}

// 2 — ensure the board (config-driven). A FRESH board gets THIS script's
//     default board.yml (the nine-step two-row pipeline) + its step folders;
//     an existing board.yml is validated and left exactly as it is (setup
//     never restructures a board). An OLD numbered layout with no board.yml
//     is pointed at the migration.
mkdirSync(board, { recursive: true })
const configPath = resolve(board, 'board.yml')
if (!existsSync(configPath) && hasLegacyNumberedStepDirs(board)) {
  console.error(
    `2/6 board      — legacy numbered step folders found but no board.yml at ${board}.\n`
    + '                 Steps are now config-driven; migrate the board first (renames the\n'
    + '                 numbered folders and writes board.yml), then re-run setup:\n'
    + `                   node scripts/migrate-board.mjs ${board}`,
  )
  process.exit(1)
}

const coreEntry = resolve(root, 'packages/core/dist/index.js')
if (!existsSync(coreEntry)) {
  console.error(
    `2/6 board      — core build artifact missing (${coreEntry}).\n`
    + '                 Re-run without --no-build so the board config can be ensured.',
  )
  process.exit(1)
}
let loadBoardConfig
try {
  ;({ loadBoardConfig } = await import(pathToFileURL(coreEntry).href))
} catch (err) {
  console.error(`2/6 board      — could not load core: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

// Fresh board (no board.yml, no legacy layout) ⇒ write the default
// nine-step board.yml and create its step folders BEFORE loading, so the
// loader validates exactly what new boards will run (core's own fallback
// default never applies here). Idempotent: an existing board.yml is never
// rewritten.
if (!existsSync(configPath)) {
  writeFileSync(configPath, defaultBoardYml(prefix))
  for (const key of DEFAULT_STEP_KEYS) mkdirSync(resolve(board, key), { recursive: true })
}

let config
try {
  // Validates board.yml and reconciles the disk (creating missing step
  // folders, refusing a config that leaves a stray directory holding
  // tickets). Either way the board is left config-valid.
  config = loadBoardConfig(board)
} catch (err) {
  console.error(`2/6 board      — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

// Config-aware empty check: does any config step (or the system `blocked`
// dir) hold a ticket folder? Replaces the legacy `/^\d+-/` folder scan.
const ticketDirs = [...config.steps.map((s) => s.key), 'blocked', 'parked']
const boardIsEmpty = !ticketDirs.some((key) => containsTicketFolders(resolve(board, key)))
console.log(
  `2/6 board      — ensured (${config.steps.length} step(s): ${config.steps.map((s) => s.key).join(' → ')}; `
  + `${boardIsEmpty ? 'empty' : 'has tickets'})`,
)

// 3 — seed ONLY on explicit --seed and only when empty (seeding wipes).
if (has('--seed')) {
  if (boardIsEmpty) {
    console.log('3/6 seed       — flow seed (board was empty)')
    run(process.execPath, [resolve(root, 'packages/runtime/dist/cli.js'), 'seed', board])
  } else {
    console.log('3/6 seed       — skipped (board already has tickets; refusing to wipe)')
  }
} else {
  console.log('3/6 seed       — skipped (no --seed; board left as-is)')
}

// 4 — git-init the board for local-only recoverable history. Machinery entries
//     go into .gitignore FIRST so the initial snapshot never tracks them (same
//     entries as the runtime's ensureBoardGitignore: .ui/, log/, .lfad/, .hitloop/).
const giPath = resolve(board, '.gitignore')
const giEntries = ['.ui/', 'log/', '.lfad/', '.hitloop/']
const giLines = existsSync(giPath) ? readFileSync(giPath, 'utf8').split(/\r?\n/) : []
const giPresent = new Set(giLines.map((l) => l.trim()))
const giMissing = giEntries.filter((e) => !giPresent.has(e))
if (giMissing.length > 0) writeFileSync(giPath, `${[...giLines.filter((l) => l.trim() !== ''), ...giMissing].join('\n')}\n`)

if (existsSync(resolve(board, '.git'))) {
  console.log('4/6 board git  — already a repo')
} else if (git(['init', '-q'])) {
  git(['add', '-A'])
  const committed = spawnSync(
    'git',
    ['-C', board, '-c', 'user.email=flow@local', '-c', 'user.name=flow', 'commit', '-q', '-m', 'Initial board state'],
    { stdio: 'ignore' },
  ).status === 0
  console.log(`4/6 board git  — initialized${committed ? ' + first snapshot' : ''}`)
} else {
  console.log('4/6 board git  — could not init (git unavailable) — skipped')
}

// 5 — scaffold .env from .env.example (never overwrite an existing .env).
// In-board installs get LFAD_BOARD patched to `..` so the scaffold matches
// the layout out of the box.
const envPath = resolve(root, '.env')
const envExample = resolve(root, '.env.example')
if (existsSync(envPath)) {
  console.log('5/6 .env       — exists (left untouched)')
} else if (existsSync(envExample)) {
  copyFileSync(envExample, envPath)
  if (inBoard) {
    writeFileSync(envPath, readFileSync(envPath, 'utf8').replace(/^LFAD_BOARD=.*$/m, 'LFAD_BOARD=..'))
  }
  console.log(`5/6 .env       — created from .env.example${inBoard ? ' (LFAD_BOARD=.. for the in-board layout)' : ''} (review LFAD_* before a real run)`)
} else {
  console.log('5/6 .env       — no .env.example found — skipped')
}

// 6 — verify.
const cliOk = existsSync(resolve(root, 'packages/runtime/dist/cli.js'))
const uiOk = existsSync(resolve(root, 'packages/ui/dist/index.html'))
console.log(`6/6 verify     — cli ${cliOk ? 'ok' : 'MISSING'}, ui ${uiOk ? 'ok' : 'MISSING'}, board ${existsSync(board) ? 'ok' : 'MISSING'}`)

console.log('\nDone. Launch with:  pnpm demo   (sandbox)   or')
console.log(`                    node packages/runtime/dist/cli.js serve ${board}`)
console.log('The daemon serves the UI from <board>/.ui (gitignored, copied from the tool on serve).')
console.log(`Steps live in <board>/board.yml (grow the board with /${prefix}:add-step). Run config is dry-run`)
console.log(`by default — see .env.example / the /${prefix}:setup skill for the first-real-run recipe.`)
if (!cliOk || !uiOk) process.exit(1)
