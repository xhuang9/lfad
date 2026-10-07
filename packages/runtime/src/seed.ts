/**
 * Demo-board seeder. {@link seedBoard} wipes and recreates a board root with
 * core's canonical default config (the nine-step pipeline
 * idea → research → interview → mock → design → todo → doing → review → done,
 * written as `board.yml` by `loadBoardConfig`), then populates it with a
 * realistic ticket at idea, doing, and done. Used by `flow seed`.
 */

import { homedir } from 'node:os'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  appendArtifact,
  createTicket,
  loadBoardConfig,
  moveTicket,
  type BoardConfig,
  type CreateTicketInput,
  type Step,
  type Ticket,
} from '@lfad/core'

/** Refuses obviously-dangerous wipe targets (filesystem root or the home dir). */
function guardWipeTarget(root: string): void {
  const home = resolve(homedir())
  if (root === resolve('/') || root === home) {
    throw new Error(`Refusing to seed (and wipe) a dangerous path: ${root}`)
  }
}

/** Options controlling replacement of an existing board. */
export interface SeedBoardOptions {
  /** Permit replacing an existing board. The old board is backed up first. */
  force?: boolean
}

/** Whether `root` contains either board config or a ticket in an immediate step folder. */
function isExistingBoard(root: string): boolean {
  if (!existsSync(root)) return false
  if (existsSync(join(root, 'board.yml'))) return true

  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .some(step => readdirSync(join(root, step.name), { withFileTypes: true })
      .some(ticket => ticket.isDirectory() && /^\d+-/.test(ticket.name)))
}

/** A sortable timestamp that is safe in directory names on common filesystems. */
function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * Creates a ticket and (optionally) moves it straight to `target`, returning the
 * ticket in its final step. Moving from the default entry step gives each
 * ticket a small, believable history trail.
 */
function place(root: string, config: BoardConfig, input: CreateTicketInput, target?: Step, reason?: string): Ticket {
  const created = createTicket(root, config, input)
  if (target !== undefined && target !== created.status) {
    return moveTicket(root, config, created.id, target, { reason })
  }
  return created
}

/**
 * Wipes `boardRoot`, recreates it as a default board, and seeds a ticket at
 * idea, doing, and done. Returns every created ticket (in their final steps)
 * for logging/inspection.
 */
export function seedBoard(boardRoot: string, options: SeedBoardOptions = {}): Ticket[] {
  const root = resolve(boardRoot)
  guardWipeTarget(root)
  if (isExistingBoard(root)) {
    if (options.force !== true) {
      throw new Error(
        `Refusing to seed over the existing board at ${root}. `
        + 'Pass --force to replace it; --force backs the existing board up first.',
      )
    }
    renameSync(root, `${root}.bak-${backupTimestamp()}`)
  }
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  // A fresh board: this writes the DEFAULT_BOARD_CONFIG board.yml and creates
  // its step folders.
  const config = loadBoardConfig(root)

  const tickets: Ticket[] = []

  // 1 — Idea (bug): raw intent waiting to be shaped into a plan.
  tickets.push(place(root, config, {
    title: 'Fix timezone in reminders',
    category: 'bug',
    tags: ['reminders', 'timezone'],
    body: 'Reminders fire an hour off after a DST change. Anchor reminder times '
      + 'to the account timezone rather than a fixed UTC offset.',
  }))

  // 2 — Doing (ui), with a plan artifact so the detail view has content.
  const darkMode = place(
    root,
    config,
    {
      title: 'Add dark mode',
      category: 'ui',
      tags: ['theme', 'accessibility'],
      body: 'Users on night feeds want a dark theme that is easy on the eyes. '
        + 'Add a full dark palette with a system / light / dark toggle that persists.',
    },
    'doing',
    'Picked up for implementation',
  )
  appendArtifact(root, config, darkMode.id, 'plan.md', `# Plan — Add dark mode

## Approach
Introduce a \`data-theme\` attribute on the document root and drive every colour
through CSS custom properties. No component needs to know which theme is active;
the variables resolve at the root.

## Steps
1. Extract the existing palette into \`:root\` tokens (light is the default).
2. Add a \`[data-theme="dark"]\` block overriding the same tokens.
3. Persist the user's choice to local storage and hydrate it before first paint
   to avoid a flash of the wrong theme.
4. Add a three-way toggle: System / Light / Dark.

## Risks
A flash of unstyled / wrong-theme content on load is the main hazard — the
hydration script must run synchronously in \`<head>\`.
`)
  tickets.push(darkMode)

  // 3 — Done (refactor): shipped work for the terminal column.
  tickets.push(place(
    root,
    config,
    {
      title: 'Migrate to pnpm',
      category: 'refactor',
      tags: ['tooling', 'ci'],
      body: 'Move the monorepo from npm to pnpm workspaces for faster, stricter '
        + 'installs and a single lockfile.',
    },
    'done',
    'Shipped — CI and local installs both green',
  ))

  return tickets
}
