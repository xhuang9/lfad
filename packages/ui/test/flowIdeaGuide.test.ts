import { describe, expect, it } from 'vitest'

import { flowIdeaCommand } from '../src/components/FlowIdeaGuide'

describe('flow:idea command', () => {
  it('uses the Claude Code prefix', () => {
    expect(flowIdeaCommand('/')).toBe('/lfad:idea')
  })

  it('uses the Codex prefix', () => {
    expect(flowIdeaCommand('$')).toBe('$lfad:idea')
  })

  it('uses the installed plugin prefix with either command prefix', () => {
    expect(flowIdeaCommand('/', 'custom')).toBe('/custom:idea')
    expect(flowIdeaCommand('$', 'flow')).toBe('$flow:idea')
  })
})
