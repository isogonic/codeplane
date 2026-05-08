/**
 * In-memory ring buffer of recent SSE events for `Last-Event-ID` resume.
 *
 * Each event is assigned a monotonic per-process id when it's first
 * appended. On reconnect, clients pass `Last-Event-ID: <n>` and the
 * server replays anything with id > n. If the buffer has rotated past
 * `n`, `since` returns `null` and the server emits a `resume_failed`
 * event so the client knows to refetch state.
 *
 * Capacity must balance memory cost against tolerable disconnect window:
 * during streaming we may emit 30+ events/sec, so 1024 ≈ 30 seconds of
 * hot streaming and minutes of normal activity. Tune via the constructor
 * argument; do not hardcode in callers.
 */
export interface BufferedEvent {
  readonly id: number
  readonly data: string
}

export class ResumeBuffer {
  private readonly events: BufferedEvent[] = []
  private nextID = 1
  private readonly capacity: number

  constructor(capacity: number) {
    if (capacity < 1 || !Number.isFinite(capacity)) {
      throw new Error(`ResumeBuffer capacity must be >= 1, got ${capacity}`)
    }
    this.capacity = Math.floor(capacity)
  }

  /** Append a new event and return it (with assigned id). */
  append(data: string): BufferedEvent {
    const id = this.nextID++
    const ev: BufferedEvent = { id, data }
    this.events.push(ev)
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity)
    }
    return ev
  }

  /**
   * Returns events with id > `lastID`, or `null` if `lastID` is older
   * than what the buffer still holds (caller should refetch state).
   * Empty array means "client is already up to date."
   */
  since(lastID: number): BufferedEvent[] | null {
    const oldest = this.events[0]
    // Allow `lastID === oldest.id - 1` (the boundary case where the
    // client has the event right before our oldest). Anything older
    // than that is an unbridgeable gap.
    if (oldest && lastID < oldest.id - 1) return null
    const idx = this.events.findIndex((e) => e.id > lastID)
    return idx === -1 ? [] : this.events.slice(idx)
  }

  /** Number of events currently buffered. Useful for tests/metrics. */
  get size(): number {
    return this.events.length
  }

  /** The next id that will be assigned. Useful for tests/metrics. */
  get nextId(): number {
    return this.nextID
  }
}
