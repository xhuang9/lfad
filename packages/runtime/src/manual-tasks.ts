/** Pure parsing for the root-level, cross-cutting `manual-tasks.md` contract. */

import { parse as parseYaml } from 'yaml'

import type { Artifact } from './artifacts.js'

export const MANUAL_TASKS_FILE = 'manual-tasks.md'

export interface ManualTaskInfo {
  file: typeof MANUAL_TASKS_FILE
  id: string
  service: string
  title: string
  goal: string
  steps: string[]
  done: boolean
  /** Source-order index among valid tasks. */
  sourceIndex: number
  /** 0-based line containing the task's `done: true|false` field. */
  doneLine: number
}

export interface ManualTaskCounts {
  total: number
  pending: number
}

function taskFromFence(lines: string[], start: number, end: number, sourceIndex: number): ManualTaskInfo | null {
  let raw: unknown
  try {
    raw = parseYaml(lines.slice(start + 1, end).join('\n'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const strings = ['id', 'service', 'title', 'goal'] as const
  if (strings.some((key) => typeof value[key] !== 'string' || value[key].trim() === '')) return null
  if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.some((step) => typeof step !== 'string' || step.trim() === '')) return null
  if (typeof value.done !== 'boolean') return null

  const relativeDoneLine = lines.slice(start + 1, end).findIndex((line) => /^\s*done:\s*(?:true|false)\s*(?:#.*)?$/i.test(line))
  if (relativeDoneLine < 0) return null
  return {
    file: MANUAL_TASKS_FILE,
    id: (value.id as string).trim(),
    service: (value.service as string).trim(),
    title: (value.title as string).trim(),
    goal: (value.goal as string).trim(),
    steps: (value.steps as string[]).map((step) => step.trim()),
    done: value.done,
    sourceIndex,
    doneLine: start + 1 + relativeDoneLine,
  }
}

/** Parses valid fenced `manual-task` YAML blocks and ignores malformed blocks. */
export function parseManualTasks(content: string): ManualTaskInfo[] {
  const lines = content.split('\n')
  const tasks: ManualTaskInfo[] = []
  const ids = new Set<string>()
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(?<fence>`{3,}|~{3,})\s*manual-task\s*$/.exec(lines[i]!)
    if (open?.groups?.fence === undefined) continue
    const fence = open.groups.fence
    const char = fence[0]!
    let close = -1
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j]!.trimEnd()
      if (line.length >= fence.length && [...line].every((c) => c === char)) {
        close = j
        break
      }
    }
    if (close < 0) break
    const task = taskFromFence(lines, i, close, tasks.length)
    if (task !== null && !ids.has(task.id)) {
      ids.add(task.id)
      tasks.push(task)
    }
    i = close
  }
  return tasks
}

/** Reads the dedicated root artifact only; examples elsewhere never become live tasks. */
export function parseTicketManualTasks(artifacts: Artifact[]): ManualTaskInfo[] {
  const artifact = artifacts.find((item) => item.name === MANUAL_TASKS_FILE)
  return artifact === undefined ? [] : parseManualTasks(artifact.content)
}

export function countManualTasks(tasks: ManualTaskInfo[]): ManualTaskCounts {
  return { total: tasks.length, pending: tasks.filter((task) => !task.done).length }
}

/** Pending first, preserving source order within both groups. */
export function orderManualTasks(tasks: ManualTaskInfo[]): ManualTaskInfo[] {
  return [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || a.sourceIndex - b.sourceIndex)
}
