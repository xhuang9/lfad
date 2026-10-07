import { useCallback, useEffect, useState } from 'react'

import { getArchive, getParked, parkTicket, unparkTicket } from './api'
import type { Ticket } from './types'

export function useSystemStores(version: number, refreshBoard: () => void) {
  const [archived, setArchived] = useState<Ticket[]>([])
  const [parked, setParked] = useState<Ticket[]>([])

  const refreshStores = useCallback(() => {
    void getArchive().then(setArchived).catch(() => setArchived([]))
    void getParked().then(setParked).catch(() => setParked([]))
  }, [])

  useEffect(refreshStores, [refreshStores, version])

  const park = useCallback(async (id: number) => {
    await parkTicket(id)
    refreshBoard()
    refreshStores()
  }, [refreshBoard, refreshStores])

  const unpark = useCallback(async (id: number) => {
    await unparkTicket(id)
    refreshBoard()
    refreshStores()
  }, [refreshBoard, refreshStores])

  return { archived, parked, park, unpark }
}
