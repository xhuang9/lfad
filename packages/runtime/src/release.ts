export interface ReleaseCommit {
  type: string | null
  scope: string | null
  breaking: boolean
  subject: string
  ref: string | null
}

const CONVENTIONAL_COMMIT = /^([a-z][a-z0-9-]*)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i
const ISSUE_REF = /\s+\(#(\d+)\)$/

/** Parse newline-delimited git log entries in reverse-chronological order. */
export function parseCommits(rawLog: string): ReleaseCommit[] {
  const entries: ReleaseCommit[] = []

  for (const rawLine of rawLog.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^BREAKING[ -]CHANGE:/i.test(line) && entries.length > 0) {
      entries[entries.length - 1]!.breaking = true
      continue
    }

    const match = CONVENTIONAL_COMMIT.exec(line)
    if (!match) {
      entries.push({ type: null, scope: null, breaking: false, subject: line, ref: null })
      continue
    }

    let subject = match[4]!
    const refMatch = ISSUE_REF.exec(subject)
    const ref = refMatch?.[1] ?? null
    if (refMatch) subject = subject.slice(0, refMatch.index)

    entries.push({
      type: match[1]!.toLowerCase(),
      scope: match[2] ?? null,
      breaking: Boolean(match[3]),
      subject,
      ref,
    })
  }

  return entries
}

/** Compute the next semver using Conventional Commits precedence. */
export function computeNextVersion(entries: ReleaseCommit[], current: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current)
  if (!match) throw new Error(`Invalid semantic version: ${current}`)

  let major = Number(match[1])
  let minor = Number(match[2])
  let patch = Number(match[3])

  if (entries.some(entry => entry.breaking)) {
    major += 1
    minor = 0
    patch = 0
  } else if (entries.some(entry => entry.type === 'feat')) {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }

  return `${major}.${minor}.${patch}`
}

/** Render one Keep a Changelog release section. */
export function renderChangelogSection(version: string, dateISO: string, entries: ReleaseCommit[]): string {
  const groups = [
    { heading: 'Added', entries: entries.filter(entry => entry.type === 'feat') },
    { heading: 'Changed', entries: entries.filter(entry => entry.type !== 'feat' && entry.type !== 'fix') },
    { heading: 'Fixed', entries: entries.filter(entry => entry.type === 'fix') },
  ]

  const sections = groups
    .filter(group => group.entries.length > 0)
    .map(group => {
      const bullets = group.entries.map(entry => `- ${entry.subject}${entry.ref ? ` (#${entry.ref})` : ''}`)
      return `### ${group.heading}\n\n${bullets.join('\n')}`
    })

  return `## [${version}] - ${dateISO}\n\n${sections.join('\n\n')}\n`
}
