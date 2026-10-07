import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  existsSync: (path: string) => files.has(path),
  readFileSync: (path: string) => {
    if (!files.has(path)) throw new Error('Unreadable file')
    return files.get(path)!
  },
  readdirSync: (path: string) => [...files.keys()]
    .filter((file) => file.startsWith(`${path}/`) && file.endsWith('/SKILL.md'))
    .map((file) => file.slice(path.length + 1).split('/')[0]),
}))

import { findFlowPluginDir, pluginPrefix, readManual, readSkillBody } from '../src/manual.js'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const plugin = resolve(root, 'plugins/lfad')
const skills = resolve(plugin, 'skills')
const manifest = resolve(plugin, '.claude-plugin/plugin.json')
const body = '---\nname: example\ndescription: An example skill.\n---\nPlugin body\n'

beforeEach(() => {
  files.clear()
  files.set(skills, '')
  files.set(manifest, JSON.stringify({ name: 'custom' }))
  files.set(resolve(skills, 'example/SKILL.md'), body)
})

describe('plugin prefix and manual', () => {
  it('reads the installed manifest name and uses it for manual keys and commands', () => {
    expect(pluginPrefix()).toBe('custom')
    expect(readManual()).toMatchObject({
      skillPrefix: 'custom',
      skills: [{ key: 'custom:example', command: '/custom:example' }],
    })
  })

  it('prefers the lfad plugin directory over the legacy flow directory', () => {
    const preferred = resolve(root, 'plugins/lfad')
    files.set(resolve(preferred, 'skills'), '')
    files.set(resolve(preferred, '.claude-plugin/plugin.json'), '{"name":"preferred"}')
    expect(findFlowPluginDir()).toBe(preferred)
    expect(pluginPrefix()).toBe('preferred')
  })

  it.each([undefined, '{', '{}', '{"name":null}', '{"name":""}'])('falls back for missing or invalid manifest %s', (content) => {
    if (content === undefined) files.delete(manifest)
    else files.set(manifest, content)
    expect(pluginPrefix()).toBe('lfad')
  })

  it('falls back when no installed plugin is found', () => {
    files.clear()
    expect(pluginPrefix()).toBe('lfad')
  })
})

describe('skill body resolution', () => {
  it.each(['custom', 'flow'])('resolves %s keys under the installed plugin', (prefix) => {
    expect(readSkillBody(`${prefix}:example`)).toBe('Plugin body\n')
  })

  it('keeps other prefixes project-local', () => {
    const board = resolve(root, 'project/.flow')
    files.set(resolve(board, '../.claude/skills/other:example/SKILL.md'), 'Project body')
    expect(readSkillBody('other:example', board)).toBe('Project body')
    expect(readSkillBody('other:example')).toBeNull()
  })

  it.each(['custom:../example', 'flow:../example', 'custom:.hidden', 'flow:a/b', 'custom:a\\b', 'custom:'])('rejects unsafe folder %s', (key) => {
    expect(readSkillBody(key)).toBeNull()
  })
})
