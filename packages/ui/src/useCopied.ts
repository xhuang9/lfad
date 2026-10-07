// Clipboard-with-feedback helper. `copy(text)` writes to the clipboard and, once
// the write SUCCEEDS, flips `copied` true for a short window so the caller can
// show a transient "Copied" affordance — a missing clipboard (non-secure
// context) or a rejected write never fakes success. The `copy` identity is
// stable, so it is safe in effect deps.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Copied {
  copied: boolean
  copy: (text: string) => void
}

export function useCopied(timeout = 1200): Copied {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const copy = useCallback(
    (text: string) => {
      const write = navigator.clipboard?.writeText(text)
      if (write === undefined) return // no clipboard API — don't pretend it copied
      write.then(
        () => {
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => setCopied(false), timeout)
        },
        () => {
          // write rejected (permissions/focus) — leave `copied` false
        },
      )
    },
    [timeout],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return { copied, copy }
}
