// Grouped section rail: `Idea` + root-level files first (no header), then one
// group per step subfolder, in the server's canonical artifact order. Group
// headers take the step label from the /api/steps payload (titlecased folder
// name as fallback) and toggle their group — collapsed by default except the
// ticket's current step and the group holding the active section.

import { Fragment, useState } from 'react'
import { Check, ChevronRight, ListChecks } from 'lucide-react'

import { MANUAL_TASKS_FILE } from '../../../manualTasks'
import { DEPENDENCIES_SECTION_SLUG } from '../../../dependencies'
import type { Artifact, StepPayload, Ticket } from '../../../types'
import { BLOCKED_ARTIFACT, BLOCKED_SECTION_SLUG } from './BlockedMode/blockedInfo'

/** Turns an artifact name into the URL slug: name minus `.md`, lowercased. */
export function artifactSlug(name: string): string {
  return name.replace(/\.md$/i, '').toLowerCase()
}

export interface SectionLabel {
  /** Leading `NN` file-number prefix, kept visible as a muted ordinal. */
  ordinal: string | null
  title: string
}

/** Turns an artifact name (`Idea`, `plan/01-server-events.md`) into rail label parts. */
export function sectionLabel(name: string): SectionLabel {
  const base = name.slice(name.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const m = /^(\d+)-(.+)$/.exec(base)
  const title = (m ? m[2] : base).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return { ordinal: m ? m[1] : null, title }
}

function titlecase(folder: string): string {
  return folder.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Builds the visible Prompt File target from an artifact path and its step. */
export function promptFileLabel(name: string, steps: StepPayload[]): string {
  const title = sectionLabel(name).title
  const slash = name.indexOf('/')
  if (slash < 0) return `Prompt ${title}`

  const folder = name.slice(0, slash)
  const stepLabel = steps.find((s) => s.key === folder)?.label ?? titlecase(folder)
  const stepWords = stepLabel.toLowerCase().split(/\s+/)
  return stepWords.includes(title.toLowerCase()) ? `Prompt ${stepLabel}` : `Prompt ${stepLabel} ${title}`
}

interface RailGroup {
  folder: string
  /** Group header text; null for the root group (Idea + root files). */
  label: string | null
  items: { artifact: Artifact, index: number }[]
  /** True when the ticket fast-passed this step (stepNotes applicable=false). */
  skipped: boolean
}

/** Folds the server-ordered artifact list into rail groups by folder prefix,
 *  then injects a header-only group (at its pipeline position) for each
 *  fast-passed step that left no artifacts, so the skip stays visible. */
function groupArtifacts(artifacts: Artifact[], steps: StepPayload[], skippedSteps: Set<string>): RailGroup[] {
  const groups: RailGroup[] = []
  artifacts.forEach((artifact, index) => {
    if (artifact.name === MANUAL_TASKS_FILE || artifact.name.toLowerCase() === BLOCKED_ARTIFACT) return
    const slash = artifact.name.indexOf('/')
    const folder = slash < 0 ? '' : artifact.name.slice(0, slash)
    let group = groups[groups.length - 1] as RailGroup | undefined
    if (group === undefined || group.folder !== folder) {
      const step = steps.find((s) => s.key === folder)
      group = { folder, label: folder === '' ? null : step?.label ?? titlecase(folder), items: [], skipped: skippedSteps.has(folder) }
      groups.push(group)
    }
    group.items.push({ artifact, index })
  })
  for (const step of steps) {
    if (!skippedSteps.has(step.key) || groups.some((g) => g.folder === step.key)) continue
    const marker: RailGroup = { folder: step.key, label: step.label, items: [], skipped: true }
    // Step groups arrive in pipeline order — slot the marker before the first
    // group of a later step (root and unknown folders never match).
    const at = groups.findIndex((g) => {
      const pos = steps.find((s) => s.key === g.folder)?.position
      return pos !== undefined && pos > step.position
    })
    if (at < 0) groups.push(marker)
    else groups.splice(at, 0, marker)
  }
  return groups
}

interface SectionRailProps {
  artifacts: Artifact[]
  steps: StepPayload[]
  activeIndex: number
  /** The ticket's current step — its group starts expanded. */
  currentStep: string
  /** The ticket's per-step notes — fast-passed steps render as skipped. */
  stepNotes?: Ticket['stepNotes']
  manualTasks: { total: number, pending: number }
  dependencyCount: number
  dependencyActive: boolean
  /** True while the pinned blocked section owns the main content area. */
  blockedActive: boolean
  /** Origin step shown on the pinned blocked section's status chip. */
  returnStep?: string
  /** Push the URL for a section switch (slug of the artifact name). */
  onSection: (slug: string) => void
}

export function SectionRail({ artifacts, steps, activeIndex, currentStep, stepNotes, manualTasks, dependencyCount, dependencyActive, blockedActive, returnStep, onSection }: SectionRailProps) {
  // Explicit user toggles win; otherwise a group starts expanded only when it
  // is the ticket's current step or holds the active section (deep links).
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const active = artifacts[activeIndex] as Artifact | undefined
  const activeFolder = active !== undefined && active.name.includes('/') ? active.name.slice(0, active.name.indexOf('/')) : ''
  // Whether the ticket currently sits in the lateral (blocked) lane — read
  // from the step's metadata flag, not a hardcoded key.
  const inLateralLane = steps.some((s) => s.key === currentStep && s.lateral)
  // Steps the ticket fast-passed: `stepNotes.<step>.applicable === false`.
  const skippedSteps = new Set(
    Object.entries(stepNotes ?? {}).filter(([, note]) => note?.applicable === false).map(([key]) => key),
  )

  return (
    <nav className="rail" aria-label="Ticket sections">
      {inLateralLane && (
        <button
          className={`rail-item rail-blocked ${blockedActive ? 'rail-active' : ''}`}
          onClick={() => onSection(BLOCKED_SECTION_SLUG)}
          aria-current={blockedActive ? 'true' : undefined}
        >
          <span>Blocked</span>
          <span className="rail-blocked-step">{returnStep ?? 'status'}</span>
        </button>
      )}
      <button
        className={`rail-item rail-dependencies ${dependencyActive ? 'rail-active' : ''}`}
        onClick={() => onSection(DEPENDENCIES_SECTION_SLUG)}
        aria-current={dependencyActive ? 'true' : undefined}
      >
        <span>Dependencies</span>
        <span className="rail-dependency-count">{dependencyCount}</span>
      </button>
      {manualTasks.total > 0 && (
        <button
          className={`rail-item rail-manual-tasks ${active?.name === MANUAL_TASKS_FILE ? 'rail-active' : ''}`}
          onClick={() => onSection(artifactSlug(MANUAL_TASKS_FILE))}
          aria-current={active?.name === MANUAL_TASKS_FILE ? 'true' : undefined}
        >
          <ListChecks aria-hidden="true" />
          <span>Manual tasks</span>
          {manualTasks.pending > 0
            ? <span className="rail-manual-count">{manualTasks.pending}</span>
            : <span className="rail-manual-done" title="All done"><Check aria-hidden="true" /></span>}
        </button>
      )}
      {artifacts.every((artifact) => artifact.name.toLowerCase() === BLOCKED_ARTIFACT) && <p className="muted">No other documents yet.</p>}
      {groupArtifacts(artifacts, steps, skippedSteps).map((group) => {
        const expanded = group.label === null || (toggles[group.folder] ?? (group.folder === currentStep || group.folder === activeFolder))
        const skipChip = group.skipped && <span className="chip express rail-skip-chip">skipped ⚡ express</span>
        return (
          <Fragment key={group.folder === '' ? '(root)' : group.folder}>
            {group.label !== null && (
              // A header-only skipped group has nothing to toggle — render it
              // as a plain marker row instead of a button.
              group.items.length === 0 ? (
                <div className="rail-group-head rail-group-skipped">
                  <span className="rail-skip-label">{group.label}</span>
                  {skipChip}
                </div>
              ) : (
                <button
                  className={`rail-group-head${group.skipped ? ' rail-group-skipped' : ''}`}
                  onClick={() => setToggles((t) => ({ ...t, [group.folder]: !expanded }))}
                  aria-expanded={expanded}
                >
                  {group.skipped ? <span className="rail-skip-label">{group.label}</span> : group.label}
                  {skipChip}
                  <ChevronRight className={`rail-chevron ${expanded ? 'rail-chevron-open' : ''}`} aria-hidden="true" />
                </button>
              )
            )}
            {expanded && group.items.map(({ artifact, index }) => {
              const { ordinal, title } = sectionLabel(artifact.name)
              return (
                <button
                  key={artifact.name}
                  className={`rail-item ${!blockedActive && !dependencyActive && index === activeIndex ? 'rail-active' : ''}`}
                  onClick={() => onSection(artifactSlug(artifact.name))}
                  aria-current={!blockedActive && !dependencyActive && index === activeIndex ? 'true' : undefined}
                >
                  {ordinal !== null && <span className="rail-ordinal">{ordinal}</span>}
                  {title}
                </button>
              )
            })}
          </Fragment>
        )
      })}
    </nav>
  )
}
