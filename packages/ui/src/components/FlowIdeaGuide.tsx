import { useSyncExternalStore } from 'react'

import {
  getCommandPrefixSnapshot,
  getSkillPrefixSnapshot,
  subscribeCommandPrefix,
  subscribeSkillPrefix,
  type CommandPrefix,
} from '../api'
import { useCopied } from '../useCopied'
import { DEFAULT_SKILL_PREFIX, pluginCommand } from '../commands'

export function flowIdeaCommand(commandPrefix: CommandPrefix, skillPrefix = DEFAULT_SKILL_PREFIX): string {
  return pluginCommand('idea', commandPrefix, skillPrefix)
}

export function FlowIdeaGuide() {
  const commandPrefix = useSyncExternalStore(subscribeCommandPrefix, getCommandPrefixSnapshot)
  const skillPrefix = useSyncExternalStore(subscribeSkillPrefix, getSkillPrefixSnapshot)
  const { copied, copy } = useCopied()
  const command = flowIdeaCommand(commandPrefix, skillPrefix)
  const target = commandPrefix === '/' ? 'Claude Code' : 'Codex'

  return (
    <aside className="new-idea-guide" aria-labelledby="new-idea-guide-title">
      <span className="new-idea-guide-kicker">Or start with an agent</span>
      <h3 id="new-idea-guide-title">Rather describe it to an agent?</h3>
      <p>
        <code>{`${skillPrefix}:idea`}</code> turns a rough thought into a structured ticket through a short agent conversation.
      </p>
      <div className="new-idea-guide-action">
        <button
          type="button"
          className={`btn cmd-btn ${copied ? 'is-copied' : ''}`}
          onClick={() => copy(command)}
          aria-label={`Copy ${command}`}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <span>
          Paste <code>{command}</code> into {target} and answer a few questions.
        </span>
      </div>
    </aside>
  )
}
