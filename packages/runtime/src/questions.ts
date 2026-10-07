/**
 * Question-block parsing over ticket artifacts (product spec, doc-52).
 *
 * A question is a fenced code block with info string `question` holding YAML
 * fields (`id` / `ask` / `type` / `options`), followed — within the next few
 * non-blank lines after the closing fence — by a markdown line starting
 * `**Decision:**`. An empty Decision line (nothing but whitespace after the
 * colon) is an OPEN input; text after it means answered. Bare `**Decision:**`
 * lines with no preceding question fence also count (compat with existing
 * plan docs), open or answered by the same rule. A fence whose YAML fails to
 * parse degrades to a bare-Decision question; a fence with no Decision line
 * in reach is not an input at all.
 *
 * Pure string work — no I/O; the caller supplies artifact name + content.
 */

import { parse as parseYaml } from 'yaml'

import type { Artifact } from './artifacts.js'

/**
 * The structured answer shapes a fenced block may declare:
 * - `approve` — Approve / Reject sign-off (single-button with `single: true`)
 * - `option`  — pick exactly one of `options` (radio)
 * - `multi`   — pick any of `options` (checkbox); answer joins with ", "
 * - `text`    — free text
 * Legacy aliases normalize on parse: `choice` → `option`, `confirm` → `approve`.
 */
export type QuestionType = 'approve' | 'option' | 'multi' | 'text'

/** One question (open or answered) found in a ticket artifact. */
export interface QuestionInfo {
  /** Artifact name the question lives in (e.g. 'plan/01-x.md' or 'Idea'). */
  file: string
  id?: string
  ask?: string
  type?: QuestionType
  options?: string[]
  /** `approve` only: render a single Approve button (no Reject). */
  single?: boolean
  /** Markdown between the previous question and this one, trimmed (UI inlines it above the form). */
  context?: string
  /** True when the Decision line is empty — the question still needs an answer. */
  open: boolean
  /** 0-based line index of the `**Decision:**` line in the artifact, for targeted rewrites. */
  decisionLine: number
}

/** Matches a `**Decision:**` markdown line, capturing everything after the marker. */
const DECISION_RE = /^\*\*Decision:\*\*(.*)$/

/** Matches a fence-open line, capturing the fence characters and the info string. */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/

/** How many non-blank lines after a closing fence may separate it from its Decision line. */
const DECISION_REACH = 3

/** True when the line closes a fence opened with `fence` (same char, >= length, nothing else). */
function closesFence(line: string, fence: string): boolean {
  const trimmed = line.trimEnd()
  const char = fence[0]!
  if (!trimmed.startsWith(fence)) return false
  return [...trimmed].every((c) => c === char)
}

/** Coerce an unknown YAML scalar to a string (numbers/booleans stringify; else undefined). */
function asOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/** Structured fields extracted from a question fence's YAML, or `undefined` on malformed YAML. */
interface QuestionFields {
  id?: string
  ask?: string
  type?: QuestionType
  options?: string[]
  single?: boolean
}

/** Canonical answer shape for a declared `type`, folding in the legacy aliases. */
const TYPE_ALIASES: Record<string, QuestionType> = {
  approve: 'approve',
  option: 'option',
  multi: 'multi',
  text: 'text',
  choice: 'option',
  confirm: 'approve',
}

/** Parses the YAML inside a question fence into structured fields; `undefined` = degrade to bare. */
function parseQuestionYaml(yamlText: string): QuestionFields | undefined {
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const fields: QuestionFields = {}
  const id = asOptionalString(record.id)
  if (id !== undefined) fields.id = id
  const ask = asOptionalString(record.ask)
  if (ask !== undefined) fields.ask = ask
  const rawType = asOptionalString(record.type)
  if (rawType !== undefined && TYPE_ALIASES[rawType] !== undefined) {
    fields.type = TYPE_ALIASES[rawType]
  }
  if (Array.isArray(record.options)) {
    fields.options = record.options
      .map(asOptionalString)
      .filter((o): o is string => o !== undefined)
  }
  if (record.single === true) fields.single = true
  return fields
}

