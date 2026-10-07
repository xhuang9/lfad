// Board state hook: loads steps + tickets and keeps them live via the SSE
// stream. The board is read-only — tickets move only when agents change them on
// disk, which arrives here as a `board-changed` event that triggers a refresh.

import { useCallback, useEffect, useRef, useState } from 'react'

import { getBoard, getSteps } from './api'
import type { StepPayload, Ticket } from './types'

export interface BoardState {
  steps: StepPayload[]
  /** Board-level guidance from board.yml, when configured. */
  guidance: string | undefined
  tickets: Ticket[]
  error: string | null
  refresh: () => void
  /** Bumps on every board change — open views refetch derived data off it. */
  version: number
}

export function useBoard(): BoardState {
  const [steps, setSteps] = useState<StepPayload[]>([])
  const [guidance, setGuidance] = useState<string | undefined>(undefined)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  // Refetch the step list — fired on mount and on a `board.yml` hot reload.
  const stepsLoaded = useRef(false)
  const refreshSteps = useCallback(() => {
    getSteps()
      .then((r) => {
        stepsLoaded.current = true
        setSteps(r.steps)
        setGuidance(r.guidance)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const refresh = useCallback(() => {
    // Steps never loaded (the daemon was down at mount)? Recover them on any
    // refresh — an empty step list renders an empty board whatever tickets say.
    if (!stepsLoaded.current) refreshSteps()
    getBoard()
      .then((next) => {
        setTickets(next)
        setError(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [refreshSteps])

  // Initial load + SSE subscription. `board-changed` is the default (unnamed)
  // event so `onmessage` fires only on real board changes; `ready`/`ping` are
  // ignored. Each change also bumps `version` so an open ticket drawer can
  // refetch its detail payload (agent-written files appear live).
  useEffect(() => {
    refreshSteps()
    refresh()

    const source = new EventSource('/api/events')
    source.onopen = () => {
      // The stream has no replay, so a reconnect may have missed broadcasts —
      // refetch the full state to resynchronize (a harmless duplicate on mount).
      refresh()
      refreshSteps()
    }
    source.onmessage = () => {
      refresh()
      setVersion((v) => v + 1)
    }

    // A `board.yml` hot reload emits a named `config-changed` event; refetch the
    // step list so columns/rows track the new config (the paired default
    // `board-changed` broadcast still refreshes tickets via `onmessage`).
    const onConfig = () => refreshSteps()
    source.addEventListener('config-changed', onConfig)

    return () => {
      source.removeEventListener('config-changed', onConfig)
      source.close()
    }
  }, [refresh, refreshSteps])

  return { steps, guidance, tickets, error, refresh, version }
}
