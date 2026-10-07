import type { CommandPrefix } from './api'

export const DEFAULT_SKILL_PREFIX = 'lfad'

/** Keep legacy board bindings usable with the installed plugin. */
export function resolveSkillKey(key: string, skillPrefix = DEFAULT_SKILL_PREFIX): string {
  return key.startsWith('flow:') || key.startsWith(`${DEFAULT_SKILL_PREFIX}:`)
    ? `${skillPrefix}:${key.slice(key.indexOf(':') + 1)}`
    : key
}

export function pluginCommand(name: string, commandPrefix: CommandPrefix, skillPrefix = DEFAULT_SKILL_PREFIX): string {
  return `${commandPrefix}${skillPrefix}:${name}`
}
