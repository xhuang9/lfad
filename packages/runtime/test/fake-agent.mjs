#!/usr/bin/env node
/**
 * Fake execution agent for the run-engine tests — NEVER spawns real `claude`,
 * never spends tokens. Wired into fixture boards as a board.yml adapter
 * (`cmd: node, args: [<this file>, "{prompt}", ...]`).
 *
 * It emits claude-shaped `stream-json` events AND plain sentinel lines, so the
 * same script drives fixtures in either adapter output mode: `stream-json`
 * scanning reads the sentinel from the assistant event's text; `text` scanning
 * reads it from the plain line (the JSON event lines never match the
 * line-anchored sentinel regexes).
 *
 * Behaviour is driven by markers in the prompt (argv), so tests stay
 * deterministic without mutating global process.env:
 *   - "FAKE_BLOCK_TRIGGER"   → signals `FLOW_BLOCK: <question>`.
 *   - "FAKE_SLEEP"           → waits ~300ms before finishing.
 *   - "FAKE_TOOLRESULT_TRAP" → first replays a tool_result event whose payload
 *     quotes the sentinel docs (a skill file read back through the stream) —
 *     the scanner must NOT block on it — then finishes normally.
 *   - "FAKE_MIDLINE_TRAP"    → first emits assistant text that MENTIONS the
 *     block sentinel mid-line (docs prose) — anchoring must ignore it — then
 *     finishes normally.
 *   - "FAKE_SPAWN_GRANDCHILD" → spawns a long-sleeping grandchild in this
 *     process' group, prints its pid as `FAKE_GRANDCHILD_PID: <pid>`, then
 *     hangs forever (never signals FLOW_DONE). The run must be stopped, and the
 *     grandchild must die with the group.
 *   - otherwise → writes a tiny artifact into cwd then signals `FLOW_DONE`.
 *
 * It also always prints `FAKE_ARGV_B64: <base64 argv JSON>` so tests can
 * assert on adapter resolution / placeholder substitution. Base64 keeps the
 * prompt text (which QUOTES the sentinel protocol) from tripping text-mode
 * scanning.
 */

import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const argv = args.join('\n')

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

/** Claude-shaped assistant text event. */
function say(text) {
  emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
}

/** Signal a sentinel in BOTH modes: assistant event + plain line. */
function signal(sentinelLine) {
  say(sentinelLine)
  process.stdout.write(`${sentinelLine}\n`)
}

function finish() {
  process.stdout.write(`FAKE_ARGV_B64: ${Buffer.from(JSON.stringify(args)).toString('base64')}\n`)
  emit({ type: 'system', subtype: 'init', session_id: 'fake-session' })
  say('fake agent working on the step')

  if (argv.includes('FAKE_TOOLRESULT_TRAP')) {
    // A skill file read via a tool flows back verbatim through the stream —
    // its docs quote the sentinel syntax. Must never trip the scanner.
    emit({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          content: [{ type: 'text', text: 'escalate via the blocked mechanics (`FLOW_BLOCK: <one-line question>`); then print\nFLOW_BLOCK: docs example question\nand stop.' }],
        }],
      },
    })
  }

  if (argv.includes('FAKE_MIDLINE_TRAP')) {
    // Docs prose mentioning the sentinel mid-line — anchoring must ignore it.
    say('the protocol says print FLOW_BLOCK: <question> on its own line when stuck')
  }

  if (argv.includes('FAKE_BLOCK_TRIGGER')) {
    signal('FLOW_BLOCK: which option do you want?')
    process.exit(0)
  }

  // Simulate the agent doing work: drop a marker file in its working dir.
  try {
    writeFileSync(join(process.cwd(), 'fake-agent-ran.txt'), 'ran\n')
  } catch {
    // working dir not writable — irrelevant to the sentinel contract.
  }
  emit({ type: 'result', subtype: 'success', is_error: false })
  signal('FLOW_DONE')
  process.exit(0)
}

/**
 * Spawn a long-sleeping grandchild that inherits THIS process' group (no
 * `detached`), announce its pid, then hang forever. Killing the run's process
 * group must take the grandchild down too.
 */
function spawnGrandchildAndHang() {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
    stdio: 'ignore',
  })
  grandchild.unref()
  process.stdout.write(`FAKE_GRANDCHILD_PID: ${grandchild.pid}\n`)
  setInterval(() => {}, 1 << 30)
}

if (argv.includes('FAKE_SPAWN_GRANDCHILD')) spawnGrandchildAndHang()
else if (argv.includes('FAKE_SLEEP')) setTimeout(finish, 300)
else finish()
