// Slim orchestrator for the ticket drawer: wires the detail/edit state, the
// action cluster, and the shortcuts together, and renders the header + the
// rail/doc body. The heavy lifting lives in hooks/ and components/.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, X } from 'lucide-react'

import type { Artifact, AutomationLevel, StepPayload, Ticket } from '../../types'
import { CATEGORY_BADGES } from '../../types'
import { clearRunning } from '../../api'
import { useResolvedOrientation } from '../../useBoardLayout'
import { DEPENDENCIES_SECTION_SLUG } from '../../dependencies'
import { MANUAL_TASKS_FILE } from '../../manualTasks'
import { deriveNextActionLabel } from '../../nextActionLabel'
import { useCopied } from '../../useCopied'
import { useFocusTrap } from '../../useFocusTrap'
import { StageRail } from '../StageProgress'
import { AutomationHelpModal } from './components/AutomationHelpModal'
import { BlockedMode } from './components/BlockedMode/BlockedMode'
import { BLOCKED_ARTIFACT, BLOCKED_SECTION_SLUG } from './components/BlockedMode/blockedInfo'
import { DrawerActions } from './components/DrawerActions'
import { Dependencies } from './components/dependencies/Dependencies'
import { InputMode } from './components/InputMode/InputMode'
import { ManualTasks } from './components/ManualTasks'
import { SectionDoc } from './components/SectionDoc'
import { artifactSlug, promptFileLabel, SectionRail } from './components/SectionRail'
import { useDrawerActions } from './hooks/useDrawerActions'
import { useDrawerShortcuts } from './hooks/useDrawerShortcuts'
import { useTicketDetail } from './hooks/useTicketDetail'

/** Class for the drawer automation `<select>`, tinted per level to mirror the
 *  card automation badge (#77): express/manual carry the same `--status-*`
 *  solid tint, normal stays neutral. Colocated + exported so the test seam can
 *  assert the level→class mapping without rendering the whole drawer. */
export function automationSelectClassName(level: AutomationLevel): string {
  return level === 'normal' ? 'automation-select' : `automation-select ${level}`
}

interface TicketDrawerProps {
  ticketId: number
  /** Section to open, as a slug of the artifact name (`idea`, `plan/01-x`, …).
   *  `input`, `blocked`, and `dependencies` are reserved cross-cutting views. */
  sectionSlug: string | null
  /** Heading id to scroll into view once the section renders. */
  anchor: string | null
  steps: StepPayload[]
  /** Bumps on every board change — drives the live detail refetch. */
  boardVersion: number
  /** Browse-only mode (the ticket lives in the `_archive` cold store): no
   *  inline editing of the ticket. */
  readOnly?: boolean
  /** Live and archived prerequisite choices for the dependency editor. */
  candidates: Ticket[]
  archivedCandidates: Ticket[]
  lifecycleAction?: 'park' | 'restore'
  onLifecycleAction: () => Promise<void>
  onClose: () => void
  /** Push the URL for a section switch (slug of the artifact name), with an
   *  optional heading anchor to scroll to once the section renders. */
  onSection: (slug: string, anchor?: string) => void
}

