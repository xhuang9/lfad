// The drawer's action cluster: one copy-command button per skill that can
// process the ticket at its current step (buttons copy `/<skill> <id>` —
// the operator pastes the command into their own Claude Code session), plus
// the right-aligned Edit / Save / Cancel controls for the active section.

import type { PromptScope } from '../hooks/useDrawerActions'
import { sectionLabel } from './SectionRail'

/** Friendly button copy for an action skill. `flow:next` uses the label derived
 *  by the drawer from the ticket state (stage + live clarity); other skills fall
 *  back to their raw name. */
export function actionLabel(skill: string, nextActionLabel: string): string {
  if (skill.endsWith(':next')) return nextActionLabel
  return skill
}

interface DrawerActionsProps {
  ticketId: number
  commandPrefix: '/' | '$'
  skillPrefix: string
  /** Skills that can process the ticket here (ticketActions order = ⌃1…⌃9). */
  actions: string[]
  /** Skill whose command was just copied — drives the button feedback. */
  copiedSkill: string | null
  onCopyCommand: (skill: string) => void
  /** Which Prompt button was just copied — drives the Prompt File/Ticket feedback. */
  copiedPrompt: PromptScope | null
  /** Copies a `/flow:prompt <id>` stub — a file name targets that artifact, null the whole ticket. */
  onCopyPrompt: (fileName: string | null) => void
  /** True while Control/⌘ is held — reveals the shortcut badges. */
  showHints: boolean
  /** Name of the active section; undefined while the detail is loading. */
  currentName: string | undefined
  /** Step-qualified label for the active section's Prompt button. */
  promptFileLabel?: string
  /** Concurrent leases on this ticket; zero hides the force-clear control. */
  runningCount: number
  onClearRunning: () => void
  /** Open question inputs on the ticket — drives the "N questions" affordance. */
  openInputs: number
  /** Pending manual tasks — zero hides the cross-cutting action button. */
  pendingManualTasks: number
  manualTaskMode: boolean
  onOpenManualTasks: () => void
  /** Ticket-aware label for `flow:next` (next stage or live interview clarity). */
  nextActionLabel: string
  /** True while the drawer body shows input mode — the toggle reads as pressed. */
  inputMode: boolean
  /** Toggles input mode on/off (enter the question flow, or return to the doc). */
  onToggleInput: () => void
  lifecycleAction?: 'park' | 'restore'
  lifecycleBusy: boolean
  onLifecycleAction: () => void
  /** False in read-only browsing (an archived ticket) — hides the Edit/Save/Cancel cluster. */
  editable?: boolean
  editing: boolean
  saving: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
}

export function DrawerActions({ ticketId, commandPrefix, skillPrefix, actions, copiedSkill, onCopyCommand, copiedPrompt, onCopyPrompt, showHints, currentName, promptFileLabel, runningCount, onClearRunning, openInputs, pendingManualTasks, manualTaskMode, onOpenManualTasks, nextActionLabel, inputMode, onToggleInput, lifecycleAction, lifecycleBusy, onLifecycleAction, editable = true, editing, saving, onStartEdit, onCancelEdit, onSave }: DrawerActionsProps) {
  return (
    <div className="drawer-actions">
      {pendingManualTasks > 0 && (
        <button
          className={`btn btn-manual-tasks${manualTaskMode ? ' is-active' : ''}`}
          onClick={onOpenManualTasks}
          aria-pressed={manualTaskMode}
        >
          {pendingManualTasks} manual task{pendingManualTasks === 1 ? '' : 's'}
        </button>
      )}
      {openInputs > 0 && (
        <button
          className={`btn btn-question${inputMode ? ' is-active' : ''}`}
          onClick={onToggleInput}
          aria-pressed={inputMode}
          title={inputMode ? 'Back to the document (⌘`)' : 'Answer the open questions one at a time (⌘`)'}
        >
          {openInputs} question{openInputs === 1 ? '' : 's'}
          {showHints && <kbd className="kbd-hint">⌘`</kbd>}
        </button>
      )}
      {runningCount > 0 && (
        <button className="btn btn-running" onClick={onClearRunning} title="Force-release every running claim on this ticket">
          Running{runningCount > 1 ? ` (${runningCount})` : ''} · Clear
        </button>
      )}
      {lifecycleAction && (
        <button className="btn" onClick={onLifecycleAction} disabled={lifecycleBusy}>
          {lifecycleBusy ? (lifecycleAction === 'park' ? 'Parking…' : 'Restoring…') : (lifecycleAction === 'park' ? 'Park' : 'Restore')}
        </button>
      )}
      {currentName !== undefined && (
        <button
          className="btn cmd-btn"
          onClick={() => onCopyPrompt(currentName)}
          title={`copies "${commandPrefix}${skillPrefix}:prompt ${ticketId} in ${currentName}: " — paste it into your agent session, then type your instruction`}
          aria-label={`Copy prompt command targeting ${currentName}`}
        >
          {copiedPrompt === 'file' ? 'Copied' : (promptFileLabel ?? 'Prompt File')}
        </button>
      )}
      <button
        className="btn cmd-btn"
        onClick={() => onCopyPrompt(null)}
        title={`copies "${commandPrefix}${skillPrefix}:prompt ${ticketId}" — paste it into your agent session, then type your instruction`}
        aria-label={`Copy prompt command for the whole ticket ${ticketId}`}
      >
        {copiedPrompt === 'ticket' ? 'Copied' : 'Prompt Ticket'}
      </button>
      {actions.map((skill, i) => (
        <button
          key={skill}
          className="btn cmd-btn"
          onClick={() => onCopyCommand(skill)}
          title={`⌃${i + 1} · copies "${commandPrefix}${skill} ${ticketId}" — paste it into your agent session`}
          aria-label={`Copy command ${commandPrefix}${skill} ${ticketId}`}
        >
          {copiedSkill === skill ? 'Copied' : actionLabel(skill, nextActionLabel)}
          {showHints && i < 9 && (
            <kbd className="kbd-hint">
              ⌃
              {i + 1}
            </kbd>
          )}
        </button>
      ))}
      {editable && currentName !== undefined && (
        <span className="drawer-edit">
          {editing ? (
            <>
              <button className="btn" onClick={onCancelEdit} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <button className="btn" onClick={onStartEdit} aria-label={`Edit ${sectionLabel(currentName).title}`}>
              Edit
            </button>
          )}
        </span>
      )}
    </div>
  )
}
