// Markdown rendering for ticket artifacts, built on markdown-it (the same
// engine as VS Code's built-in preview): full CommonMark + tables, task
// lists, autolinks, and heading anchors. Raw HTML stays disabled, so the
// output is safe to inject. Mermaid fences render client-side (SectionDoc
// lazy-loads the library when a ```mermaid block is present).

import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import taskLists from 'markdown-it-task-lists'

/**
 * Turns heading text into a URL-safe anchor slug: lowercase, non-alphanumerics
 * collapsed to single hyphens, trimmed. Kept byte-compatible with the previous
 * hand-rolled renderer so existing `#heading` deep links keep resolving.
 */
export function slugify(text: string): string {
  return text
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Maps a relative URL found in the markdown to the URL to render with. */
export type ResolveUrl = (url: string) => string

/** A same-ticket `.md` artifact reference extracted from a relative link. */
export interface ArtifactRef {
  /** Relative path of the artifact inside the ticket folder (`plan/01-x.md`). */
  path: string
  /** Optional `#heading` anchor carried by the link. */
  anchor: string | null
}

/** Maps a relative URL to a same-ticket artifact ref, or null when it is not one. */
export type ResolveArtifact = (url: string) => ArtifactRef | null

/** True for URLs the renderer leaves alone: absolute paths, hash anchors, protocols. */
function isAbsolute(url: string): boolean {
  return url.startsWith('/') || url.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(url)
}

export interface OutlineEntry {
  /** Heading level, 1–6. */
  level: number
  text: string
  /** The anchor id the heading renders with (already unique per document). */
  id: string
}

export interface RenderedMarkdown {
  html: string
  outline: OutlineEntry[]
}

interface RenderEnv {
  resolve?: ResolveUrl
  resolveArtifact?: ResolveArtifact
}

const md = new MarkdownIt({ html: false, linkify: true })
  .use(anchor, { slugify })
  .use(taskLists)

// Rewrite relative image/link URLs through the per-render resolver (passed via
// env), so ticket-relative references hit the daemon's files route.
const defaultImage = md.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env: RenderEnv, self) => {
  const src = tokens[idx].attrGet('src')
  if (src !== null && env.resolve !== undefined && !isAbsolute(src)) {
    tokens[idx].attrSet('src', env.resolve(src))
  }
  return defaultImage(tokens, idx, options, env, self)
}

md.renderer.rules.link_open = (tokens, idx, options, env: RenderEnv, self) => {
  const token = tokens[idx]
  const href = token.attrGet('href')
  if (href !== null && !isAbsolute(href)) {
    if (env.resolve !== undefined) token.attrSet('href', env.resolve(href))
    // Links to a sibling `.md` artifact of the same ticket get a marker the
    // drawer's delegated click handler routes through a section switch. The
    // resolved href stays on the tag as the fallback (middle click, new tab).
    const artifact = env.resolveArtifact?.(href) ?? null
    if (artifact !== null) {
      token.attrJoin('class', 'md-artifact-link')
      token.attrSet('data-artifact', artifact.path)
      if (artifact.anchor !== null) token.attrSet('data-anchor', artifact.anchor)
    }
  }
  // In-document `#…` anchors stay in-page — a new tab cannot scroll this one.
  if (href === null || !href.startsWith('#')) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noreferrer noopener')
  }
  return self.renderToken(tokens, idx, options)
}

const sourcePath = /\.(?:tsx?|jsx?|mjs|cjs|json|mdx?|s?css|html|ya?ml|txt|sh|toml|sql)(?::\d+(?::\d+)?)?$/i
const gitCommand = /^git(?:\s|$)/

md.renderer.rules.code_inline = (tokens, idx) => {
  const content = tokens[idx].content
  const copyablePath = content.includes('/') && !/[\s*?]/.test(content) && sourcePath.test(content)
  const copyable = copyablePath || gitCommand.test(content)
  const className = copyable ? ' class="md-path"' : ''
  return `<code${className}>${md.utils.escapeHtml(content)}</code>`
}

/** Plain text of an inline heading token (code spans included, markup dropped). */
function inlineText(children: { type: string, content: string }[] | null): string {
  if (children === null) return ''
  return children
    .filter((c) => c.type === 'text' || c.type === 'code_inline')
    .map((c) => c.content)
    .join('')
}

export function renderMarkdown(markdown: string, resolve?: ResolveUrl, resolveArtifact?: ResolveArtifact): RenderedMarkdown {
  const env: RenderEnv = { resolve, resolveArtifact }
  const tokens = md.parse(markdown, env)

  // The anchor plugin has already stamped unique ids during parse — walk the
  // heading tokens once to build the clickable outline.
  const outline: OutlineEntry[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type !== 'heading_open') continue
    const id = tokens[i].attrGet('id')
    const text = inlineText(tokens[i + 1]?.children ?? null)
    if (id !== null && text.length > 0) {
      outline.push({ level: Number(tokens[i].tag.slice(1)), text, id })
    }
  }

  return { html: md.renderer.render(tokens, md.options, env), outline }
}
