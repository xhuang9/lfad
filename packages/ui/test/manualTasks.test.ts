import { describe, expect, it } from 'vitest'

import { orderManualTasks, setManualTaskDone } from '../src/manualTasks'
import type { ManualTaskInfo } from '../src/types'

function task(id: string, sourceIndex: number, done = false, doneLine = 1): ManualTaskInfo {
  return {
    file: 'manual-tasks.md',
    id,
    service: 'Service',
    title: id,
    goal: 'Do it',
    steps: ['Open the dashboard'],
    done,
    sourceIndex,
    doneLine,
  }
}

describe('manual task UI helpers', () => {
  it('puts pending tasks first and preserves source order within each group', () => {
    const ordered = orderManualTasks([
      task('done-first', 0, true),
      task('pending-first', 1),
      task('done-second', 2, true),
      task('pending-second', 3),
    ])
    expect(ordered.map(({ id }) => id)).toEqual(['pending-first', 'pending-second', 'done-first', 'done-second'])
  })

  it('rewrites only the attributed done field while retaining whitespace and comments', () => {
    const content = ['```manual-task', '  done: false # human state', '```', 'done: false'].join('\n')
    expect(setManualTaskDone(content, task('toggle', 0, false, 1), true)).toBe(
      ['```manual-task', '  done: true # human state', '```', 'done: false'].join('\n'),
    )
  })

  it('rejects a stale or mismatched completion line', () => {
    expect(() => setManualTaskDone('title: no done field', task('stale', 0), true)).toThrow(/no longer matches/)
  })
})
