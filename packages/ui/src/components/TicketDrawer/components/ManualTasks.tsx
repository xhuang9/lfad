import { useState } from 'react'
import { Check, CheckCircle2, ChevronDown, ChevronUp, ListChecks, MessageSquare } from 'lucide-react'

import { ApiError, updateArtifact } from '../../../api'
import { orderManualTasks, setManualTaskDone } from '../../../manualTasks'
import type { Artifact, ManualTaskInfo, TicketDetail } from '../../../types'
import { useCopied } from '../../../useCopied'

interface ManualTasksProps {
  ticketId: number
  commandPrefix: '/' | '$'
  skillPrefix: string
  tasks: ManualTaskInfo[]
  artifact: Artifact
  readOnly: boolean
  applyDetail: (detail: TicketDetail) => void
}

export function ManualTasks({ ticketId, commandPrefix, skillPrefix, tasks, artifact, readOnly, applyDetail }: ManualTasksProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const promptCopy = useCopied()
  const ordered = orderManualTasks(tasks)
  const pending = ordered.filter((task) => !task.done)
  const done = ordered.filter((task) => task.done)

  const toggleDone = (task: ManualTaskInfo, nextDone: boolean): void => {
    if (readOnly || busy !== null) return
    let content: string
    try {
      content = setManualTaskDone(artifact.content, task, nextDone)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    setBusy(task.id)
    setError(null)
    updateArtifact(ticketId, artifact.name, content, artifact.content)
      .then(applyDetail)
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError && cause.status === 409
          ? 'Manual tasks changed while this ticket was open. Refresh and try again.'
          : cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setBusy(null))
  }

  const promptTask = (task: ManualTaskInfo): void => {
    promptCopy.copy(`${commandPrefix}${skillPrefix}:prompt ${ticketId} in ${artifact.name} task ${task.id}: `)
    setCopiedId(task.id)
  }

  const renderTask = (task: ManualTaskInfo) => {
    const showSteps = !task.done || expanded.has(task.id)
    return (
      <article key={task.id} className={`manual-task${task.done ? ' manual-task-done' : ''}`}>
        <div className="manual-task-head">
          <div className="manual-task-status">
            <span className="manual-task-service">{task.service}</span>
            <span className={task.done ? 'manual-task-done-label' : 'manual-task-pending'}>
              {task.done ? <><Check aria-hidden="true" /> Done</> : 'Pending'}
            </span>
          </div>
          <button className="btn manual-task-prompt" onClick={() => promptTask(task)}>
            <MessageSquare aria-hidden="true" /> {promptCopy.copied && copiedId === task.id ? 'Copied' : 'Prompt'}
          </button>
        </div>
        <h3>{task.title}</h3>
        <p><strong>Goal:</strong> {task.goal}</p>
        {showSteps && (
          <ol className="manual-task-steps">
            {task.steps.map((step, index) => <li key={`${task.id}-${index}`}>{step}</li>)}
          </ol>
        )}
        <div className="manual-task-foot">
          {task.done && (
            <button className="btn" onClick={() => setExpanded((current) => {
              const next = new Set(current)
              if (next.has(task.id)) next.delete(task.id)
              else next.add(task.id)
              return next
            })}>
              {showSteps ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {showSteps ? 'Hide steps' : 'Show steps'}
            </button>
          )}
          {!readOnly && (
            <button className="btn" disabled={busy !== null} onClick={() => toggleDone(task, !task.done)}>
              {busy === task.id ? 'Saving…' : task.done ? 'Reopen' : 'Mark complete'}
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="manual-tasks-view">
      <header className="manual-tasks-head">
        <div><h2>Manual tasks</h2><p>Agent-authored steps for work that needs a human — dashboards, configs, store consoles, and more.</p></div>
        <span className="manual-task-count">{pending.length} pending · {done.length} done</span>
      </header>
      {pending.length > 0 ? (
        <div className="manual-task-callout manual-task-callout-pending"><ListChecks aria-hidden="true" /><div><strong>Flow paused</strong><p>Complete the {pending.length} pending task{pending.length === 1 ? '' : 's'} before <code>{`${skillPrefix}:next`}</code> can continue.</p></div></div>
      ) : (
        <div className="manual-task-callout manual-task-callout-done"><CheckCircle2 aria-hidden="true" /><div><strong>Nothing still needs human action</strong><p><code>{`${skillPrefix}:next`}</code> can continue. Reopening a task pauses it again.</p></div></div>
      )}
      {error && <p className="drawer-error manual-task-error">{error}</p>}
      {pending.length > 0 && <section className="manual-task-group"><h2>Pending <span>{pending.length}</span></h2>{pending.map(renderTask)}</section>}
      {done.length > 0 && <section className="manual-task-group"><h2>{pending.length > 0 ? 'Done' : 'Manual tasks'} <span>{done.length}</span></h2>{done.map(renderTask)}</section>}
    </section>
  )
}
