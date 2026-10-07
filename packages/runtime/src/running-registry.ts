import { randomUUID } from 'node:crypto'

export interface RunningClaim {
  token: string
  label?: string
  claimedAt: string
  expiresAt: string
}

export interface RunningSnapshot {
  count: number
  since: string
}

export interface RunningRegistryOptions {
  ttlMs: number
  now?: () => number
  onChange?: () => void
}

export class RunningConflictError extends Error {
  constructor(readonly holder: { count: number, claimedAt: string, label?: string }) {
    super('Ticket is already running')
    this.name = 'RunningConflictError'
  }
}

/** Ephemeral, process-local cooperative leases for official agent sessions. */
export class RunningRegistry {
  readonly #ttlMs: number
  readonly #now: () => number
  readonly #onChange: () => void
  readonly #claims = new Map<number, Map<string, RunningClaim>>()

  constructor(options: RunningRegistryOptions) {
    this.#ttlMs = options.ttlMs
    this.#now = options.now ?? Date.now
    this.#onChange = options.onChange ?? (() => {})
  }

  claim(ticketId: number, options: { force?: boolean, label?: string } = {}): { token: string, expiresAt: string } {
    this.#removeExpired(ticketId)
    const claims = this.#claims.get(ticketId)
    if (!options.force && claims !== undefined && claims.size > 0) {
      const oldest = [...claims.values()].sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))[0]!
      throw new RunningConflictError({ count: claims.size, claimedAt: oldest.claimedAt, ...(oldest.label !== undefined ? { label: oldest.label } : {}) })
    }

    const now = this.#now()
    const token = randomUUID()
    const claim: RunningClaim = {
      token,
      ...(options.label !== undefined ? { label: options.label } : {}),
      claimedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.#ttlMs).toISOString(),
    }
    const next = claims ?? new Map<string, RunningClaim>()
    next.set(token, claim)
    this.#claims.set(ticketId, next)
    this.#onChange()
    return { token, expiresAt: claim.expiresAt }
  }

  heartbeat(ticketId: number, token: string): { expiresAt: string } | null {
    this.#removeExpired(ticketId)
    const claim = this.#claims.get(ticketId)?.get(token)
    if (claim === undefined) return null
    claim.expiresAt = new Date(this.#now() + this.#ttlMs).toISOString()
    this.#onChange()
    return { expiresAt: claim.expiresAt }
  }

  release(ticketId: number, token: string): boolean {
    this.#removeExpired(ticketId)
    const claims = this.#claims.get(ticketId)
    const released = claims?.delete(token) ?? false
    if (claims?.size === 0) this.#claims.delete(ticketId)
    if (released) this.#onChange()
    return released
  }

  clear(ticketId: number): number {
    this.#removeExpired(ticketId)
    const count = this.#claims.get(ticketId)?.size ?? 0
    if (count > 0) {
      this.#claims.delete(ticketId)
      this.#onChange()
    }
    return count
  }

  isRunning(ticketId: number): boolean {
    this.#removeExpired(ticketId)
    return (this.#claims.get(ticketId)?.size ?? 0) > 0
  }

  /** The oldest live lease for a ticket (count + when + label), or `null` if none. */
  holder(ticketId: number): { count: number, claimedAt: string, label?: string } | null {
    this.#removeExpired(ticketId)
    const claims = this.#claims.get(ticketId)
    if (claims === undefined || claims.size === 0) return null
    const oldest = [...claims.values()].sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))[0]!
    return { count: claims.size, claimedAt: oldest.claimedAt, ...(oldest.label !== undefined ? { label: oldest.label } : {}) }
  }

  snapshot(): Map<number, RunningSnapshot> {
    this.sweep()
    return new Map([...this.#claims].map(([ticketId, claims]) => {
      const since = [...claims.values()].map((claim) => claim.claimedAt).sort()[0]!
      return [ticketId, { count: claims.size, since }]
    }))
  }

  sweep(): number {
    let removed = 0
    for (const ticketId of [...this.#claims.keys()]) removed += this.#removeExpired(ticketId)
    if (removed > 0) this.#onChange()
    return removed
  }

  #removeExpired(ticketId: number): number {
    const claims = this.#claims.get(ticketId)
    if (claims === undefined) return 0
    const now = this.#now()
    let removed = 0
    for (const [token, claim] of claims) {
      if (Date.parse(claim.expiresAt) <= now) {
        claims.delete(token)
        removed += 1
      }
    }
    if (claims.size === 0) this.#claims.delete(ticketId)
    return removed
  }
}
