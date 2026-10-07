import { describe, expect, it } from 'vitest'

import { groupManualSkills } from '../src/components/ManualModal'
import type { ManualSkill } from '../src/types'

function skill(key: string): ManualSkill {
  return {
    key,
    command: `/${key}`,
    name: key,
    summary: `${key} summary`,
    description: `${key} description`,
  }
}

describe('manual skill groups', () => {
  it('separates dashboard and project-local skills while preserving source order', () => {
    const result = groupManualSkills([
      skill('flow:idea'),
      skill('bl-blog'),
      skill('flow:review'),
      skill('flow-add-test'),
    ], 'flow')

    expect(result.dashboard.map(({ key }) => key)).toEqual(['flow:idea', 'flow:review'])
    expect(result.project.map(({ key }) => key)).toEqual(['bl-blog', 'flow-add-test'])
  })

  it('returns two empty groups for an empty manual', () => {
    expect(groupManualSkills([])).toEqual({ dashboard: [], project: [] })
  })

  it('groups by the installed prefix and leaves other namespaces project-local', () => {
    const result = groupManualSkills([skill('custom:idea'), skill('other:idea')], 'custom')
    expect(result.dashboard.map(({ key }) => key)).toEqual(['custom:idea'])
    expect(result.project.map(({ key }) => key)).toEqual(['other:idea'])
    expect(groupManualSkills([skill('lfad:idea')]).dashboard).toHaveLength(1)
  })
})
