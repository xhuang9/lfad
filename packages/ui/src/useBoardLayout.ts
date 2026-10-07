// Resolves the `layout` setting (auto/landscape/portrait) plus the live
// viewport into the board's effective orientation. Both the Board and the
// TicketDrawer consume `useResolvedOrientation()` so the two never disagree.
// The pure `resolveOrientation` carries all the branching and is unit-tested
// directly (no window access), the hook only wires it to React + resize.

import { useEffect, useState, useSyncExternalStore } from 'react'

import type { BoardLayout } from './api'
import { getBoardLayoutSnapshot, subscribeBoardLayout } from './api'

export type ResolvedOrientation = 'landscape' | 'portrait'

/** Below this width the two side-by-side halves are unusable, so landscape
 *  (whether explicit or via auto) silently falls back to the portrait render —
 *  the stored setting is left untouched. */
export const MIN_LANDSCAPE_WIDTH = 720

/** Pure orientation resolution — the test seam. */
export function resolveOrientation(layout: BoardLayout, innerWidth: number, innerHeight: number): ResolvedOrientation {
  if (layout === 'portrait') return 'portrait'
  // Narrow viewport → portrait, for both `landscape` and `auto`.
  if (innerWidth < MIN_LANDSCAPE_WIDTH) return 'portrait'
  if (layout === 'landscape') return 'landscape'
  // auto: follow the window shape.
  return innerWidth > innerHeight ? 'landscape' : 'portrait'
}

interface Viewport {
  width: number
  height: number
}

function readViewport(): Viewport {
  // SSR / static render (tests): assume a wide desktop so the portrait render
  // — the current behaviour — stays the safe default.
  if (typeof window === 'undefined') return { width: 1280, height: 800 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/** The board's live orientation: the `layout` setting resolved against the
 *  current viewport, re-evaluated on resize. */
export function useResolvedOrientation(): ResolvedOrientation {
  const layout = useSyncExternalStore(subscribeBoardLayout, getBoardLayoutSnapshot)
  const [viewport, setViewport] = useState<Viewport>(readViewport)

  useEffect(() => {
    const onResize = (): void => setViewport(readViewport())
    window.addEventListener('resize', onResize)
    // Reconcile once in case the viewport changed before the listener attached.
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return resolveOrientation(layout, viewport.width, viewport.height)
}