/**
 * Finds the `**Decision:**` line for a fence closed at line `fenceClose`:
 * blank lines are skipped and up to {@link DECISION_REACH} non-blank lines are
 * examined. Returns its 0-based index, or `undefined` when out of reach.
 */
function findDecisionLine(lines: string[], fenceClose: number): number | undefined {
  let seen = 0
  for (let i = fenceClose + 1; i < lines.length && seen < DECISION_REACH; i += 1) {
    if (lines[i]!.trim() === '') continue
    if (DECISION_RE.test(lines[i]!)) return i
    seen += 1
  }
  return undefined
}

/**
 * Parses every question (fenced + bare-Decision) out of one artifact, in
 * document order. Decision lines inside non-question code fences are ignored.
 */
export function parseQuestions(artifactName: string, content: string): QuestionInfo[] {
  const lines = content.split('\n')
  const questions: QuestionInfo[] = []
  // Start of the current context segment: just after the previous question's
  // Decision line (or the file start).
  let segmentStart = 0

  /** The trimmed markdown between `segmentStart` and `end` (exclusive), or undefined when empty. */
  const contextUpTo = (end: number): string | undefined => {
    const text = lines.slice(segmentStart, end).join('\n').trim()
    return text.length > 0 ? text : undefined
  }

  const pushQuestion = (
    decisionLine: number,
    contextEnd: number,
    fields: QuestionFields | undefined,
  ): void => {
    const rest = DECISION_RE.exec(lines[decisionLine]!)![1]!
    const context = contextUpTo(contextEnd)
    questions.push({
      file: artifactName,
      ...(fields?.id !== undefined ? { id: fields.id } : {}),
      ...(fields?.ask !== undefined ? { ask: fields.ask } : {}),
      ...(fields?.type !== undefined ? { type: fields.type } : {}),
      ...(fields?.options !== undefined ? { options: fields.options } : {}),
      ...(fields?.single ? { single: true } : {}),
      ...(context !== undefined ? { context } : {}),
      open: rest.trim() === '',
      decisionLine,
    })
    segmentStart = decisionLine + 1
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fenceOpen = FENCE_OPEN_RE.exec(line)
    if (fenceOpen !== null) {
      const fence = fenceOpen[1]!
      const info = fenceOpen[2]!
      // Find the closing fence; an unterminated fence swallows the rest of the file.
      let close = -1
      for (let j = i + 1; j < lines.length; j += 1) {
        if (closesFence(lines[j]!, fence)) {
          close = j
          break
        }
      }
      if (close === -1) break // unterminated fence: nothing after it is markdown
      if (info === 'question') {
        const decisionLine = findDecisionLine(lines, close)
        if (decisionLine !== undefined) {
          // Malformed YAML degrades to a bare-Decision question (no structured fields).
          const fields = parseQuestionYaml(lines.slice(i + 1, close).join('\n'))
          pushQuestion(decisionLine, i, fields)
          i = decisionLine + 1
          continue
        }
        // A question fence with no Decision line in reach is not an input.
      }
      // Skip past any fenced block so Decision text inside code samples never matches.
      i = close + 1
      continue
    }
    if (DECISION_RE.test(line)) {
      // Bare Decision line (no preceding question fence) — compat format.
      pushQuestion(i, i, undefined)
      i += 1
      continue
    }
    i += 1
  }
  return questions
}

/** Parses the questions of every artifact of a ticket, in rail order. */
export function parseTicketQuestions(artifacts: Artifact[]): QuestionInfo[] {
  return artifacts.flatMap((artifact) => parseQuestions(artifact.name, artifact.content))
}

/** Number of OPEN inputs (unanswered Decision lines) across a ticket's artifacts. */
export function countOpenInputs(artifacts: Artifact[]): number {
  return parseTicketQuestions(artifacts).filter((q) => q.open).length
}
