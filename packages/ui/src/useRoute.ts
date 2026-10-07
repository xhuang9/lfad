// A tiny dependency-free router. Parses the URL into a small shape the app can
// drive off of, and exposes `navigate` for pushState-based transitions.
//
//   /                 -> board
//   /dashboard        -> dashboard
//   /archive          -> archive (browse the _archive cold store)
//   /parked           -> parked (browse and restore held tickets)
//   /t/:id            -> ticket drawer open (first section)
//   /t/:id/<path>     -> ticket drawer open at a section; the path is the slug
//                        of the artifact name and may span segments
//                        (`/t/1/plan/01-server-events`)
//   #<anchor>         -> heading id to scroll into view once rendered
//
// For a ticket URL the underlying view is intentionally left to the app (it
// keeps whatever board/dashboard was last shown, defaulting to board on a cold
// deep-link), so the parsed `base` only distinguishes board vs dashboard vs
// ticket — the app reconciles the visible view from that.

import { useCallback, useEffect, useState } from 'react'

export type RouteBase = 'board' | 'dashboard' | 'archive' | 'parked' | 'ticket'

export interface Route {
  base: RouteBase
  ticketId: number | null
  section: string | null
  anchor: string | null
}

function parse(): Route {
  const { pathname, hash } = window.location
  const anchor = hash.startsWith('#') && hash.length > 1 ? hash.slice(1) : null
  const segs = pathname.split('/').filter(Boolean)

  if (segs[0] === 't' && segs[1] !== undefined) {
    const n = Number(segs[1])
    const ticketId = Number.isFinite(n) ? n : null
    // The section is everything after the id — artifact paths keep their
    // slashes, so the remaining segments are decoded and re-joined.
    const rest = segs.slice(2).map(decodeURIComponent)
    return { base: 'ticket', ticketId, section: rest.length > 0 ? rest.join('/') : null, anchor }
  }
  if (segs[0] === 'dashboard') {
    return { base: 'dashboard', ticketId: null, section: null, anchor }
  }
  if (segs[0] === 'archive') {
    return { base: 'archive', ticketId: null, section: null, anchor }
  }
  if (segs[0] === 'parked') {
    return { base: 'parked', ticketId: null, section: null, anchor }
  }
  return { base: 'board', ticketId: null, section: null, anchor }
}

export interface RouteApi {
  route: Route
  navigate: (path: string, opts?: { replace?: boolean }) => void
}

export function useRoute(): RouteApi {
  const [route, setRoute] = useState<Route>(() => parse())

  useEffect(() => {
    const onPop = (): void => setRoute(parse())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    if (path === window.location.pathname + window.location.hash) return
    if (opts?.replace) window.history.replaceState(null, '', path)
    else window.history.pushState(null, '', path)
    setRoute(parse())
  }, [])

  return { route, navigate }
}
