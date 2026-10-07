/**
 * Pure type definitions for @lfad/core — no runtime values here.
 */

/**
 * A ticket status: any board-configured step key, plus the system holding
 * statuses. Step keys are per-board data, so the type remains open.
 */
export type Step = 'blocked' | 'parked' | (string & {})

/** Ticket category classifying the nature of the work. */
export type Category = 'ui' | 'bug' | 'logic' | 'business' | 'refactor' | 'hotfix'

/** How much automation a ticket allows: 'express' lets the agent fast-pass
 *  unnecessary steps, 'manual' excludes it from batch runs. */
export type AutomationLevel = 'normal' | 'express' | 'manual'

/** Per-step applicability judgment recorded by the agent. */
export interface StepNote {
  applicable: boolean
  reason?: string
}

/** One entry in a ticket's movement history. */
export interface HistoryEntry {
  step: Step
  at: string // ISO 8601
}

/** Stable prerequisite milestones supported by dependency edges. */
export type DependencyMilestone = 'design-approved' | 'done' | 'archived'

/** A stage-scoped dependency edge persisted in ticket frontmatter. */
export interface DependencyEdge {
  ticketId: number
  blockAtStage: Step
  unblockWhen: DependencyMilestone
}

/** The live state of one dependency edge. */
export type DependencyEdgeState = 'unmet' | 'satisfied' | 'invalid'

/** Resolved prerequisite metadata carried to runtime/UI consumers. */
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

/** Dependency state at the ticket's next pipeline boundary. */
export interface DependencyEvaluation {
  edges: EvaluatedDependency[]
  held: boolean
  heldAt?: Step
  resumesAt?: Step
  blockingTicketIds: number[]
}

/**
 * The full ticket record — mirrors the YAML frontmatter in ticket.md exactly.
 * `status` ALWAYS matches the step folder the ticket physically lives in.
 */
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
  /** Path or branch string set at the Todo→Doing boundary. */
  worktree?: string
  /** Claude Agent SDK session id for resume/fork. */
  sessionId?: string
  /** Present if and only if status is blocked or parked; records the origin step. */
  returnStep?: Step
  /** Canonical stage-scoped dependency edges. */
  dependencies?: DependencyEdge[]
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  history: HistoryEntry[]
  stepNotes?: Partial<Record<Step, StepNote>>
  /**
   * Present (as `true`) only on degraded entries synthesized by board listings
   * when a ticket folder's `ticket.md` cannot be read or parsed (a hand edit
   * gone wrong): id + slug come from the folder name, `status` is the step
   * folder the ticket physically sits in, and the other fields are safe
   * placeholders. Never persisted to frontmatter — mutations on such an id
   * still throw when they re-read the broken file.
   */
  unreadable?: true
  /** Present only with `unreadable`: the read/parse error message. */
  unreadableError?: string
  /**
   * Unknown frontmatter keys preserved verbatim across read→write round-trips
   * (the Obsidian door-keeper: user- or tool-added keys are never dropped).
   * Serialized flat into the frontmatter after the canonical keys — never as a
   * literal `extras:` map. Absent when the frontmatter has no unknown keys.
   */
  extras?: Record<string, unknown>
}

/** Input accepted by createTicket(). */
export interface CreateTicketInput {
  title: string
  category: Category
  body?: string
  tags?: string[]
  needsDesign?: boolean
  /** Which step the ticket enters at; defaults to the board's first `entry: true` step (else the first step). */
  entryStep?: Step
}

/** Options accepted by moveTicket(). */
export interface MoveOpts {
  reason?: string
  actor?: string
}

/** A single validation finding returned by validateTicket(). */
export interface Issue {
  field: string
  message: string
}
