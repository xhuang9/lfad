#!/usr/bin/env node
/**
 * `flow` — the agent dashboard CLI.
 *
 *   flow serve [boardRoot] --port <n> --ui <dir>       start the daemon
 *   flow seed  [boardRoot]                              wipe + seed a default demo board
 *   flow create <title> --category <c> [--tags a,b] [--body <text>] [--step <key>]
 *   flow move <id> <toStep> --reason <text>             move a ticket (reason → ticket log)
 *   flow show <id>                                      print frontmatter + artifacts + body
 *   flow note <id> --step <key> --skip --reason <t>     fast-pass: mark a step not applicable
 *   flow archive <id> --reason <text>                   cold-store a ticket into _archive
 *   flow reactivate <id> --step <key> --reason <text>   bring an archived ticket back to a live step
 *   flow worktree create <id> --branch <name>           provision a ticket's git worktree
 *   flow worktree remove <id>                           remove it and clear the frontmatter field
 *
 * The ticket commands are the daemon-down path: while the daemon runs, route
 * writes through its REST API (it is the board's sole committer). Snapshot
 * semantics mirror the daemon: moves/additions never snapshot; modifications
 * (note) commit a pre-change board snapshot first.
 *
 * Config precedence: CLI flag/arg > .env (LFAD_*, or legacy HITLOOP_*) > built-in default.
 * Relative paths resolve against the current working directory. Step columns
 * and agent adapters live in `<board>/board.yml` — see docs/board.example.yml.
 */

import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { cac } from 'cac'

import { createServer, resolveRunConfig, type RunningServer } from './index.js'
import { seedBoard } from './seed.js'
import {
  archiveCommand,
  createCommand,
  moveCommand,
  noteCommand,
  parkCommand,
  parseTags,
  reactivateCommand,
  renderShow,
  showCommand,
  unparkCommand,
} from './ticket-commands.js'
import { withLegacyEnv } from '@lfad/core'

import { resolveUiDir, toolUiDistFromHere } from './ui-dir.js'
import { worktreeCreateCommand, worktreeRemoveCommand } from './worktree.js'

// Load .env (LFAD_*, or legacy HITLOOP_*) from the cwd if present; a missing file is a no-op.
try {
  process.loadEnvFile()
} catch {
  /* no .env — fall back to flags + built-in defaults */
}

const env = withLegacyEnv(process.env)
const DEFAULT_PORT = 4319
/** New boards live one level up from the tool folder, in `.agent-dashboard`. */
const DEFAULT_BOARD = '../.agent-dashboard'

/** Resolve a possibly-relative path (against cwd) to absolute, or undefined when unset. */
function abs(p: string | undefined): string | undefined {
  return p === undefined || p === '' ? undefined : resolve(p)
}

/** The board root for commands without a positional board arg. */
function boardFromEnv(): string {
  return resolve(env.LFAD_BOARD ?? DEFAULT_BOARD)
}

/** Prints the error and exits 1 (CLI failure convention). */
function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

interface ServeOptions {
  port?: string
  ui?: string
  docsChunks?: string
  docsSessions?: string
}

interface SeedOptions {
  force?: boolean
}

const cli = cac('flow')

