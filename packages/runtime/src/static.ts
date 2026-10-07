/**
 * Static-file serving for the built UI. Serves files out of `uiDir` and falls
 * back to `index.html` for SPA client routes. Unknown `/api/*` paths return a
 * JSON 404 rather than the SPA shell. When no UI is built yet, a small
 * placeholder page keeps the daemon usable.
 */

import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

import type { Context } from 'hono'

/** Maps a file extension to a Content-Type for the handful of types a built UI emits. */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/** Shown at `/` when `uiDir` is missing or holds no `index.html`. */
const PLACEHOLDER = `<!doctype html><html><head><meta charset="utf-8"><title>Agent Dashboard</title></head>`
  + `<body style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem">`
  + `<h1>Agent dashboard daemon is running</h1>`
  + `<p>The API is live under <code>/api</code>. No built UI was found &mdash; `
  + `start the daemon with <code>--ui &lt;dir&gt;</code> pointing at a built web app.</p>`
  + `</body></html>`

/** Reads a file as a Buffer, returning `undefined` for missing paths or directories. */
async function tryReadFile(path: string): Promise<Buffer | undefined> {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return undefined
    return await readFile(path)
  } catch {
    return undefined
  }
}

/**
 * Creates the catch-all GET handler. Resolution order:
 *   1. `/api/*` that reached here is unknown → JSON 404.
 *   2. An existing file under `uiDir` → served with its MIME type.
 *   3. Otherwise → `uiDir/index.html` (SPA fallback), or the placeholder.
 */
export function createStaticHandler(uiDir?: string) {
  const root = uiDir === undefined ? undefined : resolve(uiDir)

  return async (c: Context): Promise<Response> => {
    const path = c.req.path
    if (path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404)
    if (root === undefined) return c.html(PLACEHOLDER)

    const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '')
    const full = resolve(join(root, relative))
    if (full === root || full.startsWith(`${root}/`)) {
      const file = await tryReadFile(full)
      if (file !== undefined) {
        const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream'
        return c.body(new Uint8Array(file), 200, { 'content-type': type })
      }
    }

    const indexHtml = await tryReadFile(join(root, 'index.html'))
    if (indexHtml !== undefined) return c.html(indexHtml.toString('utf8'))
    return c.html(PLACEHOLDER)
  }
}
