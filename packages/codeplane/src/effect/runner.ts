import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope, SynchronizedRef } from "effect"

export interface Runner<A, E = never> {
  readonly state: State<A, E>
  readonly busy: boolean
  readonly queueDepth: number
  readonly ensureRunning: (work: Effect.Effect<A, E>, options?: { queue?: boolean }) => Effect.Effect<A, E>
  readonly startShell: (work: Effect.Effect<A, E>) => Effect.Effect<A, E>
  readonly cancel: Effect.Effect<void>
}

export class Cancelled extends Schema.TaggedErrorClass<Cancelled>()("RunnerCancelled", {}) {}

export class QueueFull extends Schema.TaggedErrorClass<QueueFull>()("RunnerQueueFull", {
  capacity: Schema.Number,
}) {}

interface RunHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  fiber: Fiber.Fiber<A, E>
}

interface ShellHandle<A, E> {
  id: number
  fiber: Fiber.Fiber<A, E>
}

interface PendingHandle<A, E> {
  id: number
  done: Deferred.Deferred<A, E | Cancelled>
  work: Effect.Effect<A, E>
  enqueuedAt: number
}

// Public state. ShellThenRun is no longer a distinct tag — a Shell whose
// `queue` is non-empty *is* a Shell-then-Run. Consumers that previously
// matched on "ShellThenRun" should match on `_tag === "Shell"` and inspect
// `queue.length`.
export type State<A, E> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Running"; readonly run: RunHandle<A, E>; readonly queue: ReadonlyArray<PendingHandle<A, E>> }
  | { readonly _tag: "Shell"; readonly shell: ShellHandle<A, E>; readonly queue: ReadonlyArray<PendingHandle<A, E>> }

export const DEFAULT_QUEUE_CAPACITY = 10

