// Delegated click routing for in-document artifact links: markdown rendering
// marks same-ticket `.md` links with `.md-artifact-link` + data attributes
// (see markdown.ts), and this hook intercepts plain left-clicks on them so the
// drawer can switch sections instead of opening raw bytes. Modifier clicks and
// targets the drawer cannot map (onOpen returns false) keep the link's normal
// behaviour — the raw files route in a new tab. One delegated listener per
// container, re-attached whenever the rendered content changes.

import { useEffect, type RefObject } from 'react'

export function useArtifactLinks<T extends HTMLElement>(
  ref: RefObject<T | null>,
  content: unknown,
  /** Returns true when the drawer handled the link (section switched). */
  onOpen: (path: string, anchor: string | null) => boolean,
): void {
  useEffect(() => {
    const root = ref.current
    if (root === null) return
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return
      const link = event.target.closest<HTMLElement>('a.md-artifact-link')
      if (link === null || !root.contains(link)) return
      const path = link.dataset.artifact
      if (path === undefined) return
      if (onOpen(path, link.dataset.anchor ?? null)) event.preventDefault()
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [ref, content, onOpen])
}
