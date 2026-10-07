import { describe, expect, it } from 'vitest'

import { computeNextVersion, parseCommits, renderChangelogSection } from '../src/release.js'

describe('release helpers', () => {
  it('parses conventional and legacy commits', () => {
    expect(parseCommits('feat(ui): add filter (#44)\nupdate')).toEqual([
      { type: 'feat', scope: 'ui', breaking: false, subject: 'add filter', ref: '44' },
      { type: null, scope: null, breaking: false, subject: 'update', ref: null },
    ])
  })

  it('bumps minor when a feature is present', () => {
    expect(computeNextVersion(parseCommits('fix: repair\nfeat: add'), '0.1.0')).toBe('0.2.0')
  })

  it('bumps patch for fixes only', () => {
    expect(computeNextVersion(parseCommits('fix: repair'), '0.1.0')).toBe('0.1.1')
  })

  it.each(['feat!: replace API', 'feat: replace API\nBREAKING CHANGE: incompatible'])('bumps major for %s', raw => {
    expect(computeNextVersion(parseCommits(raw), '0.1.0')).toBe('1.0.0')
  })

  it('renders entries in their input order under the correct groups', () => {
    const rendered = renderChangelogSection('0.2.0', '2026-07-12', parseCommits([
      'fix: repair archive (#2)',
      'docs: explain releases',
      'update',
      'feat(ui): add filter (#44)',
    ].join('\n')))

    expect(rendered).toContain('### Added\n\n- add filter (#44)')
    expect(rendered).toContain('### Changed\n\n- explain releases\n- update')
    expect(rendered).toContain('### Fixed\n\n- repair archive (#2)')
    expect(rendered.indexOf('repair archive')).toBeGreaterThan(rendered.indexOf('update'))
  })
})
