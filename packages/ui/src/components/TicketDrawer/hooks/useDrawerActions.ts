// Everything behind the drawer's action cluster: the copy-command skill
// buttons (the ticketActions derivation). Buttons copy commands to the
// clipboard — the operator pastes them into their own Claude Code session;
// the UI never starts runs.

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { getCommandPrefixSnapshot, getSkillPrefixSnapshot, subscribeCommandPrefix, subscribeSkillPrefix } from '../../../api'
import { pluginCommand, resolveSkillKey } from '../../../commands'
import type { Step, StepPayload, Ticket } from '../../../types'
import { useCopied } from '../../../useCopied'

/**
 * The skills that can process a ticket at its current step — the drawer's
 * copy-command buttons. The step's `actions` list from board.yml wins when
 * present; without one, the default pair applies: the step's own skill (unless
 * it's an entry step — creation already happened there), then the next step's
 * skill (the pull forward; a queue next-step never runs).
 */
function ticketActions(status: Step, steps: StepPayload[]): string[] {
  const idx = steps.findIndex((s) => s.key === status)
  if (idx < 0) return []
  const cur = steps[idx]
  if (cur.lateral) return []
  if (cur.actions !== undefined) return cur.actions
  const out: string[] = []
  if (cur.skill !== undefined && !cur.entry) out.push(cur.skill)
  const next = steps.slice(idx + 1).find((s) => !s.lateral)
  if (next?.skill !== undefined && next.type !== 'queue' && !out.includes(next.skill)) {
    out.push(next.skill)
  }
  return out
}

/** Which Prompt button was just used — `file` targets the active artifact, `ticket` the whole ticket. */
export type PromptScope = 'file' | 'ticket'

export interface DrawerActionsState {
  commandPrefix: '/' | '$'
  skillPrefix: string
  /** Skills that can process the ticket here — button and ⌃1…⌃9 order. */
  actions: string[]
  /** Skill whose command was just copied (feedback window), else null. */
  copiedSkill: string | null
  /** Copies `/<skill> <id>` to the clipboard. */
  copyCommand: (skill: string) => void
  /** Which Prompt button's command was just copied (feedback window), else null. */
  copiedPrompt: PromptScope | null
  /** Copies a `/flow:prompt <id>` stub — file-scoped when a name is given, else whole-ticket. */
  copyPrompt: (fileName: string | null) => void
}

export function useDrawerActions(ticket: Ticket | undefined, steps: StepPayload[]): DrawerActionsState {
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const skillPrefix = useSyncExternalStore(subscribeSkillPrefix, getSkillPrefixSnapshot)
  // The skill buttons for this ticket's position (⌃1…⌃9 shortcuts).
  const actions = useMemo(
    () => (ticket ? ticketActions(ticket.status, steps).map((skill) => resolveSkillKey(skill, skillPrefix)) : []),
    [ticket, steps, skillPrefix],
  )

  const cmdCopy = useCopied()
  const [copiedSkill, setCopiedSkill] = useState<string | null>(null)
  const ticketId = ticket?.id
  const { copy: writeCommand } = cmdCopy
  const copyCommand = useCallback(
    (skill: string) => {
      if (ticketId === undefined) return
      writeCommand(`${commandPrefix}${resolveSkillKey(skill, skillPrefix)} ${ticketId}`)
      setCopiedSkill(skill)
    },
    [commandPrefix, skillPrefix, writeCommand, ticketId],
  )

  // The Prompt File / Prompt Ticket pair — a separate copy-feedback window from
  // the skill buttons so the two never cross-talk. `flow:prompt`'s core is
  // untouched: the file target rides its existing inline prose convention, and
  // the copied string is a paste-ready stub (trailing space awaits the human's
  // instruction). A null name means "the whole ticket".
  const promptCopy = useCopied()
  const [copiedPrompt, setCopiedPrompt] = useState<PromptScope | null>(null)
  const { copy: writePrompt } = promptCopy
  const copyPrompt = useCallback(
    (fileName: string | null) => {
      if (ticketId === undefined) return
      const command = pluginCommand('prompt', commandPrefix, skillPrefix)
      writePrompt(fileName === null ? `${command} ${ticketId} ` : `${command} ${ticketId} in ${fileName}: `)
      setCopiedPrompt(fileName === null ? 'ticket' : 'file')
    },
    [commandPrefix, skillPrefix, writePrompt, ticketId],
  )

  return {
    commandPrefix,
    skillPrefix,
    actions,
    copiedSkill: cmdCopy.copied ? copiedSkill : null,
    copyCommand,
    copiedPrompt: promptCopy.copied ? copiedPrompt : null,
    copyPrompt,
  }
}
