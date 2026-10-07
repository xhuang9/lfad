/**
 * Grammar matrix for question-block parsing (doc-52): fenced question blocks
 * with a `**Decision:**` line, bare-Decision compat lines, malformed-YAML
 * degradation, out-of-reach fences, context extraction, and open-input counts.
 */

import { describe, expect, it } from 'vitest'

import { countOpenInputs, parseQuestions, parseTicketQuestions } from '../src/questions.js'

/** Joins lines with \n (tests reference 0-based line indices in these arrays). */
function doc(...lines: string[]): string {
  return lines.join('\n')
}

describe('parseQuestions — fenced question blocks', () => {
  const fenced = doc(
    'Intro paragraph about the choice.', // 0
    '', // 1
    '```question', // 2
    'id: D1', // 3
    'ask: Which storage engine?', // 4
    'type: choice', // 5
    'options:', // 6
    '  - sqlite', // 7
    '  - postgres', // 8
    '```', // 9
    '', // 10
    '**Decision:**', // 11
  )

  it('parses an OPEN fenced question, normalizing the legacy `choice` type to `option`', () => {
    const questions = parseQuestions('plan/01-storage.md', fenced)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toEqual({
      file: 'plan/01-storage.md',
      id: 'D1',
      ask: 'Which storage engine?',
      type: 'option', // `choice` normalizes to the canonical `option`
      options: ['sqlite', 'postgres'],
      context: 'Intro paragraph about the choice.',
      open: true,
      decisionLine: 11,
    })
  })

  it('an answered Decision line (text after the colon) closes the question', () => {
    const answered = fenced.replace('**Decision:**', '**Decision:** postgres ·2026-07-07')
    const questions = parseQuestions('plan/01-storage.md', answered)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.open).toBe(false)
    expect(questions[0]!.id).toBe('D1')
  })

  it('whitespace after the colon still counts as OPEN', () => {
    const spaced = fenced.replace('**Decision:**', '**Decision:**   ')
    expect(parseQuestions('a.md', spaced)[0]!.open).toBe(true)
  })

  it('malformed YAML degrades to a bare-Decision question (no structured fields)', () => {
    const malformed = doc(
      '```question',
      'id: [unclosed',
      '```',
      '**Decision:**',
    )
    const questions = parseQuestions('a.md', malformed)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ file: 'a.md', open: true, decisionLine: 3 })
    expect(questions[0]!.id).toBeUndefined()
    expect(questions[0]!.ask).toBeUndefined()
    expect(questions[0]!.type).toBeUndefined()
    expect(questions[0]!.options).toBeUndefined()
  })

  it('a question fence with NO following Decision line is not an input', () => {
    const noDecision = doc(
      '```question',
      'id: D9',
      'type: text',
      '```',
      '',
      'Just prose after the fence, no decision slot at all.',
    )
    expect(parseQuestions('a.md', noDecision)).toEqual([])
  })

  it('a Decision line beyond reach detaches from the fence (bare input, no structured fields)', () => {
    const farDecision = doc(
      '```question', // 0
      'id: D9', // 1
      'type: text', // 2
      '```', // 3
      'one', // 4
      'two', // 5
      'three', // 6
      '**Decision:**', // 7 — 4th non-blank line after the fence: out of reach
    )
    const questions = parseQuestions('a.md', farDecision)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ open: true, decisionLine: 7 })
    expect(questions[0]!.id).toBeUndefined() // the fence did not attach
  })

  it('the Decision line may sit a couple of non-blank lines after the fence', () => {
    const gap = doc(
      '```question', // 0
      'id: D2', // 1
      'type: confirm', // 2
      '```', // 3
      '', // 4
      'Pick carefully.', // 5
      '', // 6
      '**Decision:** yes ·2026-07-01', // 7
    )
    const questions = parseQuestions('a.md', gap)
    expect(questions).toHaveLength(1)
    // `confirm` normalizes to the canonical `approve`.
    expect(questions[0]).toMatchObject({ id: 'D2', type: 'approve', open: false, decisionLine: 7 })
  })

  it('an unrecognised type is dropped, keeping the rest of the fields', () => {
    const oddType = doc(
      '```question',
      'id: D3',
      'type: slider',
      'ask: How much?',
      '```',
      '**Decision:**',
    )
    const [q] = parseQuestions('a.md', oddType)
    expect(q!.type).toBeUndefined()
    expect(q!.id).toBe('D3')
    expect(q!.ask).toBe('How much?')
  })
})

