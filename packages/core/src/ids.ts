/**
 * Ticket id allocation and folder-name (de)serialization for @lfad/core.
 *
 * Ids are monotonically increasing positive integers, persisted in a `.counter`
 * file at the board root and reflected in ticket folder names (`NNNN-slug`).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { BoardConfig } from './config.js'
import { atomicWriteFileSync } from './fs-atomic.js'
import { ARCHIVE_DIR, BLOCKED_DIR, PARKED_DIR } from './steps.js'

/** Name of the board-root file holding the most recently allocated id. */
const COUNTER_FILE = '.counter'

/** Zero-pads a ticket id to a 5-digit string (ids past 99999 keep their full width). */
export function zeroPad(id: number): string {
  return String(id).padStart(5, '0')
}

/** Builds a ticket folder name from an id and slug, e.g. (1, 'foo') -> '00001-foo'. */
export function ticketFolderName(id: number, slug: string): string {
  return `${zeroPad(id)}-${slug}`
}

/**
 * Parses a `NNNN-slug` ticket folder name into its id and slug, or returns
 * undefined when the name is not a valid ticket folder (no leading digits,
 * missing separator, or empty slug).
 */
export function parseTicketFolder(name: string): { id: number, slug: string } | undefined {
  const match = /^(\d+)-(.+)$/.exec(name)
  if (match === null) return undefined
  const id = Number.parseInt(match[1], 10)
  if (!Number.isSafeInteger(id)) return undefined
  return { id, slug: match[2] }
}

/**
 * Scans every config step folder plus `blocked` and `_archive` under the
 * board root and returns the ids of all ticket folders found on disk
 * (unsorted, may contain duplicates).
 */
export function scanExistingIds(root: string, config: BoardConfig): number[] {
  const folders = [...config.steps.map((s) => s.key), BLOCKED_DIR, PARKED_DIR, ARCHIVE_DIR]
  const ids: number[] = []
  for (const folder of folders) {
    ids.push(...listTicketIds(join(root, folder)))
  }
  return ids
}

/**
 * Allocates the next ticket id for the board, serialized through `<root>/.counter`.
 * Reads the current counter, reconciles it with the max id on disk (across all
 * config steps, `blocked`, and `_archive`), and atomically persists the new
 * value; the first-ever id is 1. The disk reconciliation means a counter that
 * lags the folders it mirrors — a partial snapshot restore, a hand-copied
 * ticket folder — can never re-issue an id that already names a ticket.
 */
export function allocateId(root: string, config: BoardConfig): number {
  const counterPath = join(root, COUNTER_FILE)
  const current = readCounter(counterPath) ?? 0
  const next = Math.max(current, maxOnDisk(root, config)) + 1
  writeCounterAtomic(counterPath, next)
  return next
}

/** Returns the highest ticket id present on disk, or 0 when the board is empty. */
function maxOnDisk(root: string, config: BoardConfig): number {
  const ids = scanExistingIds(root, config)
  return ids.length > 0 ? Math.max(...ids) : 0
}

/** Lists the parsed ticket ids directly inside one step/archive directory. */
function listTicketIds(dirPath: string): number[] {
  let entries
  try {
    entries = readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
  const ids: number[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const parsed = parseTicketFolder(entry.name)
    if (parsed !== undefined) ids.push(parsed.id)
  }
  return ids
}

/** Reads `.counter` as a non-negative integer, or undefined when missing/corrupt. */
function readCounter(counterPath: string): number | undefined {
  let raw: string
  try {
    raw = readFileSync(counterPath, 'utf8')
  } catch {
    return undefined
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const value = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(value) ? value : undefined
}

/** Writes the counter via a unique temp file + atomic rename (never a torn write). */
function writeCounterAtomic(counterPath: string, value: number): void {
  atomicWriteFileSync(counterPath, `${value}\n`)
}
