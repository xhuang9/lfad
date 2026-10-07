import type { Artifact, QuestionInfo, Ticket } from '../../../../types'

export const BLOCKED_ARTIFACT = 'blocked.md'
export const BLOCKED_SECTION_SLUG = 'blocked'

export interface BlockedInfo {
  hasReason: boolean
  reason: string | null
  returnStep: string | null
  /** The runtime question, enriched only for display with legacy ask/options. */
  escalatedQuestion: QuestionInfo | null
}

function legacyAsk(content: string): string | undefined {
  return /^\*\*Question:\*\*\s*(.+?)\s*$/im.exec(content)?.[1]
}

function legacyOptions(content: string): string[] {
  const lines = content.split('\n')
  const heading = lines.findIndex((line) => /^##\s+Options\s*$/i.test(line.trim()))
  if (heading < 0) return []
  const options: string[] = []
  for (const line of lines.slice(heading + 1)) {
    if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+:\*\*/.test(line)) break
    const match = /^\s*[-*]\s+(.+?)\s*$/.exec(line)
    if (match !== null) options.push(match[1])
  }
  return options
}

/** Derives every blocked-panel state without depending on React or the DOM. */
export function blockedInfo(
  ticket: Pick<Ticket, 'returnStep'>,
  artifacts: Artifact[],
  questions: QuestionInfo[],
): BlockedInfo {
  const artifact = artifacts.find((item) => item.name.toLowerCase() === BLOCKED_ARTIFACT)
  const reason = artifact?.content.trim() ? artifact.content : null
  const question = questions.find((item) => item.file.toLowerCase() === BLOCKED_ARTIFACT)

  if (question === undefined) {
    return {
      hasReason: reason !== null,
      reason,
      returnStep: ticket.returnStep ?? null,
      escalatedQuestion: null,
    }
  }

  const options = question.options?.length ? question.options : legacyOptions(artifact?.content ?? '')
  const ask = question.ask ?? legacyAsk(artifact?.content ?? '')
  return {
    hasReason: reason !== null,
    reason,
    returnStep: ticket.returnStep ?? null,
    escalatedQuestion: {
      ...question,
      ...(ask !== undefined ? { ask } : {}),
      ...(options.length > 0 ? { options, type: question.type ?? 'option' } : {}),
    },
  }
}
