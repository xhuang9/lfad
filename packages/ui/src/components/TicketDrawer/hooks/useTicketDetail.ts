// Ticket-detail state: fetch + live refetch + the inline-edit lifecycle. The
// detail refetches on every board change (agents write files while the drawer
// is open) but never while an edit is in progress — the load effect no-ops on
// `editing` and fires again the moment the edit ends, so a draft is never
// clobbered by a refetch-applied content swap.

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, getTicket, setAutomationLevel, updateArtifact } from '../../../api'
import type { AutomationLevel, TicketDetail } from '../../../types'

export interface TicketDetailState {
  detail: TicketDetail | null
  error: string | null
  editing: boolean
  draft: string
  saving: boolean
  saveError: string | null
  setDraft: (value: string) => void
  /** Opens the inline editor seeded with the current section's markdown. */
  startEdit: (content: string) => void
  cancelEdit: () => void
  /** Persists the draft to the named artifact and applies the refreshed detail. */
  save: (name: string) => void
  /** Persists a new automation level and applies the returned ticket. */
  setLevel: (level: AutomationLevel) => void
  /** Applies a fresh detail payload fetched elsewhere (input-mode write-back). */
  applyDetail: (d: TicketDetail) => void
}

export function useTicketDetail(ticketId: number, boardVersion: number, hold = false, readOnly = false): TicketDetailState {
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Inline editing state for the active section.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Load on mount / ticket switch, refetch on every board change. Only a ticket
  // switch clears the shown detail — a live refetch swaps content in place.
  // `hold` blocks refetches the same way `editing` does — input mode raises it
  // while an answer draft is in progress so a board change never clobbers it.
  const loadedId = useRef<number | null>(null)
  useEffect(() => {
    // The edit/hold guard only blocks REFETCHES of the same ticket — a ticket
    // switch always loads, otherwise the previous ticket's detail stays on
    // screen (and a submit could run against the wrong ticket).
    if ((editing || hold) && loadedId.current === ticketId) return
    if (loadedId.current !== ticketId) {
      loadedId.current = ticketId
      setDetail(null)
      setError(null)
    }
    let cancelled = false
    getTicket(ticketId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [ticketId, boardVersion, editing, hold])

  // Read-only browsing (an archived ticket) never enters the editor — the guard
  // makes startEdit/save no-ops so an archived ticket's history can't be edited.
  // The seed content is kept as the save's baseContent: agents rewrite artifacts
  // while the drawer holds refetches during an edit, so an unconditional save
  // would silently clobber their writes — the server 409s instead.
  const editBase = useRef('')
  const startEdit = useCallback((content: string) => {
    if (readOnly) return
    editBase.current = content
    setDraft(content)
    setSaveError(null)
    setEditing(true)
  }, [readOnly])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setSaveError(null)
  }, [])

  const save = useCallback(
    (name: string) => {
      if (readOnly || saving) return
      setSaving(true)
      setSaveError(null)
      updateArtifact(ticketId, name, draft, editBase.current)
        .then((d) => {
          setDetail(d)
          setEditing(false)
        })
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 409) {
            setSaveError('The document changed while you were editing — cancel and re-open the editor to retry on the fresh content.')
          } else {
            setSaveError(e instanceof Error ? e.message : String(e))
          }
        })
        .finally(() => setSaving(false))
    },
    [ticketId, draft, saving, readOnly],
  )

  // The automation-level select: fires the write and applies the returned
  // ticket; the SSE-driven board refetch keeps everything else consistent.
  const setLevel = useCallback(
    (level: AutomationLevel) => {
      if (readOnly) return
      setAutomationLevel(ticketId, level)
        .then((ticket) => setDetail((d) => (d === null || d.ticket.id !== ticket.id ? d : { ...d, ticket })))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    },
    [ticketId, readOnly],
  )

  const applyDetail = useCallback((d: TicketDetail) => setDetail(d), [])

  return { detail, error, editing, draft, saving, saveError, setDraft, startEdit, cancelEdit, save, setLevel, applyDetail }
}
