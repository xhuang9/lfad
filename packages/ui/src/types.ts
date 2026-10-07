// Local HTTP wire types mirroring the @lfad/core Ticket/Step shapes.
// Cross-package feature contracts such as staged builds are re-exported from
// core so their persisted shape has one authoritative definition.

import type { BuildStage, BuildStages } from '@lfad/core'

export type { BuildStage, BuildStages }

/** A step/status key. Steps are configured per board in `board.yml`, so this is
 *  an open string (the reserved `blocked` lane is always present too). */
export type Step = string

/** Engine classification of a step, mirrored from board.yml `type`. */
export type StepType = 'agent' | 'gate' | 'queue' | 'terminal'

/** Which board row a step renders in. */
export type StepRow = 'agents' | 'needs-you'

export type Category = 'ui' | 'bug' | 'logic' | 'business' | 'refactor' | 'hotfix'

/** How much automation a ticket allows: 'express' lets the agent fast-pass
 *  unnecessary steps, 'manual' excludes it from batch runs. */
export type AutomationLevel = 'normal' | 'express' | 'manual'

export interface HistoryEntry {
  step: Step
  at: string
}

export interface StepNote {
  applicable: boolean
  reason?: string
}

export type DependencyMilestone = 'design-approved' | 'done' | 'archived'
export type DependencyEdgeState = 'unmet' | 'satisfied' | 'invalid'

export interface DependencyEdge {
  ticketId: number
  blockAtStage: Step
  unblockWhen: DependencyMilestone
}

export interface EvaluatedDependency extends DependencyEdge {
  state: DependencyEdgeState
  prerequisite?: {
    id: number
    title: string
    status: Step
    archived: boolean
  }
  reason?: string
}

export interface DependencyEvaluation {
  edges: EvaluatedDependency[]
  held: boolean
  heldAt?: Step
  resumesAt?: Step
  blockingTicketIds: number[]
}

/** One board-level keyword entry, in display/priority order. */
export interface ProjectKeyword {
  word: string
  color: string
}

/** Project keyword registry stored in the board's settings JSON. */
export interface KeywordSettings {
  maxShown: number
  items: ProjectKeyword[]
}

/** A wording change optionally propagated to active ticket tags. */
export interface KeywordRename {
  from: string
  to: string
}

export interface Ticket {
  id: number
  slug: string
  title: string
  status: Step
  category: Category
  tags: string[]
  needsDesign?: boolean
  /** Per-ticket automation level; absent = 'normal'. */
  automationLevel?: AutomationLevel
  worktree?: string
  sessionId?: string
  returnStep?: Step
  dependencies?: DependencyEdge[]
  /** Runtime-computed dependency state; the UI never evaluates the graph. */
  dependencyState?: DependencyEvaluation
  createdAt: string
  updatedAt: string
  history: HistoryEntry[]
  stepNotes?: Partial<Record<Step, StepNote>>
  /** Count of open question inputs across the ticket's artifacts. */
  openInputs?: number
  /** Compact cross-cutting manual-task aggregate on board-list payloads. */
  manualTasks?: ManualTaskCounts
  /** True on degraded entries: the folder's ticket.md could not be read/parsed
   *  (id + slug come from the folder name; fix the file on disk). */
  unreadable?: boolean
  /** Present only with `unreadable`: the server-side read/parse error message. */
  unreadableError?: string
  /** Ephemeral daemon lease projection; absent when no official session holds a claim. */
  running?: { count: number, since: string }
  /** Unknown frontmatter keys the server round-trips verbatim. */
  extras?: { buildStages?: BuildStages, clarityPercent?: number } & Record<string, unknown>
}

/** One step as exposed by GET /api/steps (board-column order). */
export interface StepPayload {
  key: Step
  label: string
  /** Folder name on disk — identical to `key` (`blocked` for the blocked lane). */
  folder: string
  /** True only for the blocked lane; drives its special column rendering. */
  lateral: boolean
  type: StepType
  row: StepRow
  /** 0-based position in the configured pipeline; header renders `${position}-${key}`. */
  position: number
  /** Tickets may be created directly into this step. */
  entry: boolean
  /** The skill bound to this step — drives the drawer's run-action buttons. */
  skill?: string
  /** Skills that can process a ticket sitting here — the drawer's buttons, in order. */
  actions?: string[]
  /** Free-form per-step guidance from board.yml. */
  guidance?: string
  /** Ticket frontmatter flag gating this step: the step applies only to tickets
   *  whose flag (a top-level field like `needsDesign`, or a custom flag in
   *  `extras`) is truthy — the wire mirror of core's `nextStep` skip rule. */
  skipUnless?: string
}

