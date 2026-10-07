/**
 * Tiny in-memory pub/sub for Server-Sent Events. Each connected `/api/events`
 * client registers a send callback. {@link SseHub.broadcast} pushes the
 * `board-changed` message as the default (unnamed) SSE event so the read-only
 * UI's `onmessage` refreshes the board; {@link SseHub.emit} pushes run events as
 * NAMED events (`run-log` / `run-status`) so they carry typed payloads without
 * triggering a board refetch on every log line.
 */

/** One SSE frame: an optional named `event` plus the serialized `data`. */
export interface SseMessage {
  /** Named SSE event; omitted for the default event the legacy UI listens to. */
  event?: string
  data: string
}

/** A per-connection sender: receives one already-serialized SSE frame. */
export type SseSend = (message: SseMessage) => void

/** Fan-out hub holding every live SSE subscriber. */
export class SseHub {
  #subscribers = new Set<SseSend>()

  /**
   * Registers a subscriber and returns an unsubscribe function to call when the
   * connection closes.
   */
  add(send: SseSend): () => void {
    this.#subscribers.add(send)
    return () => {
      this.#subscribers.delete(send)
    }
  }

  /** Pushes `{ type: 'board-changed' }` as the default event to every client. */
  broadcast(): void {
    const data = JSON.stringify({ type: 'board-changed' })
    for (const send of this.#subscribers) send({ data })
  }

  /**
   * Pushes a typed run event as a NAMED SSE event (the event name is the
   * payload's `type`), so the board-changed `onmessage` listener ignores it.
   */
  emit(payload: { type: string }): void {
    const message: SseMessage = { event: payload.type, data: JSON.stringify(payload) }
    for (const send of this.#subscribers) send(message)
  }

  /** Drops all subscribers (used during shutdown). */
  closeAll(): void {
    this.#subscribers.clear()
  }
}
