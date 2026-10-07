#!/usr/bin/env node
/**
 * One-command agent dashboard demo orchestrator (run via `pnpm demo`).
 *
 * In order:
 *   1. build the UI            (pnpm -C packages/ui build      -> packages/ui/dist)
 *   2. build the runtime       (pnpm -C packages/runtime build -> packages/runtime/dist)
 *   3. seed a fresh demo board (flow seed .demo-flow — wipes + recreates it)
 *   4. start the daemon serving that board + the built UI on port 4319
 *
 * Paths are resolved absolutely from this file's location so the script works
 * regardless of the caller's cwd.
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = resolve(root, 'packages/runtime/dist/cli.js')
// The demo board is a throwaway sandbox INSIDE the tool folder (gitignored),
// so `pnpm demo` works identically wherever the tool lives — the standalone
// dev repo or a per-project install like <project>/.agent-dashboard/.lfad.
const boardRoot = resolve(root, '.demo-flow')
const PORT = '4319'

/** Run a command to completion, inheriting stdio; exit on failure. */
function run(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (res.error) {
    console.error(`demo: failed to run \`${cmd} ${args.join(' ')}\`: ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

// 1 — build core first (the runtime bundles its dist), then the UI + runtime.
run('pnpm', ['-C', 'packages/core', 'build'])
run('pnpm', ['-C', 'packages/ui', 'build'])
run('pnpm', ['-C', 'packages/runtime', 'build'])

// 3 — seed a fresh demo board.
run(process.execPath, [cli, 'seed', boardRoot, '--force'])

// 4 — serve on port 4319 (the CLI prints the URL). No --ui: the daemon copies
// the tool's built UI into `<board>/.ui` (gitignored) and serves from there.
const serve = spawn(process.execPath, [cli, 'serve', boardRoot, '--port', PORT], {
  cwd: root,
  stdio: 'inherit',
})
serve.on('exit', (code) => process.exit(code ?? 0))
const forward = (signal) => () => serve.kill(signal)
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
