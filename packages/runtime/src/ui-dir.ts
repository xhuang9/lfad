/**
 * Resolving where the daemon serves the UI from.
 *
 * The UI lives INSIDE the board at `<board>/.ui` (gitignored), so a project's
 * `.flow` folder is self-contained at runtime. On serve, the tool's built UI
 * (`packages/ui/dist`) is copied there; `.ui/` and `log/` are added to the
 * board's `.gitignore` so build artifacts and transcripts never enter the
 * board's git history. An explicit `LFAD_UI_DIR` / `--ui` overrides all this.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The board paths kept out of git (build artifact + run transcripts). */
const BOARD_IGNORES = ['.ui/', 'log/', '.lfad/', '.hitloop/']

/** Walks up from `fromDir` to find the tool's built UI (`packages/ui/dist`). */
export function findToolUiDist(fromDir: string): string | null {
  let dir = fromDir
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, 'packages/ui/dist')
    if (existsSync(resolve(candidate, 'index.html'))) return candidate
    dir = resolve(dir, '..')
  }
  return null
}

/** Convenience: the tool UI relative to THIS module (the bundled runtime). */
export function toolUiDistFromHere(): string | null {
  return findToolUiDist(dirname(fileURLToPath(import.meta.url)))
}

/** Ensures `<board>/.gitignore` ignores the runtime artifacts (`.ui/`, `log/`). */
export function ensureBoardGitignore(boardRoot: string): void {
  const file = resolve(boardRoot, '.gitignore')
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
  const present = new Set(lines.map((l) => l.trim()))
  const missing = BOARD_IGNORES.filter((entry) => !present.has(entry))
  if (missing.length === 0) return
  const body = [...lines.filter((l) => l.trim() !== ''), ...missing].join('\n')
  writeFileSync(file, `${body}\n`)
}

/**
 * Resolves the directory to static-serve the UI from.
 * - `override` (LFAD_UI_DIR / --ui) wins and is used as-is.
 * - otherwise the UI is the board's own `<board>/.ui`: the tool's built UI is
 *   copied in (refreshed each serve) and the board `.gitignore` is ensured.
 *   Returns `undefined` if no UI is available (daemon serves a placeholder).
 */
export function resolveUiDir(boardRoot: string, override: string | undefined, toolUiDist: string | null): string | undefined {
  if (override) return override
  ensureBoardGitignore(boardRoot)
  const boardUi = resolve(boardRoot, '.ui')
  if (toolUiDist && existsSync(resolve(toolUiDist, 'index.html'))) {
    cpSync(toolUiDist, boardUi, { recursive: true })
    return boardUi
  }
  return existsSync(resolve(boardUi, 'index.html')) ? boardUi : undefined
}
