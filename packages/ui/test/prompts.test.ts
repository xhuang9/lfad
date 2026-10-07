import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_PRESETS,
  renderRunAllPrompt,
  validateRunAllTemplate,
} from '../src/prompts'

describe('Run (N) prompt templates', () => {
  it('renders the default workflow template anchored on the computed ids', () => {
    expect(renderRunAllPrompt(DEFAULT_PROMPT_TEMPLATES.runAll, [37, 45], '/')).toBe(
      'Use a workflow to run parallel actions on exactly the tickets Run (N) has computed as advanceable now: #37, #45. '
      + 'That list is authoritative — it already EXCLUDES tickets blocked on a user action, manual tickets, tickets with pending manual tasks, and dependency-held tickets. '
      + 'Process ONLY these ids; do not re-scan the board for more, and never batch-advance a manual ticket (a manual ticket moves only when you name its id directly). '
      + 'Run /lfad:next <id> for each one in its own parallel lane, and stop each ticket at its next human gate. '
      + 'A ticket resting at `done` is not finished — run /lfad:next <id> on it too so it carries onward `done -> doc -> _archive`, where the doc step writes a targeted doc for feature-level work or archives a small UI/copy fix directly. Archiving a locally-committed but unpushed ticket is expected.',
    )
  })

  it('both shipped presets tell the runner never to batch-advance manual tickets', () => {
    for (const preset of PROMPT_PRESETS) {
      expect(preset.template.toLowerCase()).toContain('manual')
    }
  })

  it('both shipped presets carry done tickets onward through doc then archive', () => {
    for (const preset of PROMPT_PRESETS) {
      const template = preset.template.toLowerCase()
      expect(template).toContain('done -> doc -> _archive')
      expect(template).toContain('doc')
      expect(template).toContain('archive')
    }
  })

  it('renders every occurrence from sorted live ids and the active command prefix', () => {
    expect(renderRunAllPrompt('{ids} then {ids}: {command} via {loop}', [9, 2], '$')).toBe(
      '#2, #9 then #2, #9: $lfad:next via $loop',
    )
  })

  it('keeps custom prose while filling the supported tokens', () => {
    expect(renderRunAllPrompt('Please advance {ids} using {command}.', [65], '/')).toBe(
      'Please advance #65 using /lfad:next.',
    )
  })

  it('requires non-empty text containing {ids}', () => {
    expect(validateRunAllTemplate('')).toMatch(/empty/i)
    expect(validateRunAllTemplate('   ')).toMatch(/empty/i)
    expect(validateRunAllTemplate('Run {command} <id>.')).toContain('{ids}')
    expect(validateRunAllTemplate('Run {IDS}.')).toContain('{ids}')
    expect(validateRunAllTemplate('Run {ids}.')).toBeNull()
  })

  it('ships a continuous preset with prefix-aware loop and next commands', () => {
    const continuous = PROMPT_PRESETS.find((preset) => preset.key === 'continuous')!
    expect(renderRunAllPrompt(continuous.template, [7], '$')).toContain('Use $loop')
    expect(renderRunAllPrompt(continuous.template, [7], '$')).toContain('$lfad:next')
  })

  it('renders the installed plugin prefix without changing the loop command', () => {
    expect(renderRunAllPrompt('{command} {ids} via {loop}', [7], '$', 'custom')).toBe('$custom:next #7 via $loop')
  })
})
