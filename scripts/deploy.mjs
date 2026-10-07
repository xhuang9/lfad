#!/usr/bin/env node
/**
 * Build every lfad package, sync the three deployable dist trees into an
 * in-board install, then restart that board's daemon.
 *
 * Usage: pnpm run deploy -- --board <path> [--port <number>]
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const packages = [
  { name: 'core', markers: ['index.js'] },
  { name: 'runtime', markers: ['index.js', 'cli.js'] },
  { name: 'ui', markers: ['index.html'] },
]

function valueOf(flag) {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw new Error(`could not run \`${command} ${args.join(' ')}\`: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` failed (exit ${result.status ?? result.signal})`)
  }
}

function assertDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is missing: ${path}`)
  }
}

function prepareSync(install) {
  return packages.map(({ name, markers }) => {
    const source = resolve(root, 'packages', name, 'dist')
    const packageDir = resolve(install, 'packages', name)
    assertDirectory(source, `${name} build output`)
    for (const marker of markers) {
      if (!existsSync(resolve(source, marker))) {
        throw new Error(`${name} build marker is missing: ${resolve(source, marker)}`)
      }
    }
    assertDirectory(packageDir, `${name} install package`)
    return { name, source, packageDir }
  })
}

function syncDistTrees(entries) {
  const deploymentId = `${process.pid}-${Date.now()}`
  const states = entries.map((entry) => ({
    ...entry,
    target: resolve(entry.packageDir, 'dist'),
    stage: resolve(entry.packageDir, `.dist-deploy-${deploymentId}`),
    backup: resolve(entry.packageDir, `.dist-backup-${deploymentId}`),
    backedUp: false,
    swapped: false,
  }))

  try {
    for (const state of states) cpSync(state.source, state.stage, { recursive: true })

    for (const state of states) {
      if (existsSync(state.target)) {
        renameSync(state.target, state.backup)
        state.backedUp = true
      }
      renameSync(state.stage, state.target)
      state.swapped = true
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.swapped && existsSync(state.target)) rmSync(state.target, { recursive: true, force: true })
      if (state.backedUp && existsSync(state.backup)) renameSync(state.backup, state.target)
      rmSync(state.stage, { recursive: true, force: true })
    }
    throw error
  }

  for (const state of states) rmSync(state.backup, { recursive: true, force: true })
}

function listenerPids(port) {
  const result = spawnSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (result.error) throw new Error(`could not inspect port ${port}: ${result.error.message}`)
  if (result.status === 1) return []
  if (result.status !== 0) throw new Error(`lsof failed while inspecting port ${port}`)
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number)
}

async function daemonInfo(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/info`, { signal: AbortSignal.timeout(1_000) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function stopDaemon(board, port) {
  const info = await daemonInfo(port)
  const pids = listenerPids(port)
  if (pids.length === 0) return
  if (info === null) throw new Error(`port ${port} is occupied by a service that is not a reachable dashboard daemon`)
  if (resolve(info.boardRoot) !== board) {
    throw new Error(`port ${port} serves ${info.boardRoot}, not ${board}; refusing to stop it`)
  }

  for (const pid of pids) process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (listenerPids(port).length === 0) return
    await sleep(100)
  }
  throw new Error(`daemon on port ${port} did not stop within 10 seconds`)
}

async function startDaemon(board, install, port) {
  const cli = resolve(install, 'packages/runtime/dist/cli.js')
  const logDir = resolve(board, 'log')
  const logPath = resolve(logDir, 'daemon.log')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(logPath, 'a')
  const child = spawn(process.execPath, [cli, 'serve', board, '--port', String(port)], {
    cwd: install,
    detached: true,
    stdio: ['ignore', log, log],
  })
  child.unref()
  closeSync(log)

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const info = await daemonInfo(port)
    if (info !== null && resolve(info.boardRoot) === board) return { pid: child.pid, logPath }
    await sleep(200)
  }
  throw new Error(`daemon did not become healthy within 15 seconds; inspect ${logPath}`)
}

async function main() {
  if (argv.includes('--help')) {
    console.log('Usage: pnpm run deploy -- --board <path> [--port <number>]')
    return
  }

  const inBoard = ['.lfad', '.hitloop'].includes(basename(root))
  const board = resolve(valueOf('--board') ?? (process.env.LFAD_BOARD ?? process.env.HITLOOP_BOARD) ?? (inBoard ? resolve(root, '..') : resolve(root, '..', '.agent-dashboard')))
  // Installs from before the rename live in <board>/.hitloop.
  const install = existsSync(resolve(board, '.lfad')) ? resolve(board, '.lfad') : resolve(board, '.hitloop')
  assertDirectory(install, 'lfad install')

  try {
    process.loadEnvFile(resolve(install, '.env'))
  } catch {
    // The CLI also treats a missing install .env as a no-op.
  }
  const port = Number(valueOf('--port') ?? (process.env.LFAD_PORT ?? process.env.HITLOOP_PORT) ?? 4319)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid port: ${port}`)

  console.log(`lfad deploy — tool ${root}`)
  console.log(`                 board ${board}`)
  console.log(`                 install ${install}`)
  console.log('1/4 build       — pnpm -r build')
  run('pnpm', ['-r', 'build'])

  console.log('2/4 sync        — core + runtime + ui dist')
  const syncEntries = prepareSync(install)
  if (install === root) {
    console.log('                  install is the tool root; build outputs are already in place')
  } else {
    syncDistTrees(syncEntries)
  }

  console.log(`3/4 restart     — port ${port}`)
  await stopDaemon(board, port)
  const started = await startDaemon(board, install, port)

  console.log(`4/4 health      — ok (pid ${started.pid ?? 'unknown'})`)
  console.log(`                  log ${started.logPath}`)
}

main().catch((error) => {
  console.error(`deploy: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
