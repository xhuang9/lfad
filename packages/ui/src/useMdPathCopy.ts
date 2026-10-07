// Click-to-copy for `.md-path` spans inside rendered markdown: clicking a
// copyable path or git-command <code> copies its text and flashes an
// `is-copied` class for a second. One delegated listener per container,
// re-attached whenever the rendered content changes; `enabled: false` (e.g.
// while an editor is open) detaches it entirely.

import { useEffect, type RefObject } from 'react'

export function useMdPathCopy<T extends HTMLElement>(
  ref: RefObject<T | null>,
  content: unknown,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    const root = ref.current
    if (root === null) return
    const copiedTimers = new Map<HTMLElement, number>()
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const span = event.target.closest<HTMLElement>('.md-path')
      if (span === null || !root.contains(span)) return
      void navigator.clipboard.writeText(span.textContent ?? '').then(() => {
        span.classList.add('is-copied')
        const existing = copiedTimers.get(span)
        if (existing !== undefined) window.clearTimeout(existing)
        copiedTimers.set(span, window.setTimeout(() => {
          span.classList.remove('is-copied')
          copiedTimers.delete(span)
        }, 1000))
      })
    }
    root.addEventListener('click', onClick)
    return () => {
      root.removeEventListener('click', onClick)
      copiedTimers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [ref, content, enabled])
}
