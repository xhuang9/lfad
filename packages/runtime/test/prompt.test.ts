import type { StepConfig, Ticket } from '@lfad/core'
import { describe, expect, it } from 'vitest'

import { buildStepPrompt } from '../src/prompt.js'
import type { RunConfig } from '../src/run-config.js'

const now = '2026-10-07T00:00:00.000Z'
const ticket: Ticket = {
  id: 1,
  slug: 'test',
  title: 'Test',
  status: 'doing',
  category: 'logic',
  tags: [],
  createdAt: now,
  updatedAt: now,
  history: [{ step: 'doing', at: now }],
}
const step: StepConfig = { key: 'doing', label: 'Doing', type: 'agent', row: 'agents' }
const cfg: RunConfig = { dryRun: true, autopilot: false, timeoutMs: 1000, killGraceMs: 2000 }

describe('installed skill prefix in agent prompts', () => {
  it.each(['flow', 'lfad'])('resolves %s step bindings to the installed plugin', (prefix) => {
    const prompt = buildStepPrompt(ticket, [], 'doing', { ...step, skill: `${prefix}:build` }, cfg, { skillPrefix: 'custom' })
    expect(prompt).toContain('Invoke the Skill "custom:build"')
    expect(prompt).not.toContain(`${prefix}:build`)
  })

  it.each(['flow', 'lfad'])('resolves %s action overrides consistently', (prefix) => {
    const prompt = buildStepPrompt(ticket, [], 'doing', { ...step, skill: 'project:build' }, cfg, {
      skillPrefix: 'custom',
      skillOverride: `${prefix}:next`,
    })
    expect(prompt).toContain('Invoke the Skill "custom:next"')
    expect(prompt).toContain('This run executes the "custom:next" action')
    expect(prompt).not.toContain(`${prefix}:next`)
    expect(prompt).not.toContain('project:build')
  })

  it.each(['project:build', 'custom:build', 'build'])('preserves %s bindings outside the legacy/default prefixes', (skill) => {
    const prompt = buildStepPrompt(ticket, [], 'doing', { ...step, skill }, cfg, { skillPrefix: 'custom' })
    expect(prompt).toContain(`Invoke the Skill "${skill}"`)
  })

  it('preserves bindings when no installed prefix is supplied', () => {
    expect(buildStepPrompt(ticket, [], 'doing', { ...step, skill: 'flow:build' }, cfg))
      .toContain('Invoke the Skill "flow:build"')
  })
})
