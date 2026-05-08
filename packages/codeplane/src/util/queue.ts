export interface AsyncQueueOptions<T> {
  /**
   * Maximum number of items buffered before backpressure kicks in.
   * On overflow, the oldest item is dropped (and `onDrop` is invoked) so
   * recent events keep flowing — losing old events is preferable to
   * unbounded memory growth when a consumer is slow or hung. Use the
   * default (`Infinity`) only when the producer rate is bounded.
   */
  maxSize?: number
  /** Invoked synchronously for every dropped item when the queue overflows. */
  onDrop?: (item: T) => void
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: { value: T; done: false } | { value: undefined; done: true }) => void)[] = []
  private closed = false
  private readonly maxSize: number
  private readonly onDrop: ((item: T) => void) | undefined

  constructor(opts?: AsyncQueueOptions<T>) {
    this.maxSize = opts?.maxSize ?? Infinity
    this.onDrop = opts?.onDrop
  }

  push(item: T) {
    // Pushes after `close()` are silently dropped. The contract is that
    // close() ends iteration; producers shouldn't observe a queue they
    // can't drain. (We don't throw because most producers are
    // fire-and-forget event handlers and we don't want them to crash.)
    if (this.closed) return
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve({ value: item, done: false })
      return
    }
    if (this.queue.length >= this.maxSize) {
      const dropped = this.queue.shift() as T
      this.onDrop?.(dropped)
    }
    this.queue.push(item)
  }

  /**
   * Wakes all pending consumers with `done: true` and rejects future
   * pushes. Buffered items already in the queue are still drained by
   * iterators that started before close — call `clear()` first if you
   * want to discard them.
   */
  close() {
    if (this.closed) return
    this.closed = true
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!
      resolve({ value: undefined, done: true })
    }
  }

  clear() {
    this.queue.length = 0
  }

  get size(): number {
    return this.queue.length
  }

  /**
   * Awaits the next value; resolves with `undefined` once `close()` has
   * been called and the queue is drained. Callers that loop on
   * `await q.next()` should treat `undefined` as end-of-stream rather
   * than a value.
   */
  async next(): Promise<T | undefined> {
    if (this.queue.length > 0) return this.queue.shift()!
    if (this.closed) return undefined
    return new Promise<T | undefined>((resolve) =>
      this.resolvers.push((result) => resolve(result.done ? undefined : result.value)),
    )
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
        continue
      }
      if (this.closed) return
      const next = await new Promise<{ value: T; done: false } | { value: undefined; done: true }>((resolve) =>
        this.resolvers.push(resolve),
      )
      if (next.done) return
      yield next.value
    }
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        await fn(item)
      }
    }),
  )
}
