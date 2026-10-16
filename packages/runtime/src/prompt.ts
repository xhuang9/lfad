/**
 * Pure builder for the self-contained instruction handed to an execution agent.
 *
 * Per the SPEC, the ticket folder IS the briefing: the prompt inlines the
 * ticket's intent + every existing artifact, names the step being executed,
 * and embeds the governance rules (the B1–B5 escalation triggers from
 * roles-and-governance) plus the v1 text-sentinel protocol the
 * {@link import('./run-manager.js').RunManager} scans for. Step goal, artifact,
 * and driving skill all come from the board's {@link StepConfig} — the step
 * is per-board data, not code. No I/O — given the same inputs it returns the
 * same string, so it is trivially testable.
 */

import type { ResolvedWriting, Step, StepConfig, Ticket } from '@lfad/core'

import type { Artifact } from './artifacts.js'
import type { RunConfig } from './run-config.js'

/** Runtime context the {@link RunManager} threads into the prompt at spawn time. */
export interface PromptContext {
  /** The agent's working dir: the ticket's git worktree path, or null when none exists. */
  worktreePath?: string | null
  /** Absolute path to the ticket's folder on the board (where step artifacts live). */
  boardTicketDir?: string
  /**
   * An action skill (from the step's `actions` list) running IN PLACE of the
   * step's own skill — its rules own any ticket movement; the engine won't advance.
   */
  skillOverride?: string
  /** Installed plugin name used to resolve legacy/default skill bindings. */
  skillPrefix?: string
  /** Board-level `guidance` from board.yml, injected into every step prompt. */
  boardGuidance?: string
  /** The board's writing settings with plugin defaults filled in. */
  writing?: ResolvedWriting
  /** Absolute path of the board's project rules file, when board.yml sets `localRules`. */
  localRules?: string
}

/** Renders one artifact as a fenced section for the prompt. */
function renderArtifact(artifact: Artifact): string {
  return `### Artifact: ${artifact.name}\n\n${artifact.content.trim()}\n`
}

/**
 * Builds the full execution prompt for `step` of `ticket`.
 *
 * @param ticket - the ticket being executed.
 * @param artifacts - the ticket's existing artifacts (idea body, plan.md, …).
 * @param step - the step whose work the agent should do now.
 * @param stepConfig - the board's config for that step (goal/artifact/skill), if any.
 * @param cfg - the resolved run config (dry-run posture, code repo).
 * @param ctx - spawn-time context (worktree path, board ticket dir).
 */