export function TicketDrawer({ ticketId, sectionSlug, anchor, steps, boardVersion, readOnly = false, candidates, archivedCandidates, lifecycleAction, onLifecycleAction, onClose, onSection }: TicketDrawerProps) {
  // Input mode replaces the rail/doc body with the question flow. While an
  // answer draft is in progress the live detail refetch is held (the same
  // guard the inline editor uses) so a board change never clobbers typing.
  const inputMode = sectionSlug === 'input'
  const blockedSection = sectionSlug === BLOCKED_SECTION_SLUG
  const dependencyMode = sectionSlug === DEPENDENCIES_SECTION_SLUG
  const [inputDirty, setInputDirty] = useState(false)
  const { detail, error, editing, draft, saving, saveError, setDraft, startEdit, cancelEdit, save, setLevel, applyDetail } = useTicketDetail(ticketId, boardVersion, (inputMode || blockedSection) && inputDirty, readOnly)

  const ticket = detail?.ticket
  const categoryBadge = ticket ? CATEGORY_BADGES[ticket.category] : undefined
  const statusStep = ticket ? steps.find((step) => step.key === ticket.status) : undefined
  const statusLabel = ticket ? (statusStep?.label ?? ticket.status) : ''
  const statusTone = ticket?.status === 'blocked'
    ? 'danger'
    : statusStep?.type === 'gate'
      ? 'warn'
      : ticket?.status === 'doing'
        ? 'accent'
        : 'neutral'
  const artifacts = useMemo(() => detail?.artifacts ?? [], [detail])
  const inLateralLane = ticket !== undefined && steps.some((step) => step.key === ticket.status && step.lateral)
  const blockedMode = blockedSection && inLateralLane
  const generalOpenInputs = detail?.questions.filter(
    (question) => question.open && question.file.toLowerCase() !== BLOCKED_ARTIFACT,
  ).length ?? 0

  // The stage `flow:next` will advance the ticket to — the button reads "Next: <stage>".
  // Mirrors core's skip rule via the /api/steps metadata: a step with
  // `skipUnless` applies only when the ticket's flag (a frontmatter field like
  // `needsDesign`, or a custom flag in `extras`) is truthy. The last rendered
  // step advances to the `_archive` cold store.
  const nextLabel = useMemo(() => {
    if (ticket === undefined) return 'Next'
    const flags = ticket as unknown as Record<string, unknown>
    const applies = (s: StepPayload): boolean =>
      s.skipUnless === undefined || Boolean(flags[s.skipUnless] ?? ticket.extras?.[s.skipUnless])
    const line = steps.filter((s) => !s.lateral && applies(s))
    const i = line.findIndex((s) => s.key === ticket.status)
    return i >= 0 && i < line.length - 1 ? line[i + 1].label : 'Archive'
  }, [steps, ticket])
  const nextActionLabel = deriveNextActionLabel(ticket, nextLabel)

  const exitInput = useCallback(() => onSection(''), [onSection])
  // The `q` shortcut / question button toggles between the doc and the flow.
  const toggleInput = useCallback(() => onSection(inputMode ? '' : 'input'), [inputMode, onSection])
  // Leaving input mode OR switching tickets releases the hold — a draft never
  // belongs to the new ticket, and a stuck hold would pin the old detail
  // (and misattribute a submit) after a /t/1/input → /t/2/input navigation.
  useEffect(() => {
    setInputDirty(false)
  }, [inputMode, ticketId])

  // Resolve the section slug (from the URL) to an artifact index.
  const sectionIndex = useMemo(() => {
    if (sectionSlug === null) return 0
    const i = artifacts.findIndex((a) => artifactSlug(a.name) === sectionSlug)
    return i >= 0 ? i : 0
  }, [artifacts, sectionSlug])
  const current = artifacts[sectionIndex] as Artifact | undefined
  const manualTaskMode = !blockedMode && current?.name === MANUAL_TASKS_FILE
  const promptFileText = current && !manualTaskMode ? promptFileLabel(current.name, steps) : undefined
  const manualTaskCounts = {
    total: detail?.manualTasks.length ?? 0,
    pending: detail?.manualTasks.filter((task) => !task.done).length ?? 0,
  }

  // In-document links to a sibling `.md` artifact switch the active section
  // (and carry the heading anchor) instead of opening raw bytes. Targets that
  // are not a known artifact keep the link's normal raw-files behaviour.
  const openArtifactLink = useCallback((path: string, anchorId: string | null): boolean => {
    const match = artifacts.find((a) => (a.name === 'Idea' ? 'ticket.md' : a.name).toLowerCase() === path.toLowerCase())
    if (match === undefined) return false
    onSection(artifactSlug(match.name), anchorId ?? undefined)
    return true
  }, [artifacts, onSection])

  // Leaving a section or ticket (or crossing the input-mode boundary)
  // discards an in-progress edit.
  useEffect(cancelEdit, [ticketId, sectionIndex, inputMode, blockedMode, dependencyMode, cancelEdit])

  const panelRef = useRef<HTMLDivElement>(null)
  // Trap first (captures where focus came from), then land focus on the panel
  // itself so the drawer shortcuts work without highlighting a control.
  useFocusTrap(panelRef)
  useEffect(() => panelRef.current?.focus(), [])

  // The drawer's edge follows the board layout: portrait = bottom sheet,
  // landscape = right-side panel. The overlay covers the board in both.
  const orientation = useResolvedOrientation()
  const isSide = orientation === 'landscape'

  // The drawer opens capped (half height / capped width); the header toggle and
  // the `f` / ⌘⇧F shortcut expand it to full (full height / full width).
  const [expanded, setExpanded] = useState(false)
  const [automationHelpOpen, setAutomationHelpOpen] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)

  const runLifecycleAction = useCallback(async () => {
    setLifecycleBusy(true)
    setLifecycleError(null)
    try {
      await onLifecycleAction()
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : String(err))
    } finally {
      setLifecycleBusy(false)
    }
  }, [onLifecycleAction])

  const idCopy = useCopied()
  const wtCopy = useCopied()
  const idStr = ticket ? String(ticket.id) : ''
  const drawerActions = useDrawerActions(ticket, steps)
  const showHints = useDrawerShortcuts({
    disabled: automationHelpOpen,
    editing,
    cancelEdit,
    inputMode,
    onExitInput: exitInput,
    onClose,
    idStr,
    copyId: idCopy.copy,
    actions: drawerActions.actions,
    copyCommand: drawerActions.copyCommand,
    onToggleExpand: () => setExpanded((e) => !e),
    onToggleInput: toggleInput,
    canToggleInput: generalOpenInputs > 0,
  })

  const expandLabel = expanded
    ? (isSide ? 'Collapse to capped width (f · ⌘⇧F)' : 'Collapse to half height (f · ⌘⇧F)')
    : (isSide ? 'Expand to full width (f · ⌘⇧F)' : 'Expand to full height (f · ⌘⇧F)')

  return (
    <div className={`drawer-backdrop drawer-backdrop-${orientation}`} onClick={onClose}>
      <aside
        className={`drawer ${isSide ? 'drawer-side' : ''} ${expanded ? 'drawer-full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ticket ? `Ticket #${ticket.id}: ${ticket.title}` : 'Ticket detail'}
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          {ticket ? (
            <>
              <div className="drawer-headline">
                <button
                  className="card-id id-copy"
                  onClick={() => idCopy.copy(idStr)}
                  aria-label={`Copy ticket id ${idStr}`}
                  title="Copy id (c)"
                >
                  {idCopy.copied ? 'Copied' : `#${idStr}`}
                  {showHints && <kbd className="kbd-hint">c</kbd>}
                </button>
                <span
                  className="category-badge"
                  style={{ backgroundColor: categoryBadge?.fill, color: categoryBadge?.ink }}
                >
                  {categoryBadge?.label}
                </span>
                <span className={`status-badge status-${statusTone}`}>{statusLabel}</span>
                <span className="automation-unit">
                  <label className={automationSelectClassName(ticket.automationLevel ?? 'normal')}>
                    <span className="automation-label">Automation</span>
                    <select
                      value={ticket.automationLevel ?? 'normal'}
                      disabled={readOnly}
                      onChange={(e) => setLevel(e.target.value as AutomationLevel)}
                      aria-label="Automation level"
                    >
                      <option value="express">Express</option>
                      <option value="normal">Normal</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                  <button
                    className="automation-info"
                    type="button"
                    aria-label="Explain automation levels"
                    aria-haspopup="dialog"
                    aria-expanded={automationHelpOpen}
                    onClick={() => setAutomationHelpOpen(true)}
                  >
                    Help
                  </button>
                </span>
                <span className="drawer-created">created {new Date(ticket.createdAt).toLocaleDateString()}</span>
                {ticket.worktree && (
                  <button
                    className="card-wt id-copy"
                    onClick={() => wtCopy.copy(ticket.worktree!)}
                    aria-label={`Copy worktree path ${ticket.worktree}`}
                    title={`Copy worktree path\n${ticket.worktree}`}
                  >
                    {wtCopy.copied ? 'Copied' : ticket.worktree.split('/').filter(Boolean).pop()}
                  </button>
                )}
              </div>
              <h1 className="drawer-title">{ticket.title}</h1>
              <div className="drawer-meta">
                {ticket.tags.map((t) => (
                  <span key={t} className="card-tag">
                    {t}
                  </span>
                ))}
              </div>
              {ticket.extras?.buildStages ? <StageRail stages={ticket.extras.buildStages} /> : null}
              <DrawerActions
                ticketId={ticket.id}
                commandPrefix={drawerActions.commandPrefix}
                skillPrefix={drawerActions.skillPrefix}
                actions={drawerActions.actions}
                copiedSkill={drawerActions.copiedSkill}
                onCopyCommand={drawerActions.copyCommand}
                copiedPrompt={drawerActions.copiedPrompt}
                onCopyPrompt={drawerActions.copyPrompt}
                showHints={showHints}
                currentName={inputMode || blockedMode || dependencyMode || manualTaskMode ? undefined : current?.name}
                promptFileLabel={promptFileText}
                runningCount={ticket.running?.count ?? 0}
                onClearRunning={() => { void clearRunning(ticket.id) }}
                openInputs={generalOpenInputs}
                pendingManualTasks={manualTaskCounts.pending}
                manualTaskMode={manualTaskMode}
                onOpenManualTasks={() => onSection(artifactSlug(MANUAL_TASKS_FILE))}
                nextActionLabel={nextActionLabel}
                inputMode={inputMode}
                onToggleInput={toggleInput}
                lifecycleAction={lifecycleAction}
                lifecycleBusy={lifecycleBusy}
                onLifecycleAction={() => { void runLifecycleAction() }}
                editable={!readOnly}
                editing={editing}
                saving={saving}
                onStartEdit={() => current && startEdit(current.content)}
                onCancelEdit={cancelEdit}
                onSave={() => current && save(current.name)}
              />
            </>
          ) : (
            <h1 className="drawer-title">{error ? 'Could not load ticket' : 'Loading…'}</h1>
          )}
          <button
            className="drawer-expand"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expandLabel}
            title={expandLabel}
          >
            {isSide
              ? <ChevronLeft className="drawer-expand-icon" aria-hidden="true" />
              : <ChevronDown className="drawer-expand-icon" aria-hidden="true" />}
            {showHints && <kbd className="kbd-hint kbd-hint-float">⌘⇧F</kbd>}
          </button>
          <button className="drawer-close" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
            <X aria-hidden="true" />
            {showHints && <kbd className="kbd-hint kbd-hint-float">Esc</kbd>}
          </button>
        </header>

        {(error || lifecycleError) && <p className="drawer-error">{error ?? lifecycleError}</p>}

        {detail && (
          <div className="drawer-body">
            {inputMode ? (
              <InputMode
                ticketId={ticketId}
                commandPrefix={drawerActions.commandPrefix}
                detail={detail}
                applyDetail={applyDetail}
                actions={drawerActions.actions}
                copiedSkill={drawerActions.copiedSkill}
                onCopyCommand={drawerActions.copyCommand}
                onExit={exitInput}
                onDirty={setInputDirty}
                onArtifactLink={openArtifactLink}
              />
            ) : (
              <>
                <SectionRail
                  key={ticketId}
                  artifacts={artifacts}
                  steps={steps}
                  activeIndex={sectionIndex}
                  currentStep={ticket?.status ?? ''}
                  stepNotes={ticket?.stepNotes}
                  manualTasks={manualTaskCounts}
                  dependencyCount={detail.dependencyState.edges.length}
                  dependencyActive={dependencyMode}
                  blockedActive={blockedMode}
                  returnStep={ticket?.returnStep}
                  onSection={onSection}
                />
                {blockedMode ? (
                  <BlockedMode
                    ticketId={ticketId}
                    commandPrefix={drawerActions.commandPrefix}
                    skillPrefix={drawerActions.skillPrefix}
                    detail={detail}
                    applyDetail={applyDetail}
                    copiedSkill={drawerActions.copiedSkill}
                    onCopyCommand={drawerActions.copyCommand}
                    onDirty={setInputDirty}
                    onArtifactLink={openArtifactLink}
                  />
                ) : dependencyMode ? (
                  <Dependencies
                    detail={detail}
                    steps={steps}
                    candidates={candidates}
                    archivedCandidates={archivedCandidates}
                    readOnly={readOnly}
                    onSaved={applyDetail}
                  />
                ) : manualTaskMode && current ? (
                  <ManualTasks
                    ticketId={ticketId}
                    commandPrefix={drawerActions.commandPrefix}
                    skillPrefix={drawerActions.skillPrefix}
                    tasks={detail.manualTasks}
                    artifact={current}
                    readOnly={readOnly}
                    applyDetail={applyDetail}
                  />
                ) : (
                  <SectionDoc
                    ticketId={ticketId}
                    current={current}
                    anchor={anchor}
                    editing={editing}
                    draft={draft}
                    saveError={saveError}
                    onDraft={setDraft}
                    onArtifactLink={openArtifactLink}
                  />
                )}
              </>
            )}
          </div>
        )}

        {automationHelpOpen && (
          <AutomationHelpModal onClose={() => setAutomationHelpOpen(false)} />
        )}
      </aside>
    </div>
  )
}
