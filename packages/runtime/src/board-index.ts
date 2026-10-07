/**
 * In-memory mirror of the live board: a `Map<id, Ticket>` rebuilt from
 * `core.readBoard()`. The HTTP layer reads from this index (never the disk
 * directly for board listings) so responses are fast and consistent; the
 * watcher keeps it fresh.
 */

import {
  evaluateDependencies,
  listArchive,
  listParked,
  readBoard,
  reconcileStatus,
  validateBuildStages,
  type BoardConfig,
  type DependencyEvaluation,
  type Ticket,
} from '@lfad/core'

import { readArtifacts } from './artifacts.js'
import { countManualTasks, parseTicketManualTasks, type ManualTaskCounts } from './manual-tasks.js'
import { countOpenInputs } from './questions.js'

/** Holds live pipeline tickets plus a separate parked collection. */
export class BoardIndex {
  #map = new Map<number, Ticket>()
  #parked = new Map<number, Ticket>()
  #openInputs = new Map<number, number>()
  #manualTasks = new Map<number, ManualTaskCounts>()
  #dependencies = new Map<number, DependencyEvaluation>()

  /**
   * @param boardRoot Absolute path to the board root the index reflects.
   * @param getConfig Live accessor for the board config (hot-reload safe).
   */
  constructor(
    private readonly boardRoot: string,
    private readonly getConfig: () => BoardConfig,
  ) {}

  /**
   * Replaces the index contents with a fresh read of the board from disk,
   * recounting each ticket's open inputs (unanswered Decision lines across
   * its artifacts) in the same pass.
   *
   * A reconcile pass runs first: any ticket whose frontmatter `status` does
   * not match the step folder it physically lives in (a torn move — crash or
   * write error between relocate's write and rename) is repaired with the
   * folder as the source of truth. The repair only writes on an actual
   * mismatch, so the watcher-triggered rebuild it causes converges after one
   * extra cycle instead of looping.
   */
  rebuild(): void {
    const config = this.getConfig()
    for (const repair of reconcileStatus(this.boardRoot, config)) {
      console.error(
        `[lfad] ticket ${repair.id}: frontmatter status '${repair.fromStatus}' did not match its step folder — repaired to '${repair.folder}' (folder wins)`,
      )
    }
    const next = new Map<number, Ticket>()
    const nextOpen = new Map<number, number>()
    const nextManual = new Map<number, ManualTaskCounts>()
    const tickets = readBoard(this.boardRoot, config)
    const parked = listParked(this.boardRoot, config)
    const archived = listArchive(this.boardRoot, config)
    const active = [...tickets, ...parked]
    const nextDependencies = new Map<number, DependencyEvaluation>()
    for (const ticket of tickets) {
      next.set(ticket.id, ticket)
      if (ticket.unreadable === true) {
        // Surface the corruption loudly (once per folder per rebuild) and skip
        // artifact/question parsing — a degraded entry has no readable spine,
        // so its open-input count is pinned to 0 instead of ever throwing.
        const folder = `${String(ticket.id).padStart(5, '0')}-${ticket.slug}`
        console.error(`[lfad] unreadable ticket.md in ${ticket.status}/${folder}: ${ticket.unreadableError ?? 'unknown error'} — fix it on disk`)
        nextOpen.set(ticket.id, 0)
        nextManual.set(ticket.id, { total: 0, pending: 0 })
        nextDependencies.set(ticket.id, { edges: [], held: false, blockingTicketIds: [] })
        continue
      }
      for (const issue of validateBuildStages(ticket.extras?.buildStages)) {
        console.warn(
          `[lfad] ticket ${ticket.id}: malformed extras.buildStages (${issue.field}: ${issue.message}) — marker preserved`,
        )
      }
      const artifacts = readArtifacts(this.boardRoot, config, ticket.id)
      nextOpen.set(ticket.id, countOpenInputs(artifacts))
      nextManual.set(ticket.id, countManualTasks(parseTicketManualTasks(artifacts)))
      nextDependencies.set(ticket.id, evaluateDependencies(ticket, active, archived, config))
    }
    this.#map = next
    this.#parked = new Map(parked.map((ticket) => [ticket.id, ticket]))
    this.#openInputs = nextOpen
    this.#manualTasks = nextManual
    this.#dependencies = nextDependencies
  }

  /** Cached open-input count for a ticket (0 for unknown ids). */
  openInputs(id: number): number {
    return this.#openInputs.get(id) ?? 0
  }

  /** Cached manual-task counts for a ticket (zeroes for unknown ids). */
  manualTasks(id: number): ManualTaskCounts {
    return this.#manualTasks.get(id) ?? { total: 0, pending: 0 }
  }

  /** Cached dependency projection for a live ticket. */
  dependencies(id: number): DependencyEvaluation | undefined {
    return this.#dependencies.get(id)
  }

  /** Returns every indexed ticket, sorted by ascending id. */
  all(): Ticket[] {
    return [...this.#map.values()].sort((a, b) => a.id - b.id)
  }

  /** Returns every parked ticket, sorted by ascending id. */
  parked(): Ticket[] {
    return [...this.#parked.values()].sort((a, b) => a.id - b.id)
  }

  /** Returns the indexed ticket with the given id, or `undefined` if absent. */
  get(id: number): Ticket | undefined {
    return this.#map.get(id)
  }
}
