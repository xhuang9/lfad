/**
 * Pure helper turning a board-configured {@link AgentAdapter} plus a step
 * prompt into the exact `spawn(cmd, args)` invocation. Placeholders are
 * substituted per args token (no shell, no re-splitting): {prompt} {model}
 * {effort} {ticketId} {step} {boardRoot} ({stage} is a deprecated alias of
 * {step} for boards written before the rename). `workflow: true` prepends the
 * word `ultracode` to the prompt text (the multi-agent orchestration opt-in).
 */

import type { AdapterOutput, AgentAdapter } from '@lfad/core'

/** Spawn-time values substituted into an adapter's args template. */
export interface AdapterRunContext {
  ticketId: number
  step: string
  boardRoot: string
  /** The installed tool's flow plugin folder ('' when unresolvable). */
  pluginDir: string
}

/** The fully-substituted invocation: what to spawn, with what argv. */
export interface AdapterInvocation {
  cmd: string
  args: string[]
  /** The final prompt text (post `workflow` injection) that filled {prompt}. */
  prompt: string
}

/** Placeholder pattern; unknown `{...}` tokens are left untouched. */
const PLACEHOLDER = /\{(prompt|model|effort|ticketId|step|stage|boardRoot|pluginDir)\}/g

/**
 * Builds the spawn invocation for one run: applies the `workflow` prompt
 * injection, then substitutes every placeholder occurrence inside each args
 * token. Adapter `model`/`effort` left unset substitute as empty strings.
 */
export function buildAdapterInvocation(
  adapter: AgentAdapter,
  prompt: string,
  ctx: AdapterRunContext,
): AdapterInvocation {
  const finalPrompt = adapter.workflow === true ? `ultracode\n\n${prompt}` : prompt
  const values: Record<string, string> = {
    prompt: finalPrompt,
    model: adapter.model ?? '',
    effort: adapter.effort ?? '',
    ticketId: String(ctx.ticketId),
    step: ctx.step,
    stage: ctx.step, // deprecated alias, kept for pre-rename adapter templates
    boardRoot: ctx.boardRoot,
    pluginDir: ctx.pluginDir,
  }
  const substituted = adapter.args.map((token) => token.replace(PLACEHOLDER, (_, key: string) => values[key]!))
  // A token that resolved to the empty string is dropped — and when it was the
  // value of a `--flag`, the flag goes with it. Optional values (model, effort,
  // pluginDir) thus disappear cleanly instead of spawning as empty argv entries.
  const args: string[] = []
  for (const token of substituted) {
    if (token === '') {
      if (args.length > 0 && args[args.length - 1]!.startsWith('--')) args.pop()
      continue
    }
    args.push(token)
  }
  return { cmd: adapter.cmd, args, prompt: finalPrompt }
}

/**
 * Extracts the agent's OWN text from one stdout line, for sentinel scanning.
 *
 * `text` mode: every raw line IS agent output. `stream-json` mode: only the
 * assistant's message text (and the final `result` string) count — tool
 * results and other event payloads can quote the sentinel docs (e.g. a skill
 * file the agent read flows back through the stream verbatim) and must never
 * trip the FLOW_BLOCK / FLOW_DONE scanner.
 */
export function extractAgentTexts(rawLine: string, output: AdapterOutput): string[] {
  if (output === 'text') return [rawLine]
  let event: unknown
  try {
    event = JSON.parse(rawLine)
  } catch {
    return []
  }
  if (typeof event !== 'object' || event === null) return []
  const e = event as { type?: unknown, result?: unknown, message?: { content?: unknown } }
  if (e.type === 'result') return typeof e.result === 'string' ? [e.result] : []
  if (e.type !== 'assistant') return []
  const content = e.message?.content
  if (!Array.isArray(content)) return []
  return content
    .filter((block): block is { type: 'text', text: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map((block) => block.text)
}