export function buildStepPrompt(
  ticket: Ticket,
  artifacts: Artifact[],
  step: Step,
  stepConfig: StepConfig | undefined,
  cfg: RunConfig,
  ctx: PromptContext = {},
): string {
  // `artifact: 'body'` means the ticket body itself is this step's artifact —
  // there is no separate file to write (the Idea-edits-body special case).
  const bodyIsArtifact = stepConfig?.artifact === 'body'
  const artifactName = bodyIsArtifact ? undefined : stepConfig?.artifact
  const lines: string[] = []

  lines.push(`You are an autonomous execution agent working an agent-dashboard ticket through its lifecycle.`)
  lines.push(`Your current job is the **${step}** step for ticket #${ticket.id}.`)
  lines.push('')
  lines.push(`Step goal: ${stepConfig?.goal ?? `Complete the '${step}' step of this ticket.`}`)
  if (ctx.boardGuidance !== undefined) lines.push(`Board guidance: ${ctx.boardGuidance}`)
  if (stepConfig?.guidance !== undefined) lines.push(`Step guidance: ${stepConfig.guidance}`)
  if (ctx.writing !== undefined) {
    lines.push(`Writing: files a person reads in ${ctx.writing.humanLanguage}; files an agent reads in ${ctx.writing.agentLanguage}.`)
  }
  if (ctx.localRules !== undefined) {
    lines.push(`Project rules: read ${ctx.localRules} after the plugin's rules. Where they conflict, the project rules win.`)
  }
  const configuredSkill = ctx.skillOverride ?? stepConfig?.skill
  const actionSkill = ctx.skillPrefix !== undefined
    ? configuredSkill?.replace(/^(?:flow|lfad):/, () => `${ctx.skillPrefix}:`)
    : configuredSkill
  if (actionSkill !== undefined) {
    lines.push(`Invoke the Skill "${actionSkill}" for the full step playbook before working.`)
  }
  if (ctx.skillOverride !== undefined) {
    lines.push(`This run executes the "${actionSkill}" action on the ticket where it stands: that skill's own rules decide if and where the ticket moves — the engine will not advance it for you.`)
  }
  lines.push('')

  lines.push(`## Ticket #${ticket.id} — ${ticket.title}`)
  lines.push(`- category: ${ticket.category}`)
  if (ticket.tags.length > 0) lines.push(`- tags: ${ticket.tags.join(', ')}`)
  if (ticket.needsDesign !== undefined) lines.push(`- needsDesign: ${ticket.needsDesign}`)
  lines.push('')

  if (artifacts.length > 0) {
    lines.push(`## Briefing — read these; the ticket folder is your full context`)
    lines.push('')
    for (const artifact of artifacts) lines.push(renderArtifact(artifact))
  }

  lines.push(`## Where things live`)
  if (ctx.boardTicketDir !== undefined) {
    lines.push(`- Board ticket folder (write your step artifact here): ${ctx.boardTicketDir}`)
  }
  if (artifactName !== undefined && ctx.boardTicketDir !== undefined) {
    lines.push(`- Write this step's artifact to: ${ctx.boardTicketDir}/${artifactName}`)
  } else if (artifactName !== undefined) {
    lines.push(`- This step's artifact filename: ${artifactName}`)
  }
  if (bodyIsArtifact) {
    lines.push(`- This step's artifact is the ticket body itself: refine the body of ticket.md (never its frontmatter).`)
  }
  if (ctx.worktreePath != null) {
    lines.push(`- Code worktree (make all code edits here, never in the board): ${ctx.worktreePath}`)
  } else if (cfg.codeRepo !== undefined) {
    lines.push(`- Code repo: ${cfg.codeRepo} (no isolated worktree for this step)`)
  } else {
    lines.push(`- No code repo is configured — this is a documentation/planning step only.`)
  }
  lines.push('')

  lines.push(`## Rules`)
  lines.push(`- Do the approved work for THIS step only. Read the briefing above; do not invent scope.`)
  lines.push(`- Escalate to the user (emit FLOW_BLOCK, see below) the moment any of these is true:`)
  lines.push(`  - B1: the work can't be aligned with the plan the user approved (reality diverges).`)
  lines.push(`  - B2: the change touches a core business function AND affects the user experience.`)
  lines.push(`  - B3: the work would diverge from the project's set strategy (only if a strategy is set).`)
  lines.push(`  - B4: a step needs an action you can't perform (credentials, access, a manual external step).`)
  lines.push(`  - B5: your own judgement that the user would want to weigh in. On a coin-flip, escalate.`)
  lines.push(`- You never sign off your own work past a human gate — that is the user's call.`)
  if (cfg.dryRun) {
    lines.push(`- DRY-RUN IS ON: you may plan and write your step artifact, but DO NOT commit any code.`)
  } else {
    lines.push(`- You may commit code inside the worktree; never touch the board's git.`)
  }
  lines.push('')

  lines.push(`## Signalling protocol (v1 — text sentinels on their own line)`)
  lines.push(`- When you need a human decision, print exactly: FLOW_BLOCK: <your one-line question>`)
  lines.push(`- When the step is fully complete, print exactly: FLOW_DONE`)
  if (artifactName !== undefined) {
    lines.push(`- Before printing FLOW_DONE, write your step artifact (${artifactName}).`)
  }
  lines.push(`- The daemon scans your output for these lines. (A real MCP flow_block tool replaces this on the SDK path.)`)

  return `${lines.join('\n').trimEnd()}\n`
}
