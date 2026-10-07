// The doc pane: renders the active section's markdown (with ticket-relative
// image/link resolution) beside a clickable heading outline, or the
// raw-markdown editor while an edit is open. Mermaid fences render to SVG
// via a lazy-loaded mermaid pass. The Edit / Save / Cancel buttons live in
// the header action row.

import { useEffect, useMemo, useRef } from 'react'

import type { ArtifactRef, OutlineEntry } from '../../../markdown'
import { renderMarkdown } from '../../../markdown'
import type { Artifact } from '../../../types'
import { useMdPathCopy } from '../../../useMdPathCopy'
import { useArtifactLinks } from '../hooks/useArtifactLinks'

/**
 * Maps a relative markdown src/href to the ticket files route, resolved
 * against the artifact's directory: in `plan/01-x.md`, `../images/a.png`
 * becomes `/api/tickets/:id/files/images/a.png`. The `Idea` pseudo-artifact
 * is the root-level ticket.md, so it resolves from the ticket folder itself.
 */
export function resolveFileUrl(ticketId: number, artifactName: string, url: string): string {
  const dir = artifactName === 'Idea' ? '' : artifactName.slice(0, artifactName.lastIndexOf('/') + 1)
  const segments = `${dir}${url}`.split('/').filter((s) => s !== '' && s !== '.')
  const path: string[] = []
  for (const seg of segments) {
    if (seg === '..') path.pop()
    else path.push(seg)
  }
  return `/api/tickets/${ticketId}/files/${path.map(encodeURIComponent).join('/')}`
}

/**
 * Maps a relative markdown href to a same-ticket `.md` artifact reference —
 * the relative path inside the ticket folder plus the optional `#heading`
 * anchor — or null when the target is not markdown or walks out of the ticket
 * folder. Mirrors {@link resolveFileUrl}'s directory walk.
 */
export function resolveArtifactRef(artifactName: string, url: string): ArtifactRef | null {
  const hashIndex = url.indexOf('#')
  const anchor = hashIndex >= 0 && hashIndex < url.length - 1 ? url.slice(hashIndex + 1) : null
  let target = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  try {
    target = decodeURIComponent(target)
  } catch {
    // malformed escape; match on the raw text
  }
  if (!/\.md$/i.test(target)) return null
  const dir = artifactName === 'Idea' ? '' : artifactName.slice(0, artifactName.lastIndexOf('/') + 1)
  const path: string[] = []
  for (const seg of `${dir}${target}`.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (path.length === 0) return null // leaves the ticket folder
      path.pop()
    } else {
      path.push(seg)
    }
  }
  return path.length === 0 ? null : { path: path.join('/'), anchor }
}

let mermaidSeq = 0

interface SectionDocProps {
  ticketId: number
  current: Artifact | undefined
  /** Heading id to scroll into view once the section renders. */
  anchor: string | null
  editing: boolean
  draft: string
  saveError: string | null
  onDraft: (value: string) => void
  /** Routes a same-ticket artifact link through a section switch; returns
   *  true when handled (unknown targets fall back to the raw link). */
  onArtifactLink: (path: string, anchor: string | null) => boolean
}

export function SectionDoc({ ticketId, current, anchor, editing, draft, saveError, onDraft, onArtifactLink }: SectionDocProps) {
  const docRef = useRef<HTMLDivElement>(null)

  const { html, outline } = useMemo(() => {
    if (current === undefined) return { html: '', outline: [] as OutlineEntry[] }
    return renderMarkdown(
      current.content,
      (url) => resolveFileUrl(ticketId, current.name, url),
      (url) => resolveArtifactRef(current.name, url),
    )
  }, [current, ticketId])

  useArtifactLinks(docRef, html, onArtifactLink)

  // After a section renders, bring the requested heading anchor into view.
  useEffect(() => {
    if (anchor === null || editing || current === undefined) return
    const el = docRef.current?.querySelector(`#${CSS.escape(anchor)}`)
    if (el) el.scrollIntoView({ block: 'start' })
  }, [anchor, current, editing])

  useMdPathCopy(docRef, html, !editing)

  // Render ```mermaid fences to SVG. The library is imported only when a
  // fence is actually present, so it stays out of the main bundle.
  useEffect(() => {
    if (editing) return
    const root = docRef.current
    if (root === null) return
    const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'))
    if (blocks.length === 0) return
    let cancelled = false
    void (async () => {
      const { default: mermaid } = await import('mermaid')
      if (cancelled) return
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: "'IBM Plex Sans', sans-serif",
      })
      for (const code of blocks) {
        if (cancelled) return
        const pre = code.parentElement
        if (pre === null || !pre.isConnected) continue
        mermaidSeq += 1
        try {
          const { svg } = await mermaid.render(`mermaid-d${mermaidSeq}`, code.textContent ?? '')
          const host = document.createElement('div')
          host.className = 'mermaid-diagram'
          host.innerHTML = svg
          pre.replaceWith(host)
        } catch {
          // Bad diagram syntax: keep the source visible, flag it.
          pre.classList.add('mermaid-error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [html, editing])

  const minLevel = outline.length > 0 ? Math.min(...outline.map((h) => h.level)) : 1

  function jumpTo(id: string): void {
    docRef.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="doc" ref={docRef}>
      {current ? (
        <>
          {saveError && <p className="drawer-error doc-save-error">{saveError}</p>}
          {editing ? (
            <textarea
              className="text-input doc-editor"
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              spellCheck={false}
              aria-label={`Edit ${current.name} markdown`}
            />
          ) : (
            <div className="doc-layout">
              <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
              {outline.length >= 2 && (
                <nav className="outline" aria-label="Document outline">
                  <div className="outline-head">Outline</div>
                  {outline.map((h) => (
                    <button
                      key={h.id}
                      className="outline-item"
                      style={{ paddingLeft: `${(h.level - minLevel) * 12 + 8}px` }}
                      onClick={() => jumpTo(h.id)}
                      title={h.text}
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Select a section from the rail.</p>
      )}
    </div>
  )
}
