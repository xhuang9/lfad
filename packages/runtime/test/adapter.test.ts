import { BUILT_IN_ADAPTER, type AgentAdapter } from '@lfad/core'
import { describe, expect, it } from 'vitest'

import { buildAdapterInvocation, extractAgentTexts } from '../src/adapter.js'

const CTX = { ticketId: 12, step: 'doing', boardRoot: '/work/.flow', pluginDir: '/tool/plugins/lfad' }

describe('buildAdapterInvocation', () => {
  it('substitutes every placeholder per args token (no shell re-splitting)', () => {
    const adapter: AgentAdapter = {
      cmd: 'anycli',
      args: ['{prompt}', '--model', '{model}', '--effort', '{effort}', 't{ticketId}/{step}', '{boardRoot}'],
      output: 'text',
      model: 'opus',
      effort: 'high',
    }
    const invocation = buildAdapterInvocation(adapter, 'do the work', CTX)
    expect(invocation.cmd).toBe('anycli')
    expect(invocation.args).toEqual([
      'do the work',
      '--model',
      'opus',
      '--effort',
      'high',
      't12/doing',
      '/work/.flow',
    ])
  })

  it('substitutes the deprecated {stage} alias with the step value', () => {
    const adapter: AgentAdapter = {
      cmd: 'anycli',
      args: ['{prompt}', '--stage', '{stage}'],
      output: 'text',
    }
    const invocation = buildAdapterInvocation(adapter, 'p', CTX)
    expect(invocation.args).toEqual(['p', '--stage', 'doing'])
  })

  it('workflow: true prepends ultracode to the prompt; unset model/effort tokens are dropped', () => {
    const adapter: AgentAdapter = {
      cmd: 'anycli',
      args: ['{prompt}', '{model}', '{effort}'],
      output: 'stream-json',
      workflow: true,
    }
    const invocation = buildAdapterInvocation(adapter, 'do the work', CTX)
    expect(invocation.prompt).toBe('ultracode\n\ndo the work')
    expect(invocation.args).toEqual(['ultracode\n\ndo the work'])
  })

  it('drops a --flag whose placeholder value resolves empty (model, effort, pluginDir)', () => {
    const adapter: AgentAdapter = {
      cmd: 'anycli',
      args: ['{prompt}', '--model', '{model}', '--plugin-dir', '{pluginDir}'],
      output: 'stream-json',
    }
    const invocation = buildAdapterInvocation(adapter, 'p', { ...CTX, pluginDir: '' })
    expect(invocation.args).toEqual(['p'])
  })

  it('substitutes {pluginDir} and matches the built-in adapter shape; unknown {tokens} stay', () => {
    const invocation = buildAdapterInvocation(
      { ...BUILT_IN_ADAPTER, args: [...BUILT_IN_ADAPTER.args, '{custom}'] },
      'p',
      CTX,
    )
    expect(invocation.args).toEqual([
      '-p',
      'p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--plugin-dir',
      '/tool/plugins/lfad',
      '{custom}',
    ])
  })
})

describe('extractAgentTexts', () => {
  it('text mode: every raw line is agent text', () => {
    expect(extractAgentTexts('FLOW_DONE', 'text')).toEqual(['FLOW_DONE'])
    expect(extractAgentTexts('{"type":"assistant"}', 'text')).toEqual(['{"type":"assistant"}'])
  })

  it('stream-json: extracts only assistant text blocks', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'FLOW_DONE' }, { type: 'tool_use', name: 'Read', input: {} }] } })
    expect(extractAgentTexts(line, 'stream-json')).toEqual(['FLOW_DONE'])
  })

  it('stream-json: includes the final result string', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'success', result: 'FLOW_DONE' })
    expect(extractAgentTexts(line, 'stream-json')).toEqual(['FLOW_DONE'])
  })

  it('stream-json: tool results and non-assistant events yield nothing', () => {
    const toolResult = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'FLOW_BLOCK: docs example' }] }] } })
    expect(extractAgentTexts(toolResult, 'stream-json')).toEqual([])
    expect(extractAgentTexts('{"type":"system","subtype":"init"}', 'stream-json')).toEqual([])
    expect(extractAgentTexts('plain non-json line FLOW_DONE', 'stream-json')).toEqual([])
    expect(extractAgentTexts('{"type":"result","result":42}', 'stream-json')).toEqual([])
  })
})
