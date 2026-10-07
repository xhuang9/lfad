/**
 * Shared test fixtures for @lfad/core: the full 14-step board config
 * (mirroring the grown-board example in docs/board.example.yml) so
 * pre-config test scenarios keep their exact semantics under the
 * config-driven step model.
 */

import type { BoardConfig } from '../src/config.js'
import { parseBoardConfig } from '../src/config.js'

/** Raw (pre-parse) full 14-step board config, matching docs/board.example.yml. */
export const FULL_BOARD_RAW = {
  version: 1,
  agents: {
    default: {
      cmd: 'claude',
      args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--model', '{model}', '--effort', '{effort}'],
      model: 'opus',
      effort: 'high',
    },
    deep: {
      cmd: 'claude',
      args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--model', '{model}', '--effort', '{effort}'],
      model: 'fable',
      effort: 'xhigh',
      workflow: true,
    },
    light: {
      cmd: 'claude',
      args: ['-p', '{prompt}', '--output-format', 'stream-json', '--verbose', '--model', '{model}'],
      model: 'sonnet',
    },
  },
  steps: [
    { key: 'idea', label: 'Idea', type: 'agent', row: 'needs-you', entry: true, artifact: 'body' },
    { key: 'shape', label: 'Shape', type: 'gate', artifact: 'shape.md' },
    { key: 'plan', label: 'Plan', type: 'gate', artifact: 'plan.md' },
    { key: 'design', label: 'Design', type: 'agent', skipUnless: 'needsDesign', artifact: 'design.md', agent: 'deep' },
    { key: 'design-review', label: 'Design Review', type: 'gate', skipUnless: 'needsDesign', artifact: 'design-review.md' },
    { key: 'todo', label: 'Todo', type: 'queue', entry: true },
    { key: 'doing', label: 'Doing', type: 'agent', agent: 'deep' },
    { key: 'checks', label: 'Checks', type: 'agent', artifact: 'checks.md', agent: 'light' },
    { key: 'review', label: 'Review', type: 'gate', artifact: 'review.md' },
    { key: 'add-test', label: 'Add Test', type: 'agent', artifact: 'add-test.md', agent: 'light' },
    { key: 'done', label: 'Done', type: 'terminal' },
    { key: 'document', label: 'Document', type: 'agent', artifact: 'doc.md', agent: 'light' },
    { key: 'uat', label: 'UAT', type: 'gate', artifact: 'uat.md' },
    { key: 'monitor', label: 'Monitor', type: 'terminal' },
  ],
}

/** A fresh, parsed full 14-step BoardConfig (new instance per call). */
export function makeTestConfig(): BoardConfig {
  return parseBoardConfig(FULL_BOARD_RAW)
}
