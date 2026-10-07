import { describe, expect, it } from 'vitest'

import { blockedInfo } from '../src/components/TicketDrawer/components/BlockedMode/blockedInfo'
import type { Artifact, QuestionInfo } from '../src/types'

const legacyReason = [
  '# Blocked',
  '',
  '**Question:** Keep the schema or add a column?',
  '',
  '## Options',
  '',
  '- Keep the schema',
  '- Add a column',
  '',
  '**Recommendation:** Add a column.',
  '',
  '**Decision:**',
].join('\n')

function question(open = true): QuestionInfo {
  return { file: 'blocked.md', open, decisionLine: 11 }
}

describe('blockedInfo', () => {
  it('derives an answerable escalation and enriches its legacy display fields', () => {
    const info = blockedInfo(
      { returnStep: 'review' },
      [{ name: 'blocked.md', content: legacyReason }],
      [question()],
    )

    expect(info).toEqual({
      hasReason: true,
      reason: legacyReason,
      returnStep: 'review',
      escalatedQuestion: {
        file: 'blocked.md',
        open: true,
        decisionLine: 11,
        ask: 'Keep the schema or add a column?',
        options: ['Keep the schema', 'Add a column'],
        type: 'option',
      },
    })
  })

  it('keeps an answered escalation available for its completion state', () => {
    const info = blockedInfo(
      { returnStep: 'doing' },
      [{ name: 'blocked.md', content: legacyReason.replace('**Decision:**', '**Decision:** Add a column ·2026-07-15') }],
      [question(false)],
    )

    expect(info.escalatedQuestion?.open).toBe(false)
    expect(info.returnStep).toBe('doing')
  })

  it('treats a legacy reason without a parsed Decision input as command-only', () => {
    const artifacts: Artifact[] = [{ name: 'blocked.md', content: '**Question:** What now?\n' }]
    const info = blockedInfo({ returnStep: 'todo' }, artifacts, [])

    expect(info.hasReason).toBe(true)
    expect(info.escalatedQuestion).toBeNull()
    expect(info.returnStep).toBe('todo')
  })

  it.each([
    ['missing artifact', []],
    ['empty artifact', [{ name: 'blocked.md', content: '  \n' }]],
  ])('degrades cleanly for %s and a missing returnStep', (_label, artifacts) => {
    const info = blockedInfo({}, artifacts as Artifact[], [])

    expect(info).toEqual({
      hasReason: false,
      reason: null,
      returnStep: null,
      escalatedQuestion: null,
    })
  })
})
