import type { CommandPrefix } from './api'
import { DEFAULT_SKILL_PREFIX, pluginCommand } from './commands'

export interface PromptTemplates {
  runAll: string
}

export interface PromptPreset {
  key: 'workflow' | 'continuous'
  label: string
  description: string
  template: string
}

const WORKFLOW_TEMPLATE = 'Use a workflow to run parallel actions on exactly the tickets Run (N) has computed as advanceable now: {ids}. '
  + 'That list is authoritative — it already EXCLUDES tickets blocked on a user action, manual tickets, tickets with pending manual tasks, and dependency-held tickets. '
  + 'Process ONLY these ids; do not re-scan the board for more, and never batch-advance a manual ticket (a manual ticket moves only when you name its id directly). '
  + 'Run {command} <id> for each one in its own parallel lane, and stop each ticket at its next human gate. '
  + 'A ticket resting at `done` is not finished — run {command} <id> on it too so it carries onward `done -> doc -> _archive`, where the doc step writes a targeted doc for feature-level work or archives a small UI/copy fix directly. Archiving a locally-committed but unpushed ticket is expected.'

const CONTINUOUS_TEMPLATE = 'Use {loop} to keep running this pass: each round, advance only the tickets that are advanceable now — '
  + 'not blocked on a user action AND not manual, not pending-manual-task, not dependency-held (the same rule Run (N) uses to compute {ids}, which is this round\'s snapshot: {ids}). '
  + 'Never batch-advance a manual ticket — it moves only when its id is named explicitly. '
  + 'Run {command} <id> for each in its own parallel lane, stopping at its next human gate. Repeat until every ticket is blocked on a human. '
  + 'Each round, also carry any ticket resting at `done` onward `done -> doc -> _archive` by running {command} <id> on it — the doc step writes a targeted doc for feature-level work or archives a small fix directly.'

export const PROMPT_PRESETS: readonly PromptPreset[] = [
  {
    key: 'workflow',
    label: 'One-time (workflow)',
    description: 'Runs a single parallel pass · default',
    template: WORKFLOW_TEMPLATE,
  },
  {
    key: 'continuous',
    label: 'Continuous (/loop)',
    description: 'Keeps re-running until all blocked',
    template: CONTINUOUS_TEMPLATE,
  },
]

export const DEFAULT_PROMPT_TEMPLATES: PromptTemplates = { runAll: WORKFLOW_TEMPLATE }

/** The one required value is the live ticket list; other wording stays user-owned. */
export function validateRunAllTemplate(template: string): string | null {
  if (template.trim().length === 0) return 'The Run (N) prompt cannot be empty.'
  if (!template.includes('{ids}')) return 'Add {ids} back before saving.'
  return null
}

/** Renders every supported token at click time so ids and command prefix never go stale. */
export function renderRunAllPrompt(template: string, ids: number[], prefix: CommandPrefix, skillPrefix = DEFAULT_SKILL_PREFIX): string {
  const sortedIds = [...ids].sort((left, right) => left - right)
  return template
    .replaceAll('{ids}', sortedIds.map((id) => `#${id}`).join(', '))
    .replaceAll('{command}', pluginCommand('next', prefix, skillPrefix))
    .replaceAll('{loop}', `${prefix}loop`)
}
