// Thin client over the daemon HTTP API. Every call uses a relative `/api/...`
// path so the same bundle works whether it is served by the daemon (production)
// or behind the Vite dev proxy.

import type { AutomationLevel, BoardSteps, Category, DependencyEdge, KeywordRename, KeywordSettings, Manual, Step, Ticket, TicketDetail } from './types'
import type { PromptTemplates } from './prompts'
import { DEFAULT_SKILL_PREFIX } from './commands'

export type CommandPrefix = '/' | '$'

let skillPrefix = DEFAULT_SKILL_PREFIX
const skillPrefixListeners = new Set<() => void>()

export function getSkillPrefixSnapshot(): string {
  return skillPrefix
}

export function subscribeSkillPrefix(listener: () => void): () => void {
  skillPrefixListeners.add(listener)
  return () => skillPrefixListeners.delete(listener)
}

let commandPrefix: CommandPrefix = '/'
const commandPrefixListeners = new Set<() => void>()

function publishCommandPrefix(prefix: CommandPrefix): void {
  commandPrefix = prefix
  commandPrefixListeners.forEach((listener) => listener())
}

export function getCommandPrefixSnapshot(): CommandPrefix {
  return commandPrefix
}

export function subscribeCommandPrefix(listener: () => void): () => void {
  commandPrefixListeners.add(listener)
  return () => commandPrefixListeners.delete(listener)
}

/** Loads the daemon-owned board setting. Older daemons 404, leaving the safe `/` default. */
export async function loadCommandPrefix(): Promise<CommandPrefix> {
  const result = await jsonFetch<{ prefix: CommandPrefix }>('/api/settings/command-prefix')
  publishCommandPrefix(result.prefix)
  return result.prefix
}

export async function setCommandPrefix(prefix: CommandPrefix): Promise<CommandPrefix> {
  const result = await jsonFetch<{ prefix: CommandPrefix }>('/api/settings/command-prefix', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefix }),
  })
  publishCommandPrefix(result.prefix)
  return result.prefix
}

/** The board layout setting — one value driving both board arrangement and
 *  drawer edge. `auto` resolves from the viewport shape; the two explicit
 *  values force landscape/portrait (with a silent narrow fallback). */
export type BoardLayout = 'auto' | 'landscape' | 'portrait'

let boardLayout: BoardLayout = 'auto'
const boardLayoutListeners = new Set<() => void>()

function publishBoardLayout(layout: BoardLayout): void {
  boardLayout = layout
  boardLayoutListeners.forEach((listener) => listener())
}

export function getBoardLayoutSnapshot(): BoardLayout {
  return boardLayout
}

export function subscribeBoardLayout(listener: () => void): () => void {
  boardLayoutListeners.add(listener)
  return () => boardLayoutListeners.delete(listener)
}

/** Loads the daemon-owned layout setting. Older daemons 404, leaving the safe `auto` default. */
export async function loadBoardLayout(): Promise<BoardLayout> {
  const result = await jsonFetch<{ layout: BoardLayout }>('/api/settings/layout')
  publishBoardLayout(result.layout)
  return result.layout
}

export async function setBoardLayout(layout: BoardLayout): Promise<BoardLayout> {
  const result = await jsonFetch<{ layout: BoardLayout }>('/api/settings/layout', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ layout }),
  })
  publishBoardLayout(result.layout)
  return result.layout
}

export function getKeywordSettings(): Promise<KeywordSettings> {
  return jsonFetch<{ keywords: KeywordSettings }>('/api/settings/keywords').then((result) => result.keywords)
}

export function setKeywordSettings(
  keywords: KeywordSettings,
  renames: KeywordRename[],
  propagate: boolean,
): Promise<{ keywords: KeywordSettings, updatedTickets: number[] }> {
  return jsonFetch<{ keywords: KeywordSettings, updatedTickets: number[] }>('/api/settings/keywords', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keywords, renames, propagate }),
  })
}

export function getPromptTemplates(): Promise<PromptTemplates> {
  return jsonFetch<{ prompts: PromptTemplates }>('/api/settings/prompts').then((result) => result.prompts)
}

export function setPromptTemplates(prompts: PromptTemplates): Promise<PromptTemplates> {
  return jsonFetch<{ prompts: PromptTemplates }>('/api/settings/prompts', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompts }),
  }).then((result) => result.prompts)
}

/** Error carrying the HTTP status so callers can branch (e.g. 409 conflicts). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // non-JSON error body; keep the status-based message
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

/** The step list plus the board-level guidance from board.yml. */
export function getSteps(): Promise<BoardSteps> {
  return jsonFetch<BoardSteps>('/api/steps')
}