/** The GET /api/steps payload: the column list plus board-level guidance. */
export interface BoardSteps {
  steps: StepPayload[]
  /** Free-form board-level guidance from board.yml. */
  guidance?: string
}

/** One markdown artifact returned by GET /api/tickets/:id. */
export interface Artifact {
  name: string
  content: string
}

export interface ManualTaskCounts {
  total: number
  pending: number
}

/** One valid fenced task parsed from the root `manual-tasks.md` artifact. */
export interface ManualTaskInfo {
  file: 'manual-tasks.md'
  id: string
  service: string
  title: string
  goal: string
  steps: string[]
  done: boolean
  sourceIndex: number
  /** 0-based source line containing `done: true|false`. */
  doneLine: number
}

/**
 * The structured answer shapes a fenced question block may declare. Legacy
 * `choice` / `confirm` normalize to `option` / `approve` on the server, so the
 * UI only ever sees these canonical values.
 */
export type QuestionType = 'approve' | 'option' | 'multi' | 'text'

/** One question (open or answered) found in a ticket artifact. */
export interface QuestionInfo {
  /** Artifact name the question lives in (matches `Artifact.name`; `Idea` = ticket body). */
  file: string
  id?: string
  ask?: string
  type?: QuestionType
  options?: string[]
  /** `approve` only: render a single Approve button (no Reject). */
  single?: boolean
  /** Markdown between the previous question and this one — rendered above the form. */
  context?: string
  /** True when the Decision line is empty — the question still needs an answer. */
  open: boolean
  /** 0-based line index of the `**Decision:**` line in the artifact, for targeted rewrites. */
  decisionLine: number
}

export interface TicketDetail {
  ticket: Ticket
  artifacts: Artifact[]
  dependencyState: DependencyEvaluation
  inferredDependencyBoundary: Step
  openInputs: number
  questions: QuestionInfo[]
  manualTasks: ManualTaskInfo[]
}

/** Card left-border accent per category. */
export const CATEGORY_COLORS: Record<Category, string> = {
  ui: '#3b82f6',
  bug: '#ef4444',
  logic: '#8b5cf6',
  business: '#f59e0b',
  refactor: '#10b981',
  hotfix: '#ec4899',
}

/** Accessible solid-badge treatment shared by board cards and the drawer.
 *  Kept separate from CATEGORY_COLORS because those brighter accents are also
 *  used by surfaces outside the card system. */
export const CATEGORY_BADGES: Record<Category, { label: string, fill: string, ink: string }> = {
  ui: { label: 'UI', fill: '#356fce', ink: '#ffffff' },
  bug: { label: 'Bug', fill: '#c93c3c', ink: '#ffffff' },
  logic: { label: 'Logic', fill: '#7750ce', ink: '#ffffff' },
  business: { label: 'Business', fill: '#f59e0b', ink: '#141007' },
  refactor: { label: 'Refactor', fill: '#10b981', ink: '#04130d' },
  hotfix: { label: 'Hotfix', fill: '#c64082', ink: '#ffffff' },
}

export const CATEGORIES: Category[] = ['ui', 'bug', 'logic', 'business', 'refactor', 'hotfix']

/** One skill in the in-app manual (mirrors the daemon's GET /api/manual). */
export interface ManualSkill {
  /** Matches a step's `skill` binding — `flow:idea` (plugin) or `flow-add-test`. */
  key: string
  command: string
  name: string
  summary: string
  description: string
}

/** One board capability in the manual. */
export interface ManualAction {
  label: string
  detail: string
}

export interface Manual {
  skillPrefix: string
  skills: ManualSkill[]
  actions: ManualAction[]
  /** Free-form board-level guidance from board.yml. */
  guidance?: string
}
