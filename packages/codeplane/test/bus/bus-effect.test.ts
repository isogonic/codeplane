import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema, Stream } from "effect"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"
import { Instance } from "../../src/project/instance"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const TestEvent = {
  Ping: BusEvent.define("test.effect.ping", Schema.Struct({ value: Schema.Number })),
  Pong: BusEvent.define("test.effect.pong", Schema.Struct({ message: Schema.String })),
}

const node = CrossSpawnSpawner.defaultLayer

const live = Layer.mergeAll(Bus.layer, node)

const it = testEffect(live)

describe("Bus (Effect-native)", () => {
  it.live("publish + subscribe stream delivers events", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const received: number[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            received.push(evt.properties.value)
            if (received.length === 2) Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Ping, { value: 2 })
        yield* Deferred.await(done)

        expect(received).toEqual([1, 2])
      }),
    ),
  )

  it.live("subscribe filters by event type", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const pings: number[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            pings.push(evt.properties.value)
            Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Pong, { message: "ignored" })
        yield* bus.publish(TestEvent.Ping, { value: 42 })
        yield* Deferred.await(done)

        expect(pings).toEqual([42])
      }),
    ),
  )

  it.live("subscribeAll receives all types", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const types: string[] = []
        const done = yield* Deferred.make<void>()

        yield* Stream.runForEach(bus.subscribeAll(), (evt) =>
          Effect.sync(() => {
            types.push(evt.type)
            if (types.length === 2) Deferred.doneUnsafe(done, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* bus.publish(TestEvent.Pong, { message: "hi" })
        yield* Deferred.await(done)

        expect(types).toContain("test.effect.ping")
        expect(types).toContain("test.effect.pong")
      }),
    ),
  )

  it.live("multiple subscribers each receive the event", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const a: number[] = []
        const b: number[] = []
        const doneA = yield* Deferred.make<void>()
        const doneB = yield* Deferred.make<void>()

        yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            a.push(evt.properties.value)
            Deferred.doneUnsafe(doneA, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Stream.runForEach(bus.subscribe(TestEvent.Ping), (evt) =>
          Effect.sync(() => {
            b.push(evt.properties.value)
            Deferred.doneUnsafe(doneB, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 99 })
        yield* Deferred.await(doneA)
        yield* Deferred.await(doneB)

        expect(a).toEqual([99])
        expect(b).toEqual([99])
      }),
    ),
  )

  it.live("concurrent subscribers to a fresh event type all receive a publish", () =>
    // Regression: getOrCreate's check-then-create is not atomic across
    // Effect suspensions (PubSub.sliding allocates async). Two concurrent
    // subscribes to a brand-new event type both observe `undefined` and
    // both allocate; whichever loses the Map slot ends up on an orphaned
    // PubSub and silently misses every publish. Forcing many concurrent
    // first-touches to the SAME type makes the race observable.
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        // Use a fresh event type that no prior test has subscribed to so
        // every fiber races on the create path.
        const Race = BusEvent.define("test.effect.race", Schema.Struct({ value: Schema.Number }))
        const bus = yield* Bus.Service

        const N = 16
        const counters = Array.from({ length: N }, () => ({ count: 0 }))
        const dones = yield* Effect.all(
          Array.from({ length: N }, () => Deferred.make<void>()),
          { concurrency: "unbounded" },
        )

        yield* Effect.all(
          counters.map((c, i) =>
            Stream.runForEach(bus.subscribe(Race), () =>
              Effect.sync(() => {
                c.count += 1
                Deferred.doneUnsafe(dones[i], Effect.void)
              }),
            ).pipe(Effect.forkScoped),
          ),
          { concurrency: "unbounded" },
        )

        // Give every subscribe a chance to settle into the typed PubSub.
        yield* Effect.sleep("10 millis")
        yield* bus.publish(Race, { value: 1 })
        yield* Effect.all(dones.map((d) => Deferred.await(d).pipe(Effect.timeout("2 seconds"))))

        for (const c of counters) expect(c.count).toBe(1)
      }),
    ),
  )

  it.live("subscribeAll stream sees InstanceDisposed on disposal", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const types: string[] = []
      const seen = yield* Deferred.make<void>()
      const disposed = yield* Deferred.make<void>()

      // Set up subscriber inside the instance
      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service

        yield* Stream.runForEach(bus.subscribeAll(), (evt) =>
          Effect.sync(() => {
            types.push(evt.type)
            if (evt.type === TestEvent.Ping.type) Deferred.doneUnsafe(seen, Effect.void)
            if (evt.type === Bus.InstanceDisposed.type) Deferred.doneUnsafe(disposed, Effect.void)
          }),
        ).pipe(Effect.forkScoped)

        yield* Effect.sleep("10 millis")
        yield* bus.publish(TestEvent.Ping, { value: 1 })
        yield* Deferred.await(seen)
      }).pipe(provideInstance(dir))

      // Dispose from OUTSIDE the instance scope
      yield* Effect.promise(() => Instance.disposeAll())
      yield* Deferred.await(disposed).pipe(Effect.timeout("2 seconds"))

      expect(types).toContain("test.effect.ping")
      expect(types).toContain(Bus.InstanceDisposed.type)
    }),
  )
})