export function getBoard(): Promise<Ticket[]> {
  return jsonFetch<{ tickets: Ticket[] }>('/api/board').then((r) => r.tickets)
}

/** Runtime/install metadata. Older daemons omit `version`, so callers must
 *  treat it as optional while an updated UI is waiting for a restart. */
export function getInfo(): Promise<{ version?: string }> {
  return jsonFetch<{ version?: string }>('/api/info')
}

/** Every ticket in the `_archive` cold store (browse-only; same shape as getBoard). */
export function getArchive(): Promise<Ticket[]> {
  return jsonFetch<{ tickets: Ticket[] }>('/api/archive').then((r) => r.tickets)
}

/** Every ticket in the resumable parked holding store. */
export function getParked(): Promise<Ticket[]> {
  return jsonFetch<{ tickets: Ticket[] }>('/api/parked').then((r) => r.tickets)
}

export function parkTicket(id: number): Promise<Ticket> {
  return jsonFetch<{ ticket: Ticket }>(`/api/tickets/${id}/park`, { method: 'POST' }).then((r) => r.ticket)
}

export function unparkTicket(id: number): Promise<Ticket> {
  return jsonFetch<{ ticket: Ticket }>(`/api/tickets/${id}/unpark`, { method: 'POST' }).then((r) => r.ticket)
}

export function getTicket(id: number): Promise<TicketDetail> {
  return jsonFetch<TicketDetail>(`/api/tickets/${id}`)
}

/** Replaces the complete dependency edge set and returns refreshed detail. */
export function updateDependencies(id: number, dependencies: DependencyEdge[]): Promise<TicketDetail> {
  return jsonFetch<TicketDetail>(`/api/tickets/${id}/dependencies`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dependencies }),
  })
}

/** Overwrites one artifact (the `Idea` body, or a `*.md` file) and returns the
 *  refreshed ticket detail. Passing `baseContent` (the content the rewrite was
 *  derived from) makes the write conditional — the daemon rejects it with a 409
 *  when the artifact changed in between, instead of silently overwriting. */
export function updateArtifact(id: number, name: string, content: string, baseContent?: string): Promise<TicketDetail> {
  return jsonFetch<TicketDetail>(`/api/tickets/${id}/artifact`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(baseContent !== undefined ? { name, content, baseContent } : { name, content }),
  })
}

/** Uploads a pasted image beside `file` (the artifact it belongs to) and returns
 *  the relative `files/<name>` ref to insert into that artifact's markdown. */
export function uploadTicketImage(id: number, file: string, blob: Blob): Promise<{ ref: string }> {
  return jsonFetch<{ ref: string }>(`/api/tickets/${id}/files?file=${encodeURIComponent(file)}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
}

export interface NewTicketInput {
  title: string
  category: Category
  body?: string
  tags?: string[]
  needsDesign?: boolean
  entryStep?: Step
}

export function createTicket(input: NewTicketInput): Promise<Ticket> {
  return jsonFetch<{ ticket: Ticket }>('/api/tickets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => r.ticket)
}

export function moveTicket(id: number, toStep: Step, reason?: string): Promise<Ticket> {
  return jsonFetch<{ ticket: Ticket }>(`/api/tickets/${id}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reason !== undefined ? { toStep, reason } : { toStep }),
  }).then((r) => r.ticket)
}

/** Sets the ticket's automation level (frontmatter `automationLevel`; absent = 'normal'). */
export function setAutomationLevel(id: number, level: AutomationLevel): Promise<Ticket> {
  return jsonFetch<{ ticket: Ticket }>(`/api/tickets/${id}/automation-level`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level }),
  }).then((r) => r.ticket)
}

/** Force-releases every ephemeral running claim held for a ticket. */
export function clearRunning(id: number): Promise<{ cleared: number }> {
  return jsonFetch<{ cleared: number }>(`/api/tickets/${id}/clear-running`, { method: 'POST' })
}

/** The in-app manual: skills (generated from the plugin) + board actions. */
export async function getManual(): Promise<Manual> {
  const manual = await jsonFetch<Manual>('/api/manual')
  skillPrefix = manual.skillPrefix ?? DEFAULT_SKILL_PREFIX
  skillPrefixListeners.forEach((listener) => listener())
  return manual
}

/** The raw SKILL.md body for a skill key (`flow:idea` / `flow-add-test`). */
export function getSkillBody(key: string): Promise<{ key: string, body: string }> {
  return jsonFetch<{ key: string, body: string }>(`/api/skills?key=${encodeURIComponent(key)}`)
}
