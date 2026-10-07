/**
 * Reads the human-facing artifacts of a single ticket folder for the detail
 * view: the ticket.md *body* (surfaced as "Idea") plus every other `*.md` file
 * in the folder and its step subfolders (`blocked.md`, `plan/01-x.md`, …),
 * composed into the canonical rail order. Also resolves raw ticket-folder file
 * paths for `GET /api/tickets/:id/files/*`. The frontmatter spine itself is
 * owned by core and is not returned here.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'

import { ARCHIVE_DIR, BLOCKED_DIR, listTicketFiles, PARKED_DIR, stepKeys, type BoardConfig } from '@lfad/core'

/** One named markdown artifact returned by {@link readArtifacts}. */
export interface Artifact {
  name: string
  content: string
}

/**
 * Locates a ticket's folder by scanning every config step folder (plus
 * `blocked`, `parked`, and `_archive`) under the board root for a `NNNN-slug` directory
 * whose numeric prefix matches `id`. Returns the absolute path, or `undefined`
 * when not found.
 */
function locateTicketDir(boardRoot: string, config: BoardConfig, id: number): string | undefined {
  const parents = [...stepKeys(config), BLOCKED_DIR, PARKED_DIR, ARCHIVE_DIR]
  for (const parent of parents) {
    const parentPath = join(boardRoot, parent)
    let entries: string[]
    try {
      entries = readdirSync(parentPath)
    } catch {
      continue
    }
    for (const name of entries) {
      const match = /^(\d+)-/.exec(name)
      if (match === null || Number.parseInt(match[1], 10) !== id) continue
      const full = join(parentPath, name)
      try {
        if (statSync(full).isDirectory()) return full
      } catch {
        // unreadable entry; keep scanning
      }
    }
  }
  return undefined
}

/** Strips a leading gray-matter `--- … ---` frontmatter block from raw markdown. */
function stripFrontmatter(raw: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw)
  return match === null ? raw : raw.slice(match[0].length)
}

/**
 * Composes the canonical rail order over core's file list: root-level files
 * first, then step subfolder groups in board-config pipeline order, then
 * unknown subfolders alphabetically last — files keeping core's natural sort
 * within each group.
 */
function orderTicketFiles(config: BoardConfig, files: string[]): string[] {
  const rootFiles: string[] = []
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const slash = file.indexOf('/')
    if (slash === -1) {
      rootFiles.push(file)
      continue
    }
    const folder = file.slice(0, slash)
    groups.set(folder, [...(groups.get(folder) ?? []), file])
  }
  const steps = stepKeys(config)
  const known = steps.filter((key) => groups.has(key))
  const unknown = [...groups.keys()]
    .filter((key) => !steps.includes(key))
    .sort((a, b) => a.localeCompare(b))
  return [...rootFiles, ...[...known, ...unknown].flatMap((key) => groups.get(key)!)]
}

/**
 * Reads the artifacts for the ticket with the given id, in the canonical
 * order: the ticket.md body as an "Idea" artifact (when non-empty), root-level
 * `*.md` files (natural-sorted), step subfolder groups in board-config
 * pipeline order, then unknown subfolders alphabetically. Names are relative
 * paths inside the ticket folder; missing/unreadable files are skipped.
 */
export function readArtifacts(boardRoot: string, config: BoardConfig, id: number): Artifact[] {
  const dir = locateTicketDir(boardRoot, config, id)
  if (dir === undefined) return []
  const artifacts: Artifact[] = []

  try {
    const body = stripFrontmatter(readFileSync(join(dir, 'ticket.md'), 'utf8')).trim()
    if (body.length > 0) artifacts.push({ name: 'Idea', content: body })
  } catch {
    // no readable ticket.md; fall through to the other artifacts
  }

  let files: string[]
  try {
    files = listTicketFiles(boardRoot, config, id)
  } catch {
    return artifacts // ticket vanished mid-read; keep whatever we have
  }
  for (const name of orderTicketFiles(config, files)) {
    try {
      artifacts.push({ name, content: readFileSync(join(dir, name), 'utf8') })
    } catch {
      // unreadable artifact; skip
    }
  }
  return artifacts
}

/** Content-Type per allowlisted extension served by `GET /api/tickets/:id/files/*`. */
const TICKET_FILE_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  // Served with `Content-Security-Policy: sandbox allow-scripts` (see app.ts):
  // user-authored html stays scriptable but origin-less, isolated from the daemon.
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