cli
  .command('serve [boardRoot]', 'Start the dashboard daemon (board API + UI) on a port')
  .option('--port <port>', 'Port to listen on (env LFAD_PORT)')
  .option('--ui <dir>', 'Directory of a built UI to serve at / (env LFAD_UI_DIR)')
  .option('--docs-chunks <dir>', 'Where the Document step writes chunks (env LFAD_DOCS_CHUNKS)')
  .option('--docs-sessions <dir>', 'Where the Document step writes session docs (env LFAD_DOCS_SESSIONS)')
  .action(async (boardRoot: string | undefined, options: ServeOptions) => {
    const board = resolve(boardRoot ?? env.LFAD_BOARD ?? DEFAULT_BOARD)
    // Serve any project's board, even a brand-new empty one: ensure the root exists.
    mkdirSync(board, { recursive: true })
    const port = Number(options.port ?? env.LFAD_PORT) || DEFAULT_PORT
    // Serve the UI from the board's own `<board>/.ui` (gitignored, populated from
    // the tool's built UI), unless an explicit --ui / LFAD_UI_DIR overrides it.
    const uiDir = resolveUiDir(board, abs(options.ui ?? env.LFAD_UI_DIR), toolUiDistFromHere())
    const docsChunksDir = abs(options.docsChunks ?? env.LFAD_DOCS_CHUNKS)
    const docsSessionsDir = abs(options.docsSessions ?? env.LFAD_DOCS_SESSIONS)
    const runConfig = resolveRunConfig(env, board)

    let running: RunningServer
    try {
      // createServer loads + validates <board>/board.yml and refuses to start
      // on a config/disk mismatch (anti silent-ticket-loss).
      running = await createServer({
        boardRoot: board,
        uiDir,
        docsChunksDir,
        docsSessionsDir,
        runConfig,
      }).start(port)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
    console.log(`Board: ${board}`)
    console.log(`Agent dashboard → http://localhost:${running.port}`)
    console.log(
      `Run engine (headless, dormant — the UI copies commands instead): dryRun=${runConfig.dryRun}`
      + ` autopilot=${runConfig.autopilot} codeRepo=${runConfig.codeRepo ?? '(none — doc/dry-run only)'} (agents: board.yml)`,
    )

    const stop = (): void => {
      void running.close().then(() => process.exit(0))
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })

cli
  .command('seed [boardRoot]', 'Wipe and seed a default demo board (idea → research → interview → mock → design → todo → doing → review → done)')
  .option('--force', 'Replace an existing board after backing it up')
  .action((boardRoot: string | undefined, options: SeedOptions) => {
    const board = resolve(boardRoot ?? env.LFAD_BOARD ?? DEFAULT_BOARD)
    let tickets
    try {
      tickets = seedBoard(board, { force: options.force })
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
    console.log(`Seeded ${tickets.length} tickets into ${board}`)
  })

/** Parses a `<ticketId>` positional, failing the process on a non-integer. */
function ticketIdArg(raw: string): number {
  const id = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(id)) fail(`Invalid ticket id: ${raw}`)
  return id
}

interface CreateOptions {
  category?: string
  tags?: string
  body?: string
  step?: string
  /** Deprecated alias of --step. */
  stage?: string
}

cli
  .command('create <title>', 'Create a ticket on the board (additions are never git-snapshotted)')
  .option('--category <category>', 'Ticket category: ui|bug|logic|business|refactor|hotfix')
  .option('--tags <tags>', 'Comma-separated tags (e.g. auth,ui)')
  .option('--body <text>', 'Ticket body — the idea/intent')
  .option('--step <key>', "Entry step key (defaults to the board's entry step)")
  .option('--stage <key>', 'Deprecated alias of --step')
  .action((title: string, options: CreateOptions) => {
    if (options.category === undefined || options.category.trim().length === 0) {
      fail('create requires --category <ui|bug|logic|business|refactor|hotfix>')
    }
    try {
      const tags = parseTags(options.tags)
      const step = options.step ?? options.stage
      const ticket = createCommand(boardFromEnv(), {
        title,
        category: options.category,
        ...(options.body !== undefined ? { body: options.body } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(step !== undefined ? { step } : {}),
      })
      console.log(`Created ticket #${ticket.id} in step '${ticket.status}'`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

interface MoveOptions {
  reason?: string
}

cli
  .command('move <ticketId> <toStep>', 'Move a ticket to a step (the reason is recorded in the ticket log)')
  .option('--reason <text>', 'Why the ticket is moving (audit trail)')
  .action((ticketId: string, toStep: string, options: MoveOptions) => {
    const id = ticketIdArg(ticketId)
    try {
      const ticket = moveCommand(boardFromEnv(), id, toStep, options.reason)
      console.log(`Ticket #${ticket.id} moved to '${ticket.status}'`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

cli
  .command('show <ticketId>', 'Print a ticket: frontmatter summary, artifact file list, and body')
  .action((ticketId: string) => {
    const id = ticketIdArg(ticketId)
    try {
      console.log(renderShow(showCommand(boardFromEnv(), id)))
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

interface NoteOptions {
  step?: string
  /** Deprecated alias of --step. */
  stage?: string
  skip?: boolean
  reason?: string
}

cli
  .command('note <ticketId>', 'Record a step fast-pass marker (stepNotes: applicable=false) on a ticket')
  .option('--step <key>', 'The step the note applies to')
  .option('--stage <key>', 'Deprecated alias of --step')
  .option('--skip', 'Mark the step as not applicable to this ticket')
  .option('--reason <text>', 'Why the step does not apply')
  .action((ticketId: string, options: NoteOptions) => {
    const id = ticketIdArg(ticketId)
    const step = options.step ?? options.stage
    if (step === undefined || step.trim().length === 0) {
      fail('note requires --step <key>')
    }
    try {
      const ticket = noteCommand(boardFromEnv(), id, {
        step,
        skip: options.skip === true,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
      })
      console.log(`Ticket #${ticket.id}: step '${step}' marked not applicable`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

interface ArchiveOptions {
  reason?: string
}

cli
  .command('archive <ticketId>', 'Cold-store a ticket into _archive (a move — never git-snapshotted)')
  .option('--reason <text>', 'Why the ticket is being archived (audit trail)')
  .action((ticketId: string, options: ArchiveOptions) => {
    const id = ticketIdArg(ticketId)
    try {
      const ticket = archiveCommand(boardFromEnv(), id, options.reason)
      console.log(`Ticket #${ticket.id} archived`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

interface ReactivateOptions {
  step?: string
  reason?: string
}

cli
  .command('reactivate <ticketId>', 'Bring an archived ticket back onto a live step (a move — never git-snapshotted)')
  .option('--step <key>', "Target step (defaults to the ticket's archived-from step)")
  .option('--reason <text>', 'Why the ticket is being reactivated (audit trail)')
  .action((ticketId: string, options: ReactivateOptions) => {
    const id = ticketIdArg(ticketId)
    try {
      const ticket = reactivateCommand(boardFromEnv(), id, options.step, options.reason)
      console.log(`Ticket #${ticket.id} reactivated → '${ticket.status}'`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

cli
  .command('park <ticketId>', 'Set aside a live ticket in parked (a move — never git-snapshotted)')
  .action((ticketId: string) => {
    const id = ticketIdArg(ticketId)
    try {
      const ticket = parkCommand(boardFromEnv(), id)
      console.log(`Ticket #${ticket.id} parked from '${ticket.returnStep}'`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

cli
  .command('unpark <ticketId>', 'Restore a parked ticket to its recorded origin step')
  .action((ticketId: string) => {
    const id = ticketIdArg(ticketId)
    try {
      const ticket = unparkCommand(boardFromEnv(), id)
      console.log(`Ticket #${ticket.id} restored → '${ticket.status}'`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

interface WorktreeOptions {
  branch?: string
}

cli
  .command(
    'worktree <action> <ticketId>',
    'create|remove a ticket\'s git worktree (mechanism only; branch policy lives in the calling skill)',
  )
  .option('--branch <name>', 'Branch to create the worktree on (required for create)')
  .action((action: string, ticketId: string, options: WorktreeOptions) => {
    const id = Number.parseInt(ticketId, 10)
    if (!Number.isSafeInteger(id)) fail(`Invalid ticket id: ${ticketId}`)
    const board = boardFromEnv()
    try {
      if (action === 'create') {
        const branch = options.branch?.trim()
        if (branch === undefined || branch.length === 0) {
          fail('worktree create requires --branch <name>')
        }
        const { path } = worktreeCreateCommand(board, env, id, branch)
        console.log(`Worktree for ticket #${id}: ${path} (branch ${branch})`)
      } else if (action === 'remove') {
        worktreeRemoveCommand(board, env, id)
        console.log(`Worktree for ticket #${id} removed`)
      } else {
        fail(`Unknown worktree action '${action}' (expected create|remove)`)
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  })

cli.help()
cli.parse()
