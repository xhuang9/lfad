/**
 * BoardIndex reconcile pass: a rebuild self-heals any ticket whose frontmatter
 * `status` does not match the step folder it physically lives in (the folder
 * wins), warns once per repair, and never rewrites healthy tickets — the loop
 * guard that lets a watcher-triggered rebuild converge instead of looping.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTicket, moveTicket, readTicket } from '@lfad/core'
import { describe, expect, it, vi } from 'vitest'

import { BoardIndex } from '../src/board-index.js'
import { makeFullFixtureBoard } from './helpers.js'

/** Path to a fixture ticket's ticket.md inside a given step folder. */
function ticketPath(root: string, stepFolder: string, id: number, slug: string): string {
  return join(root, stepFolder, `${String(id).padStart(5, '0')}-${slug}`, 'ticket.md')
}

describe('BoardIndex rebuild reconcile', () => {
  it('repairs a status/folder mismatch (folder wins), warns once, and converges on the next rebuild', () => {
    const { root, config } = makeFullFixtureBoard('lfad-index-')
    try {
      const t = createTicket(root, config, { title: 'Torn', category: 'logic' })
      // Hand-craft the tear a crashed relocate leaves behind: content says the
      // new step, folder still the old one.
      const path = ticketPath(root, 'idea', t.id, t.slug)
      writeFileSync(path, readFileSync(path, 'utf8').replace(/^status: idea$/m, 'status: doing'))

      const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const index = new BoardIndex(root, () => config)
        index.rebuild()

        expect(warn).toHaveBeenCalledTimes(1)
        expect(String(warn.mock.calls[0]![0])).toContain(`ticket ${t.id}`)
        // Index and disk both reflect the folder truth.
        expect(index.get(t.id)?.status).toBe('idea')
        expect(readTicket(root, config, t.id).status).toBe('idea')

        // Loop guard: the rebuild the repair write would trigger via the
        // watcher repairs nothing — no warning, byte-identical file.
        const bytes = readFileSync(path, 'utf8')
        index.rebuild()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(readFileSync(path, 'utf8')).toBe(bytes)
      } finally {
        warn.mockRestore()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('warns about malformed build stages without dropping or rejecting the ticket', () => {
    const { root, config } = makeFullFixtureBoard('lfad-index-')
    try {
      const t = createTicket(root, config, { title: 'Staged', category: 'logic' })
      const path = ticketPath(root, 'idea', t.id, t.slug)
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        /\n---\n/,
        '\nbuildStages:\n  total: 1\n  current: 2\n  items:\n    - { title: Core, status: bogus }\n---\n',
      ))

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const index = new BoardIndex(root, () => config)
        index.rebuild()

        expect(index.get(t.id)?.extras?.buildStages).toBeDefined()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`ticket ${t.id}: malformed extras.buildStages`))
        expect(warn.mock.calls.some(([message]) => String(message).includes('items.0.key'))).toBe(true)
        expect(warn.mock.calls.some(([message]) => String(message).includes('items.0.status'))).toBe(true)
        expect(warn.mock.calls.some(([message]) => String(message).includes('current'))).toBe(true)
      } finally {
        warn.mockRestore()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is a no-op on a healthy board', () => {
    const { root, config } = makeFullFixtureBoard('lfad-index-')
    try {
      const t = createTicket(root, config, { title: 'Healthy', category: 'logic' })
      moveTicket(root, config, t.id, 'plan')
      const path = ticketPath(root, 'plan', t.id, t.slug)
      const bytes = readFileSync(path, 'utf8')

      const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const index = new BoardIndex(root, () => config)
        index.rebuild()
        expect(warn).not.toHaveBeenCalled()
        expect(readFileSync(path, 'utf8')).toBe(bytes)
        expect(index.get(t.id)?.status).toBe('plan')
      } finally {
        warn.mockRestore()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