/** Resolution outcome for {@link resolveTicketFile}. */
export type TicketFileResolution =
  | { kind: 'ok', path: string, contentType: string }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }

/**
 * True when a relative artifact/file name is traversal-safe: not absolute, and
 * every segment a plain name (no `..`, dot-entries, or empty segments).
 */
export function isSafeRelativeName(name: string): boolean {
  if (name.length === 0 || isAbsolute(name)) return false
  return name.split(/[/\\]/).every((segment) => segment !== '' && !segment.startsWith('.'))
}

/**
 * True when a (traversal-safe) relative name targets a core-owned path that the
 * artifact write routes must never touch: the root `ticket.md` frontmatter
 * spine, or anything inside the append-only `log/` audit directory. The check
 * runs over the same `/[/\\]/` segment split the traversal guard uses, so both
 * slash forms are covered, and is case-insensitive because the common host
 * filesystem (macOS) folds `ticket.md`/`Ticket.md` and `log/`/`Log/` onto one
 * entry. A nested `plan/ticket.md` is fine — only the ROOT `ticket.md` is the
 * spine.
 */
export function isReservedArtifactName(name: string): boolean {
  const segments = name.split(/[/\\]/)
  const first = (segments[0] ?? '').toLowerCase()
  if (segments.length === 1 && first === 'ticket.md') return true
  return first === 'log'
}

/**
 * Resolves a relative path inside a ticket folder for raw serving. Traversal
 * attempts (absolute paths, `..`/dot segments, escaping the folder) are
 * `forbidden`; an unknown ticket, missing file, or non-allowlisted extension
 * is `not-found`.
 */
export function resolveTicketFile(boardRoot: string, config: BoardConfig, id: number, relPath: string): TicketFileResolution {
  const dir = locateTicketDir(boardRoot, config, id)
  if (dir === undefined) return { kind: 'not-found' }
  if (!isSafeRelativeName(relPath)) return { kind: 'forbidden' }
  const full = resolve(dir, relPath)
  if (!full.startsWith(resolve(dir) + sep)) return { kind: 'forbidden' }
  const contentType = TICKET_FILE_TYPES[extname(full).toLowerCase()]
  if (contentType === undefined) return { kind: 'not-found' }
  try {
    if (!statSync(full).isFile()) return { kind: 'not-found' }
  } catch {
    return { kind: 'not-found' }
  }
  return { kind: 'ok', path: full, contentType }
}

/** Image content-types an upload may store, mapped to their file extension. */
const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/**
 * Outcome of {@link saveTicketImage}. `not-found` means the ticket id is
 * unknown; `write-failed` means the ticket exists but the bytes could not be
 * persisted (permissions, ENOSPC, an occupied `files/` path) — the caller maps
 * these to 404 vs 500 so a disk failure is never disguised as a missing ticket.
 */
export type SaveImageResult =
  | { kind: 'ok', ref: string }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'unsupported' }
  | { kind: 'write-failed', message: string }

/**
 * Writes a pasted image into a `files/` subfolder beside the artifact it belongs
 * to, so `![](files/<name>)` in that artifact resolves through the files route
 * whatever the artifact's depth, and returns that relative reference. `stamp`
 * (the daemon passes Date.now()) keeps the filename unique.
 */
export function saveTicketImage(
  boardRoot: string,
  config: BoardConfig,
  id: number,
  artifactName: string,
  contentType: string,
  bytes: Uint8Array,
  stamp: number,
): SaveImageResult {
  const dir = locateTicketDir(boardRoot, config, id)
  if (dir === undefined) return { kind: 'not-found' }
  const ext = IMAGE_EXT[contentType]
  if (ext === undefined) return { kind: 'unsupported' }
  // The artifact's own folder ('' = root, for the Idea / ticket.md body).
  const folder = artifactName === 'Idea' ? '' : artifactName.slice(0, artifactName.lastIndexOf('/') + 1)
  const targetDir = resolve(dir, folder, 'files')
  if (targetDir !== resolve(dir) && !targetDir.startsWith(resolve(dir) + sep)) return { kind: 'forbidden' }
  try {
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, `paste-${stamp}.${ext}`), bytes)
  } catch (err) {
    // The ticket exists (located above) — this is a genuine write failure, not a
    // missing ticket, so surface it distinctly (mapped to 500 by the route).
    return { kind: 'write-failed', message: err instanceof Error ? err.message : String(err) }
  }
  return { kind: 'ok', ref: `files/paste-${stamp}.${ext}` }
}
