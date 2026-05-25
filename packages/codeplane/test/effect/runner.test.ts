import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Ref, Scope } from "effect"
import { Runner } from "../../src/effect"
import { it } from "../lib/effect"

describe("Runner", () => {
  // --- ensureRunning semantics ---

  it.live(
    "ensureRunning starts work and returns result",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const result = yield* runner.ensureRunning(Effect.succeed("hello"))
      expect(result).toBe("hello")
      expect(runner.state._tag).toBe("Idle")
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "ensureRunning propagates work failures",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string, string>(s)
      const exit = yield* runner.ensureRunning(Effect.fail("boom")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(runner.state._tag).toBe("Idle")
    }),
  )

  it.live(
    "concurrent callers share the same run",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const calls = yield* Ref.make(0)
      const work = Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1)
        yield* Effect.sleep("10 millis")
        return "shared"
      })

      const [a, b] = yield* Effect.all([runner.ensureRunning(work), runner.ensureRunning(work)], {
        concurrency: "unbounded",
      })

      expect(a).toBe("shared")
      expect(b).toBe("shared")
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.live(
    "concurrent callers all receive same error",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string, string>(s)
      const work = Effect.gen(function* () {
        yield* Effect.sleep("10 millis")
        return yield* Effect.fail("boom")
      })

      const [a, b] = yield* Effect.all(
        [runner.ensureRunning(work).pipe(Effect.exit), runner.ensureRunning(work).pipe(Effect.exit)],
        { concurrency: "unbounded" },
      )

      expect(Exit.isFailure(a)).toBe(true)
      expect(Exit.isFailure(b)).toBe(true)
    }),
  )

  it.live(
    "ensureRunning can be called again after previous run completes",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      expect(yield* runner.ensureRunning(Effect.succeed("first"))).toBe("first")
      expect(yield* runner.ensureRunning(Effect.succeed("second"))).toBe("second")
    }),
  )

  it.live(
    "second ensureRunning ignores new work if already running",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const ran = yield* Ref.make<string[]>([])

      const first = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "first"])
        yield* Effect.sleep("50 millis")
        return "first-result"
      })
      const second = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "second"])
        return "second-result"
      })

      const [a, b] = yield* Effect.all([runner.ensureRunning(first), runner.ensureRunning(second)], {
        concurrency: "unbounded",
      })

      expect(a).toBe("first-result")
      expect(b).toBe("first-result")
      expect(yield* Ref.get(ran)).toEqual(["first"])
    }),
  )

  it.live(
    "queued ensureRunning starts one follow-up run after the active run",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const ran = yield* Ref.make<string[]>([])

      const first = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "first"])
        yield* Effect.sleep("50 millis")
        return "first-result"
      })
      const second = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "second"])
        return "second-result"
      })

      const [a, b] = yield* Effect.all([runner.ensureRunning(first), runner.ensureRunning(second, { queue: true })], {
        concurrency: "unbounded",
      })

      expect(a).toBe("first-result")
      expect(b).toBe("second-result")
      expect(yield* Ref.get(ran)).toEqual(["first", "second"])
    }),
  )

  it.live(
    "each queued ensureRunning gets its own FIFO slot",
    // Behavioral fix: previously two queue:true callers shared a single slot,
    // which silently dropped messages. Now each enqueues independently.
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const calls = yield* Ref.make(0)
      const order = yield* Ref.make<string[]>([])

      const first = Effect.gen(function* () {
        yield* Ref.update(order, (a) => [...a, "first"])
        yield* Effect.sleep("50 millis")
        return "first"
      })
      const work = (label: string) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (n) => n + 1)
          yield* Ref.update(order, (a) => [...a, label])
          return label
        })

      const a = yield* runner.ensureRunning(first).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      const [b, c] = yield* Effect.all(
        [runner.ensureRunning(work("two"), { queue: true }), runner.ensureRunning(work("three"), { queue: true })],
        { concurrency: "unbounded" },
      )
      const firstExit = yield* Fiber.await(a)

      expect(Exit.isSuccess(firstExit)).toBe(true)
      expect(b).toBe("two")
      expect(c).toBe("three")
      expect(yield* Ref.get(calls)).toBe(2)
      expect(yield* Ref.get(order)).toEqual(["first", "two", "three"])
    }),
  )

  it.live(
    "FIFO queue runs many items in submission order",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const order = yield* Ref.make<string[]>([])

      const block = yield* Deferred.make<void>()
      const head = Effect.gen(function* () {
        yield* Ref.update(order, (a) => [...a, "head"])
        yield* Deferred.await(block)
        return "head"
      })
      const tail = (label: string) =>
        Effect.gen(function* () {
          yield* Ref.update(order, (a) => [...a, label])
          return label
        })

      const fa = yield* runner.ensureRunning(head).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      const fbs = yield* Effect.all(
        ["one", "two", "three", "four"].map((l) => runner.ensureRunning(tail(l), { queue: true }).pipe(Effect.forkChild)),
      )
      yield* Effect.sleep("10 millis")
      yield* Deferred.succeed(block, undefined)

      yield* Fiber.await(fa)
      const exits = yield* Effect.all(fbs.map((f) => Fiber.await(f)))
      for (const e of exits) expect(Exit.isSuccess(e)).toBe(true)
      expect(yield* Ref.get(order)).toEqual(["head", "one", "two", "three", "four"])
    }),
  )

  it.live(
    "queue rejects with QueueFull at capacity",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { queueCapacity: 2 })

      const block = yield* Deferred.make<void>()
      const fa = yield* runner.ensureRunning(Deferred.await(block).pipe(Effect.as("active"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      // Two slots fit.
      const f1 = yield* runner.ensureRunning(Effect.succeed("q1"), { queue: true }).pipe(Effect.forkChild)
      const f2 = yield* runner.ensureRunning(Effect.succeed("q2"), { queue: true }).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      // Third overflows.
      const exit = yield* runner.ensureRunning(Effect.succeed("q3"), { queue: true }).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      // QueueFull surfaces as a defect (die), so the cause has a Die node.
      // Just verify the run is still alive.
      expect(runner.busy).toBe(true)

      yield* Deferred.succeed(block, undefined)
      yield* Fiber.await(fa)
      yield* Effect.all([Fiber.await(f1), Fiber.await(f2)])
    }),
  )

  it.live(
    "onQueueChange fires when items enqueue and dequeue",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const observed = yield* Ref.make<number[]>([])
      const runner = Runner.make<string>(s, {
        onQueueChange: (depth) => Ref.update(observed, (a) => [...a, depth]),
      })

      const block = yield* Deferred.make<void>()
      const fa = yield* runner.ensureRunning(Deferred.await(block).pipe(Effect.as("a"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const f1 = yield* runner.ensureRunning(Effect.succeed("1"), { queue: true }).pipe(Effect.forkChild)
      const f2 = yield* runner.ensureRunning(Effect.succeed("2"), { queue: true }).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      yield* Deferred.succeed(block, undefined)
      yield* Effect.all([Fiber.await(fa), Fiber.await(f1), Fiber.await(f2)])

      // We should have seen depth 1 (after first enqueue), 2 (after second),
      // 1 (after first runs), 0 (after second runs).
      const seen = yield* Ref.get(observed)
      expect(seen).toContain(1)
      expect(seen).toContain(2)
      expect(seen[seen.length - 1]).toBe(0)
    }),
  )

  it.live(
    "queued ensureRunning still runs after the active run fails",
    // Regression: a failing first run must NOT poison the queued follow-up.
    // Each ensureRunning(work, {queue:true}) is an independent submission and
    // should be evaluated on its own merits (its own work decides its exit).
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string, string>(s)
      const ran = yield* Ref.make<string[]>([])

      const first = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "first"])
        yield* Effect.sleep("30 millis")
        return yield* Effect.fail("boom")
      })
      const second = Effect.gen(function* () {
        yield* Ref.update(ran, (a) => [...a, "second"])
        return "second-ok"
      })

      const [exitA, exitB] = yield* Effect.all(
        [
          runner.ensureRunning(first).pipe(Effect.exit),
          runner.ensureRunning(second, { queue: true }).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" },
      )

      expect(Exit.isFailure(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("second-ok")
      expect(yield* Ref.get(ran)).toEqual(["first", "second"])
    }),
  )

  // --- cancel semantics ---

  it.live(
    "cancel interrupts running work",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("never"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.busy).toBe(true)
      expect(runner.state._tag).toBe("Running")

      yield* runner.cancel
      expect(runner.busy).toBe(false)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live(
    "cancel on idle is a no-op",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      yield* runner.cancel
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "cancel with onInterrupt resolves callers gracefully",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("fallback") })
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("never"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      yield* runner.cancel

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe("fallback")
    }),
  )

  it.live(
    "cancel with queued callers resolves all",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, { onInterrupt: Effect.succeed("fallback") })

      const a = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      const b = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      yield* runner.cancel

      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      if (Exit.isSuccess(exitA)) expect(exitA.value).toBe("fallback")
      if (Exit.isSuccess(exitB)) expect(exitB.value).toBe("fallback")
    }),
  )

  it.live(
    "work can be started after cancel",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      yield* runner.cancel
      yield* Fiber.await(fiber)

      const result = yield* runner.ensureRunning(Effect.succeed("after-cancel"))
      expect(result).toBe("after-cancel")
    }),
  )

  test("cancel does not deadlock when replacement work starts before interrupted run exits", async () => {
    function defer() {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }

    function fail(ms: number, msg: string) {
      return new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(msg)), ms)
      })
    }

    const s = await Effect.runPromise(Scope.make())
    const hit = defer()
    const hold = defer()
    const done = defer()
    try {
      const runner = Runner.make<string>(s)
      const first = Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => hit.resolve())),
        Effect.ensuring(Effect.promise(() => hold.promise)),
        Effect.as("first"),
      )

      const a = Effect.runPromiseExit(runner.ensureRunning(first))
      await Bun.sleep(10)

      const stop = Effect.runPromise(runner.cancel)
      await Promise.race([hit.promise, fail(250, "cancel did not interrupt running work")])

      const b = Effect.runPromise(runner.ensureRunning(Effect.promise(() => done.promise).pipe(Effect.as("second"))))
      expect(runner.busy).toBe(true)

      hold.resolve()
      await Promise.race([stop, fail(250, "cancel deadlocked while replacement run was active")])

      expect(runner.busy).toBe(true)
      done.resolve()
      expect(await b).toBe("second")
      expect(runner.busy).toBe(false)

      const exit = await a
      expect(Exit.isFailure(exit)).toBe(true)
    } finally {
      hold.resolve()
      done.resolve()
      await Promise.race([Effect.runPromise(Scope.close(s, Exit.void)), fail(1000, "runner scope did not close")])
    }
  })

  test("cancel returns before interrupted work finishes cleanup", async () => {
    function defer() {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }

    function fail(ms: number, msg: string) {
      return new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(msg)), ms)
      })
    }

    const s = await Effect.runPromise(Scope.make())
    const hit = defer()
    const hold = defer()
    try {
      const runner = Runner.make<string>(s)
      const work = Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => hit.resolve())),
        Effect.ensuring(Effect.promise(() => hold.promise)),
        Effect.as("work"),
      )

      const active = Effect.runPromiseExit(runner.ensureRunning(work))
      await Bun.sleep(10)

      const stop = Effect.runPromise(runner.cancel)
      await Promise.race([hit.promise, fail(250, "cancel did not interrupt running work")])
      await Promise.race([stop, fail(250, "cancel waited for interrupted work cleanup")])

      expect(runner.busy).toBe(false)
      const exit = await active
      expect(Exit.isFailure(exit)).toBe(true)
    } finally {
      hold.resolve()
      await Promise.race([Effect.runPromise(Scope.close(s, Exit.void)), fail(1000, "runner scope did not close")])
    }
  })

  // --- shell semantics ---

  it.live(
    "shell runs exclusively",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const result = yield* runner.startShell(Effect.succeed("shell-done"))
      expect(result).toBe("shell-done")
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "shell rejects when run is active",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const exit = yield* runner.startShell(Effect.succeed("nope")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      yield* runner.cancel
      yield* Fiber.await(fiber)
    }),
  )

  it.live(
    "shell rejects when another shell is running",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("first"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const exit = yield* runner.startShell(Effect.succeed("second")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)
    }),
  )

  it.live(
    "shell rejects via busy callback and cancel still stops the first shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s, {
        busy: () => {
          throw new Error("busy")
        },
      })

      const sh = yield* runner.startShell(Effect.never.pipe(Effect.as("aborted"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const exit = yield* runner.startShell(Effect.succeed("second")).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)

      yield* runner.cancel
      const done = yield* Fiber.await(sh)
      expect(Exit.isFailure(done)).toBe(true)
    }),
  )

  it.live(
    "cancel interrupts shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("ignored"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const stop = yield* runner.cancel.pipe(Effect.forkChild)
      const stopExit = yield* Fiber.await(stop).pipe(Effect.timeout("250 millis"))
      expect(Exit.isSuccess(stopExit)).toBe(true)
      expect(runner.busy).toBe(false)

      const shellExit = yield* Fiber.await(sh)
      expect(Exit.isFailure(shellExit)).toBe(true)

      yield* Deferred.succeed(gate, undefined).pipe(Effect.ignore)
    }),
  )

  // --- shell→run handoff ---

  it.live(
    "ensureRunning queues behind shell then runs after",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("shell-result"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.state._tag).toBe("Shell")

      const run = yield* runner.ensureRunning(Effect.succeed("run-result")).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.state._tag).toBe("Shell")
      // Formerly: ShellThenRun. Now: a Shell with one queued item.
      if (runner.state._tag === "Shell") expect(runner.state.queue.length).toBe(1)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)

      const exit = yield* Fiber.await(run)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toBe("run-result")
      expect(runner.state._tag).toBe("Idle")
    }),
  )

  it.live(
    "ensureRunning callers each get their own slot behind shell",
    // Formerly "share the queued run behind shell" — sharing was the bug.
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const calls = yield* Ref.make(0)
      const gate = yield* Deferred.make<void>()

      const sh = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("shell"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const work = Effect.gen(function* () {
        yield* Ref.update(calls, (n) => n + 1)
        return "run"
      })
      const a = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
      const b = yield* runner.ensureRunning(work).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(sh)

      const [exitA, exitB] = yield* Effect.all([Fiber.await(a), Fiber.await(b)])
      expect(Exit.isSuccess(exitA)).toBe(true)
      expect(Exit.isSuccess(exitB)).toBe(true)
      expect(yield* Ref.get(calls)).toBe(2)
    }),
  )

  it.live(
    "cancel during shell-with-queue cancels both",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)

      const sh = yield* runner.startShell(Effect.never.pipe(Effect.as("aborted"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")

      const run = yield* runner.ensureRunning(Effect.succeed("y")).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.state._tag).toBe("Shell")
      if (runner.state._tag === "Shell") expect(runner.state.queue.length).toBe(1)

      yield* runner.cancel
      expect(runner.busy).toBe(false)

      yield* Fiber.await(sh)
      const exit = yield* Fiber.await(run)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.live(
    "cancel drains the entire FIFO queue (multi-item)",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const reached = yield* Ref.make<string[]>([])

      const fa = yield* runner
        .ensureRunning(Effect.never.pipe(Effect.as("active")))
        .pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      const fbs = yield* Effect.all(
        ["q1", "q2", "q3"].map((l) =>
          runner
            .ensureRunning(
              Effect.gen(function* () {
                yield* Ref.update(reached, (a) => [...a, l])
                return l
              }),
              { queue: true },
            )
            .pipe(Effect.forkChild),
        ),
      )
      yield* Effect.sleep("10 millis")

      yield* runner.cancel
      expect(runner.busy).toBe(false)

      const exits = yield* Effect.all([Fiber.await(fa), ...fbs.map((f) => Fiber.await(f))])
      // Every caller fails (Cancelled).
      for (const e of exits) expect(Exit.isFailure(e)).toBe(true)
      // None of the queued bodies should have run.
      expect(yield* Ref.get(reached)).toEqual([])
    }),
  )

  // --- lifecycle callbacks ---

  it.live(
    "onIdle fires when returning to idle from running",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onIdle: Ref.update(count, (n) => n + 1),
      })
      yield* runner.ensureRunning(Effect.succeed("ok"))
      expect(yield* Ref.get(count)).toBe(1)
    }),
  )

  it.live(
    "onIdle fires on cancel",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onIdle: Ref.update(count, (n) => n + 1),
      })
      const fiber = yield* runner.ensureRunning(Effect.never.pipe(Effect.as("x"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      yield* runner.cancel
      yield* Fiber.await(fiber)
      expect(yield* Ref.get(count)).toBeGreaterThanOrEqual(1)
    }),
  )

  it.live(
    "onBusy fires when shell starts",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const count = yield* Ref.make(0)
      const runner = Runner.make<string>(s, {
        onBusy: Ref.update(count, (n) => n + 1),
      })
      yield* runner.startShell(Effect.succeed("done"))
      expect(yield* Ref.get(count)).toBe(1)
    }),
  )

  // --- busy flag ---

  it.live(
    "busy is true during run",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const fiber = yield* runner.ensureRunning(Deferred.await(gate).pipe(Effect.as("ok"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.busy).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(fiber)
      expect(runner.busy).toBe(false)
    }),
  )

  it.live(
    "busy is true during shell",
    Effect.gen(function* () {
      const s = yield* Scope.Scope
      const runner = Runner.make<string>(s)
      const gate = yield* Deferred.make<void>()

      const fiber = yield* runner.startShell(Deferred.await(gate).pipe(Effect.as("ok"))).pipe(Effect.forkChild)
      yield* Effect.sleep("10 millis")
      expect(runner.busy).toBe(true)

      yield* Deferred.succeed(gate, undefined)
      yield* Fiber.await(fiber)
      expect(runner.busy).toBe(false)
    }),
  )
})
