// Which board columns are expanded into a grid that shows every card. A
// per-viewer convenience, kept in localStorage; it falls back to memory only
// when storage is unavailable.

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'lfad-expanded-columns'

export function readExpanded(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Returns the expanded step keys and a toggle for one step. Columns start collapsed. */
export function useExpandedColumns(): [Set<string>, (stepKey: string) => void] {
  const [expanded, setExpanded] = useState(readExpanded)

  const toggle = useCallback((stepKey: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(stepKey)) next.delete(stepKey)
      else next.add(stepKey)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        // Storage blocked: the choice still holds for this page view.
      }
      return next
    })
  }, [])

  return [expanded, toggle]
}
