/**
 * Crash-safe file write shared by the core modules (config, fileops,
 * frontmatter, ids): write+fsync a temp file in the same directory, then
 * `rename` it into place so a crash never leaves a torn file. Internal —
 * deliberately not exported from the package barrel.
 */

import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'

export function atomicWriteFileSync(path: string, content: string): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(tmp, path)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {
      // best-effort cleanup; surface the original rename failure
    }
    throw err
  }
}
