// Drawer-scoped keyboard shortcuts. Esc closes (or cancels an edit); `c`
// copies the ticket id; `f` (or ⌘⇧F) toggles full height — bare `f` is the
// YouTube-style primary, ⌘⇧F the modifier alias, both clear of the browser's
// own bindings; ⌘` toggles the question input mode (when the ticket has open
// questions); ⌃1…⌃9 copy the skill commands — Control (not ⌘) keeps clear
// of the browser's tab-switch and clipboard shortcuts. Holding either
// modifier reveals the shortcut badges on the buttons (the returned
// `showHints`).

import { useEffect, useState } from 'react'

interface ShortcutParams {
  /** Suspends drawer shortcuts while a nested modal owns keyboard input. */
  disabled?: boolean
  editing: boolean
  cancelEdit: () => void
  /** True while the drawer body shows input mode — Esc exits it before closing. */
  inputMode: boolean
  onExitInput: () => void
  onClose: () => void
  /** Ticket id as a string; '' while the ticket is still loading. */
  idStr: string
  copyId: (text: string) => void
  actions: string[]
  copyCommand: (skill: string) => void
  onToggleExpand: () => void
  /** Toggles input mode; `q` fires it only when the ticket has open questions. */
  onToggleInput: () => void
  canToggleInput: boolean
}

export function useDrawerShortcuts({ disabled = false, editing, cancelEdit, inputMode, onExitInput, onClose, idStr, copyId, actions, copyCommand, onToggleExpand, onToggleInput, canToggleInput }: ShortcutParams): boolean {
  const [showHints, setShowHints] = useState(false)

  // Esc + `c` are scoped to the open drawer. Capture phase + stopImmediatePropagation
  // prevent the global "new idea" (`c`) shortcut on window from also firing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (disabled) return
      if (e.key === 'Escape') {
        if (editing) {
          e.preventDefault()
          e.stopImmediatePropagation()
          cancelEdit()
        } else if (inputMode) {
          // Input mode exits to the doc view first; a second Esc closes.
          e.preventDefault()
          e.stopImmediatePropagation()
          onExitInput()
        } else {
          onClose()
        }
        return
      }
      // ⌘` toggles input mode — a deliberate chord, so it fires even from a
      // field. (cmd+q / cmd+shift+q stay untouched: they carry other modifiers.)
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
        && (e.key === '`' || e.code === 'Backquote') && canToggleInput) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onToggleInput()
        return
      }
      const t = e.target as HTMLElement | null
      const typing =
        t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'c' && idStr.length > 0) {
        e.preventDefault()
        e.stopImmediatePropagation()
        copyId(idStr)
        return
      }
      if (e.key === 'f') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onToggleExpand()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [disabled, onClose, editing, inputMode, onExitInput, idStr, copyId, cancelEdit, onToggleExpand, onToggleInput, canToggleInput])

  // ⌃1…⌃9. Re-attached each render (no dep list) so the handlers never
  // close over stale action state.
  useEffect(() => {
    function onCtrlKeys(e: KeyboardEvent) {
      if (disabled) return
      if (e.key === 'Control' || e.key === 'Meta') setShowHints(true)
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        const t = e.target as HTMLElement | null
        if (t === null || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA' && !t.isContentEditable)) {
          e.preventDefault()
          e.stopImmediatePropagation()
          onToggleExpand()
        }
        return
      }
      if (!e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const digit = Number.parseInt(e.key, 10)
      if (Number.isInteger(digit) && digit >= 1 && digit <= actions.length) {
        e.preventDefault()
        e.stopImmediatePropagation()
        copyCommand(actions[digit - 1])
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Control' || e.key === 'Meta') setShowHints(false)
    }
    function onBlur() {
      setShowHints(false)
    }
    window.addEventListener('keydown', onCtrlKeys, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onCtrlKeys, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  })

  return showHints
}