export const make = <A, E = never>(
  scope: Scope.Scope,
  opts?: {
    onIdle?: Effect.Effect<void>
    onBusy?: Effect.Effect<void>
    onInterrupt?: Effect.Effect<A, E>
    busy?: () => never
    /** Maximum number of pending items the queue can hold. Defaults to {@link DEFAULT_QUEUE_CAPACITY}. */
    queueCapacity?: number
    /** Fired after every queue mutation with the new pending depth (callers + active are not counted). */
    onQueueChange?: (depth: number) => Effect.Effect<void>
  },
): Runner<A, E> => {
  const ref = SynchronizedRef.makeUnsafe<State<A, E>>({ _tag: "Idle" })
  const idle = opts?.onIdle ?? Effect.void
  const busy = opts?.onBusy ?? Effect.void
  const onInterrupt = opts?.onInterrupt
  const capacity = Math.max(0, opts?.queueCapacity ?? DEFAULT_QUEUE_CAPACITY)
  const onQueueChange = opts?.onQueueChange ?? (() => Effect.void)
  let ids = 0
  const cancelledShells = new Set<number>()

  const state = () => SynchronizedRef.getUnsafe(ref)
  const queueDepthOf = (st: State<A, E>) => (st._tag === "Idle" ? 0 : st.queue.length)
  const next = () => {
    ids += 1
    return ids
  }

  const complete = (done: Deferred.Deferred<A, E | Cancelled>, exit: Exit.Exit<A, E>) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
      ? Deferred.fail(done, new Cancelled()).pipe(Effect.asVoid)
      : Deferred.done(done, exit).pipe(Effect.asVoid)

  const idleIfCurrent = () =>
    SynchronizedRef.modify(ref, (st) => [st._tag === "Idle" ? idle : Effect.void, st] as const).pipe(Effect.flatten)

  // Drain head of queue (start it as Running). Caller has confirmed state has
  // a non-empty queue. Returns the new state.
  const promoteHead = (queue: ReadonlyArray<PendingHandle<A, E>>) =>
    Effect.gen(function* () {
      const [head, ...rest] = queue
      const run = yield* startRun(head!.work, head!.done)
      return { state: { _tag: "Running" as const, run, queue: rest }, dropped: rest.length }
    })

  const finishRun: (
    id: number,
    done: Deferred.Deferred<A, E | Cancelled>,
    exit: Exit.Exit<A, E>,
  ) => Effect.Effect<void> = (id, done, exit) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag !== "Running" || st.run.id !== id) return [complete(done, exit), st] as const
        // Promote the queued run regardless of whether the previous run
        // succeeded or failed — queued work was submitted independently and
        // should not inherit an unrelated failure. Cancellation (interrupt)
        // is still treated as a stop signal: queued work is dropped via the
        // explicit `cancel` path, not here.
        if (st.queue.length > 0) {
          const promoted = yield* promoteHead(st.queue)
          return [
            Effect.gen(function* () {
              yield* complete(done, exit)
              yield* onQueueChange(promoted.dropped)
            }),
            promoted.state,
          ] as const
        }
        return [
          Effect.gen(function* () {
            yield* idle
            yield* complete(done, exit)
          }),
          { _tag: "Idle" } as const,
        ] as const
      }),
    ).pipe(Effect.flatten)

  const startRun: (
    work: Effect.Effect<A, E>,
    done: Deferred.Deferred<A, E | Cancelled>,
  ) => Effect.Effect<RunHandle<A, E>> = (work, done) =>
    Effect.gen(function* () {
      const id = next()
      const fiber = yield* work.pipe(
        Effect.onExit((exit) => finishRun(id, done, exit)),
        Effect.forkIn(scope),
      )
      return { id, done, fiber } satisfies RunHandle<A, E>
    })

  const finishShell: (id: number) => Effect.Effect<void> = (id) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag !== "Shell" || st.shell.id !== id) return [Effect.void, st] as const
        // Shell finished. If anything is queued behind it, promote it.
        if (st.queue.length > 0) {
          const promoted = yield* promoteHead(st.queue)
          return [
            Effect.gen(function* () {
              cancelledShells.delete(id)
              yield* onQueueChange(promoted.dropped)
            }),
            promoted.state,
          ] as const
        }
        return [
          Effect.gen(function* () {
            cancelledShells.delete(id)
            yield* idle
          }),
          { _tag: "Idle" } as const,
        ] as const
      }),
    ).pipe(Effect.flatten)

  const stopShell = (shell: ShellHandle<A, E>) =>
    Effect.gen(function* () {
      cancelledShells.add(shell.id)
      yield* Fiber.interrupt(shell.fiber)
    })

  const ensureRunning = (work: Effect.Effect<A, E>, options?: { queue?: boolean }) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        switch (st._tag) {
          case "Idle": {
            const done = yield* Deferred.make<A, E | Cancelled>()
            const run = yield* startRun(work, done)
            return [Deferred.await(done), { _tag: "Running", run, queue: [] }] as const
          }
          case "Running": {
            // Without queue=true, callers piggyback on the active run (legacy
            // dedup contract — used for "give me whatever's currently running"
            // semantics by callers that just want the result).
            if (!options?.queue) return [Deferred.await(st.run.done), st] as const
            if (st.queue.length >= capacity) {
              // Cast through `unknown` to reconcile with the success branches
              // returning `Effect<A, E | Cancelled>` — `QueueFull` is caught at
              // runtime via `instanceof` in the outer `Effect.catch`, so type
              // erasure here is harmless.
              return [
                Effect.fail(new QueueFull({ capacity })) as unknown as Effect.Effect<A, E | Cancelled>,
                st,
              ] as const
            }
            const pending: PendingHandle<A, E> = {
              id: next(),
              done: yield* Deferred.make<A, E | Cancelled>(),
              work,
              enqueuedAt: Date.now(),
            }
            const queue = [...st.queue, pending] as ReadonlyArray<PendingHandle<A, E>>
            return [
              Effect.gen(function* () {
                yield* onQueueChange(queue.length)
                return yield* Deferred.await(pending.done)
              }),
              { _tag: "Running", run: st.run, queue } as const,
            ] as const
          }
          case "Shell": {
            // While a shell is active, ensureRunning always enqueues — there's
            // no "active run" to piggyback on, and dropping the work would be
            // surprising. Capacity still applies.
            if (st.queue.length >= capacity) {
              // Cast through `unknown` to reconcile with the success branches
              // returning `Effect<A, E | Cancelled>` — `QueueFull` is caught at
              // runtime via `instanceof` in the outer `Effect.catch`, so type
              // erasure here is harmless.
              return [
                Effect.fail(new QueueFull({ capacity })) as unknown as Effect.Effect<A, E | Cancelled>,
                st,
              ] as const
            }
            const pending: PendingHandle<A, E> = {
              id: next(),
              done: yield* Deferred.make<A, E | Cancelled>(),
              work,
              enqueuedAt: Date.now(),
            }
            const queue = [...st.queue, pending] as ReadonlyArray<PendingHandle<A, E>>
            return [
              Effect.gen(function* () {
                yield* onQueueChange(queue.length)
                return yield* Deferred.await(pending.done)
              }),
              { _tag: "Shell", shell: st.shell, queue } as const,
            ] as const
          }
        }
      }),
    ).pipe(
      Effect.flatten,
      Effect.catch((e): Effect.Effect<A, E> => {
        if (e instanceof Cancelled) return onInterrupt ?? Effect.die(e)
        // QueueFull is a programmer-visible failure — surface it as a die
        // unless the caller wired an explicit handler (we let it bubble as
        // an unchecked error since `E` doesn't include it). Callers using the
        // session-level wrapper translate this into a typed BusyError.
        if (e instanceof QueueFull) return Effect.die(e)
        return Effect.fail(e as E)
      }),
    )

  const startShell = (work: Effect.Effect<A, E>) =>
    SynchronizedRef.modifyEffect(
      ref,
      Effect.fnUntraced(function* (st) {
        if (st._tag !== "Idle") {
          return [
            Effect.sync(() => {
              if (opts?.busy) opts.busy()
              throw new Error("Runner is busy")
            }),
            st,
          ] as const
        }
        yield* busy
        const id = next()
        const fiber = yield* work.pipe(Effect.ensuring(finishShell(id)), Effect.forkChild)
        const shell = { id, fiber } satisfies ShellHandle<A, E>
        return [
          Effect.uninterruptible(
            Effect.gen(function* () {
              const exit = yield* Fiber.await(fiber)
              if (Exit.isSuccess(exit)) return exit.value
              const cancelled = cancelledShells.delete(id)
              if ((cancelled || Cause.hasInterruptsOnly(exit.cause)) && onInterrupt) return yield* onInterrupt
              return yield* Effect.failCause(exit.cause)
            }),
          ),
          { _tag: "Shell", shell, queue: [] },
        ] as const
      }),
    ).pipe(Effect.flatten)

  const cancel = SynchronizedRef.modify(ref, (st) => {
    if (st._tag === "Idle") return [Effect.void, st] as const
    const drainQueue = Effect.forEach(
      st.queue,
      (p) => Deferred.fail(p.done, new Cancelled()).pipe(Effect.asVoid),
      { discard: true },
    )
    if (st._tag === "Running") {
      return [
        Effect.gen(function* () {
          yield* drainQueue
          yield* Fiber.interrupt(st.run.fiber)
          yield* Deferred.await(st.run.done).pipe(Effect.exit, Effect.asVoid)
          yield* onQueueChange(0)
          yield* idleIfCurrent()
        }),
        { _tag: "Idle" } as const,
      ] as const
    }
    // Shell (with possibly non-empty queue — formerly "ShellThenRun").
    return [
      Effect.gen(function* () {
        yield* drainQueue
        yield* stopShell(st.shell)
        yield* onQueueChange(0)
        yield* idleIfCurrent()
      }),
      { _tag: "Idle" } as const,
    ] as const
  }).pipe(Effect.flatten)

  return {
    get state() {
      return state()
    },
    get busy() {
      return state()._tag !== "Idle"
    },
    get queueDepth() {
      return queueDepthOf(state())
    },
    ensureRunning,
    startShell,
    cancel,
  }
}
