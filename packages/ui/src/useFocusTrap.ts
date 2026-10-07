// Lightweight focus trap for modal-like overlays (no dependency): keeps Tab /
// Shift-Tab cycling through the container's focusable elements, moves focus
// inside on open (first focusable, else the container), and restores focus to
// the previously-focused element on close/unmount.
//
// Call it BEFORE any component-specific initial-focus effect: its effect then
// runs first, so it captures the element focus should return to, and the later
// effect can still refine which element inside the trap starts focused.

import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focusable descendants that are actually rendered (skips display:none). */
function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  )
}

export function useFocusTrap<T extends HTMLElement>(ref: RefObject<T | null>, active = true): void {
  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (container === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Initial focus — unless something inside already claimed it.
    if (!container.contains(document.activeElement)) {
      const first = focusablesIn(container)[0]
      ;(first ?? container).focus()
    }

    // Document-level (capture) so the cycle holds even after a click lands
    // focus on the body: the next Tab is pulled back into the container.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || container === null) return
      const focusables = focusablesIn(container)
      if (focusables.length === 0) {
        e.preventDefault()
        container.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const current = document.activeElement
      if (!(current instanceof HTMLElement) || !container.contains(current)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Restore where focus came from, if that element still exists.
      if (previous !== null && previous.isConnected) previous.focus()
    }
  }, [ref, active])
}