describe('parseQuestions — answer shapes + comment round-trip', () => {
  it('parses the canonical option / multi / approve types', () => {
    const option = parseQuestions('a.md', doc('```question', 'type: option', 'options: [x, y]', '```', '**Decision:**'))
    expect(option[0]).toMatchObject({ type: 'option', options: ['x', 'y'] })

    const multi = parseQuestions('a.md', doc('```question', 'type: multi', 'options: [x, y]', '```', '**Decision:**'))
    expect(multi[0]).toMatchObject({ type: 'multi', options: ['x', 'y'] })

    const approve = parseQuestions('a.md', doc('```question', 'type: approve', '```', '**Decision:**'))
    expect(approve[0]).toMatchObject({ type: 'approve' })
    expect(approve[0]!.single).toBeUndefined()
  })

  it('carries `single: true` on an approve question (single-button sign-off)', () => {
    const [q] = parseQuestions('a.md', doc('```question', 'type: approve', 'single: true', '```', '**Decision:**'))
    expect(q).toMatchObject({ type: 'approve', single: true })
  })

  it('a multi answer with a `>` comment block reads as answered, and the comment adds no questions', () => {
    // Exactly the bytes the input-mode write-back produces: answer on the
    // Decision line, comment as `>` blockquote lines beneath it.
    const content = doc(
      '```question', // 0
      'id: D1', // 1
      'type: multi', // 2
      'options: [a, b]', // 3
      '```', // 4
      '**Decision:** a, b ·2026-07-08', // 5
      '> keep it simple', // 6
      '> revisit later', // 7
      '', // 8
      '```question', // 9
      'id: D2', // 10
      'type: text', // 11
      '```', // 12
      '**Decision:**', // 13
    )
    const questions = parseQuestions('plan.md', content)
    // The two `>` comment lines must NOT parse as their own questions.
    expect(questions).toHaveLength(2)
    expect(questions[0]).toMatchObject({ id: 'D1', type: 'multi', open: false, decisionLine: 5 })
    expect(questions[1]).toMatchObject({ id: 'D2', open: true, decisionLine: 13 })
    expect(countOpenInputs([{ name: 'plan.md', content }])).toBe(1)
  })
})

describe('parseQuestions — bare Decision lines (compat)', () => {
  it('an empty bare Decision line is an open question with its context', () => {
    const content = doc(
      '### D1 — Scope', // 0
      'Should we include the API?', // 1
      '', // 2
      '**Decision:**', // 3
    )
    const questions = parseQuestions('plan/00-decisions.md', content)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toEqual({
      file: 'plan/00-decisions.md',
      context: '### D1 — Scope\nShould we include the API?',
      open: true,
      decisionLine: 3,
    })
  })

  it('an answered bare Decision line is a closed question', () => {
    const questions = parseQuestions('a.md', doc('Q?', '**Decision:** ship it ·2026-07-07'))
    expect(questions).toHaveLength(1)
    expect(questions[0]!.open).toBe(false)
  })

  it('a Decision line inside a NON-question code fence is ignored', () => {
    const content = doc(
      '```markdown',
      '**Decision:**',
      '```',
      'trailing prose',
    )
    expect(parseQuestions('a.md', content)).toEqual([])
  })
})

describe('parseQuestions — multiple blocks and context segmentation', () => {
  const multi = doc(
    'Shared intro.', // 0
    '', // 1
    '```question', // 2
    'id: D1', // 3
    'type: text', // 4
    '```', // 5
    '**Decision:** done', // 6
    '', // 7
    'Context for the second question only.', // 8
    '', // 9
    '```question', // 10
    'id: D2', // 11
    'type: choice', // 12
    'options: [a, b]', // 13
    '```', // 14
    '**Decision:**', // 15
    '', // 16
    '### D3 — bare follow-up', // 17
    '**Decision:**', // 18
  )

  it('parses all blocks in order with per-question decisionLine and context', () => {
    const questions = parseQuestions('plan.md', multi)
    expect(questions).toHaveLength(3)
    expect(questions.map((q) => q.decisionLine)).toEqual([6, 15, 18])
    expect(questions.map((q) => q.open)).toEqual([false, true, true])
    expect(questions[0]!.context).toBe('Shared intro.')
    // Context restarts after the previous question's Decision line.
    expect(questions[1]!.context).toBe('Context for the second question only.')
    expect(questions[1]!.options).toEqual(['a', 'b'])
    expect(questions[2]!.context).toBe('### D3 — bare follow-up')
  })
})

describe('parseTicketQuestions / countOpenInputs', () => {
  const artifacts = [
    { name: 'Idea', content: doc('The idea.', '**Decision:**') },
    {
      name: 'plan/01-a.md',
      content: doc('```question', 'id: D1', 'type: text', '```', '**Decision:** answered'),
    },
    { name: 'plan/02-b.md', content: doc('No questions here.') },
    { name: 'review.md', content: doc('**Decision:**', 'and later', '**Decision:** ok') },
  ]

  it('composes questions across artifacts (Idea body included) with file attribution', () => {
    const questions = parseTicketQuestions(artifacts)
    expect(questions.map((q) => q.file)).toEqual(['Idea', 'plan/01-a.md', 'review.md', 'review.md'])
  })

  it('counts only the OPEN inputs', () => {
    expect(countOpenInputs(artifacts)).toBe(2)
    expect(countOpenInputs([])).toBe(0)
  })
})
