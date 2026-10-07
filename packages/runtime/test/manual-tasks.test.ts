import { describe, expect, it } from 'vitest'

import { countManualTasks, orderManualTasks, parseManualTasks, parseTicketManualTasks } from '../src/manual-tasks.js'

const mixed = `# Manual tasks

\`\`\`manual-task
id: done-first
service: Vercel
title: Add production secrets
goal: Make credentials available
steps:
  - Open Settings
  - Add the values
done: true
\`\`\`

\`\`\`manual-task
id: pending-second
service: App Store Connect
title: Create a signing key
goal: Provide the APNs key
steps:
  - Open Users and Access
done: false
\`\`\`
`

describe('manual task parsing', () => {
  it('parses the dedicated contract with source and completion-line metadata', () => {
    const tasks = parseManualTasks(mixed)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({ id: 'done-first', done: true, sourceIndex: 0, doneLine: 10 })
    expect(tasks[1]).toMatchObject({ id: 'pending-second', done: false, sourceIndex: 1, doneLine: 20 })
    expect(countManualTasks(tasks)).toEqual({ total: 2, pending: 1 })
    expect(orderManualTasks(tasks).map(({ id }) => id)).toEqual(['pending-second', 'done-first'])
  })

  it('reads only root manual-tasks.md and ignores malformed or duplicate tasks', () => {
    const malformed = `${mixed}\n\`\`\`manual-task\nid: missing-fields\ndone: false\n\`\`\`\n${mixed}`
    expect(parseManualTasks(malformed).map(({ id }) => id)).toEqual(['done-first', 'pending-second'])
    expect(parseTicketManualTasks([
      { name: 'design/example.md', content: mixed },
      { name: 'manual-tasks.md', content: malformed },
    ])).toHaveLength(2)
    expect(parseTicketManualTasks([{ name: 'todo/00-context.md', content: mixed }])).toEqual([])
  })

  it('ignores unterminated fences and non-boolean completion fields', () => {
    expect(parseManualTasks('```manual-task\nid: x')).toEqual([])
    expect(parseManualTasks(mixed.replace('done: false', 'done: pending'))).toHaveLength(1)
  })
})
