import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/markdown'

describe('renderMarkdown copyable inline code', () => {
  it('marks git commands with the existing path-copy class', () => {
    const { html } = renderMarkdown('Run `git -C /tmp/repo diff --stat` to inspect the change.')

    expect(html).toContain('<code class="md-path">git -C /tmp/repo diff --stat</code>')
  })

  it('keeps source paths copyable', () => {
    const { html } = renderMarkdown('Open `packages/ui/src/markdown.ts`.')

    expect(html).toContain('<code class="md-path">packages/ui/src/markdown.ts</code>')
  })

  it('does not mark arbitrary inline code as copyable', () => {
    const { html } = renderMarkdown('Use `pnpm build` or `gitHub` when appropriate.')

    expect(html).toContain('<code>pnpm build</code>')
    expect(html).toContain('<code>gitHub</code>')
    expect(html).not.toContain('class="md-path"')
  })
})
