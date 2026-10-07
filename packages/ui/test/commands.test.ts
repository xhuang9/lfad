import { afterEach, describe, expect, it, vi } from 'vitest'

import { pluginCommand, resolveSkillKey } from '../src/commands'
import { actionLabel } from '../src/components/TicketDrawer/components/DrawerActions'

afterEach(() => { vi.unstubAllGlobals() })

describe('plugin commands', () => {
  it('uses both command markers with an installed plugin prefix', () => {
    expect(pluginCommand('prompt', '/', 'custom')).toBe('/custom:prompt')
    expect(pluginCommand('next', '$', 'flow')).toBe('$flow:next')
    expect(pluginCommand('next', '/')).toBe('/lfad:next')
  })

  it('maps legacy and default bindings while preserving project-local skills', () => {
    expect(resolveSkillKey('flow:next', 'custom')).toBe('custom:next')
    expect(resolveSkillKey('lfad:next', 'flow')).toBe('flow:next')
    expect(resolveSkillKey('custom:next', 'custom')).toBe('custom:next')
    expect(resolveSkillKey('other:next', 'custom')).toBe('other:next')
    expect(resolveSkillKey('flow-add-test', 'custom')).toBe('flow-add-test')
  })

  it('uses the next-stage action label for any plugin namespace', () => {
    for (const skill of ['flow:next', 'lfad:next', 'custom:next']) {
      expect(actionLabel(skill, 'Next: Review')).toBe('Next: Review')
    }
    expect(actionLabel('project-test', 'Next: Review')).toBe('project-test')
  })

  it('publishes the server prefix when the manual loads', async () => {
    vi.resetModules()
    const api = await import('../src/api')
    expect(api.getSkillPrefixSnapshot()).toBe('lfad')
    const listener = vi.fn()
    const unsubscribe = api.subscribeSkillPrefix(listener)
    const manual = { skillPrefix: 'custom', skills: [], actions: [] }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(manual))))
    expect(await api.getManual()).toEqual(manual)
    expect(api.getSkillPrefixSnapshot()).toBe('custom')
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    await api.getManual()
    expect(listener).toHaveBeenCalledOnce()
  })
})
