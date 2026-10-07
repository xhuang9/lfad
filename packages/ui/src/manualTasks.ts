import type { ManualTaskInfo } from './types'

export const MANUAL_TASKS_FILE = 'manual-tasks.md'

/** Pending first, with author source order retained inside each group. */
export function orderManualTasks(tasks: ManualTaskInfo[]): ManualTaskInfo[] {
  return [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || a.sourceIndex - b.sourceIndex)
}

/** Rewrites only the parser-attributed completion line in the current artifact. */
export function setManualTaskDone(content: string, task: ManualTaskInfo, done: boolean): string {
  const lines = content.split('\n')
  const line = lines[task.doneLine]
  const match = line?.match(/^(\s*done:\s*)(?:true|false)(\s*(?:#.*)?)$/i)
  if (match === null || match === undefined) throw new Error(`Manual task '${task.id}' no longer matches its completion line.`)
  lines[task.doneLine] = `${match[1]}${String(done)}${match[2]}`
  return lines.join('\n')
}
