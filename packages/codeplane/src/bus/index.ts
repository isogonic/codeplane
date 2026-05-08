import { Effect, Exit, Layer, PubSub, Scope, Context, Stream, Schema } from "effect"
import { EffectBridge } from "@/effect"
import { Log } from "../util"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { InstanceState } from "@/effect"
import { makeRuntime } from "@/effect/run-service"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "bus" })

// Bus PubSubs are sliding, not unbounded: a slow or wedged subscriber would
// otherwise hold every event in memory forever. Sliding evicts the oldest
// payload first so publishers stay non-blocking and recent events keep
// flowing. Subscribers that fall behind lose history — but every state-
// mutating event is also persisted via SyncEvent in `EventTable`, so a
// reconnecting client can replay the gap via `/sync/history`.
//
// Capacity is sized for ~30s of dense delta traffic from a single session.
// A reasoning-heavy turn emits ~100 part-delta events per second peak;
// 4096 covers ~40s of that on a fully wedged subscriber.
const BUS_BUFFER_SIZE = Flag.CODEPLANE_BUS_BUFFER_SIZE ?? 4096

type BusProperties<D extends BusEvent.Definition<string, Schema.Top>> = Schema.Schema.Type<D["properties"]>

export const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  Schema.Struct({
    directory: Schema.String,
  }),
)

type Payload<D extends BusEvent.Definition = BusEvent.Definition> = {
  type: D["type"]
  properties: BusProperties<D>
}

type State = {
  wildcard: PubSub.PubSub<Payload>
  typed: Map<string, PubSub.PubSub<Payload>>
}

export interface Interface {
  readonly publish: <D extends BusEvent.Definition>(def: D, properties: BusProperties<D>) => Effect.Effect<void>
  readonly subscribe: <D extends BusEvent.Definition>(def: D) => Stream.Stream<Payload<D>>
  readonly subscribeAll: () => Stream.Stream<Payload>
  readonly subscribeCallback: <D extends BusEvent.Definition>(
    def: D,
    callback: (event: Payload<D>) => unknown,
  ) => Effect.Effect<() => void>
  readonly subscribeAllCallback: (callback: (event: any) => unknown) => Effect.Effect<() => void>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Bus.state")(function* (ctx) {
        const wildcard = yield* PubSub.sliding<Payload>(BUS_BUFFER_SIZE)
        const typed = new Map<string, PubSub.PubSub<Payload>>()

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // Publish InstanceDisposed before shutting down so subscribers see it
            yield* PubSub.publish(wildcard, {
              type: InstanceDisposed.type,
              properties: { directory: ctx.directory },
            })
            yield* PubSub.shutdown(wildcard)
            for (const ps of typed.values()) {
              yield* PubSub.shutdown(ps)
            }
          }),
        )

        return { wildcard, typed }
      }),
    )

    function getOrCreate<D extends BusEvent.Definition>(state: State, def: D) {
      return Effect.gen(function* () {
        const existing = state.typed.get(def.type)
        if (existing) return existing as unknown as PubSub.PubSub<Payload<D>>

        // PubSub.sliding suspends, so two concurrent callers can both
        // observe `existing === undefined` and both allocate. Resolve
        // by re-checking after allocation: whichever fiber's `set()`
        // runs first wins the Map slot; the loser shuts down its
        // unused PubSub and returns the winner's. This keeps every
        // subscriber on the same channel, so a typed publish reaches
        // all subscribers regardless of allocation order.
        const created = yield* PubSub.sliding<Payload>(BUS_BUFFER_SIZE)
        const winner = state.typed.get(def.type)
        if (winner) {
          yield* PubSub.shutdown(created)
          return winner as unknown as PubSub.PubSub<Payload<D>>
        }
        state.typed.set(def.type, created)
        return created as unknown as PubSub.PubSub<Payload<D>>
      })
    }

    function publish<D extends BusEvent.Definition>(def: D, properties: BusProperties<D>) {
      return Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        const payload: Payload = { type: def.type, properties }
        log.info("publishing", { type: def.type })

        const ps = s.typed.get(def.type)
        if (ps) yield* PubSub.publish(ps, payload)
        yield* PubSub.publish(s.wildcard, payload)

        const dir = yield* InstanceState.directory
        const context = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID

        GlobalBus.emit("event", {
          directory: dir,
          project: context.project.id,
          workspace,
          payload,
        })
      })
    }

    function subscribe<D extends BusEvent.Definition>(def: D): Stream.Stream<Payload<D>> {
      log.info("subscribing", { type: def.type })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          const ps = yield* getOrCreate(s, def)
          return Stream.fromPubSub(ps)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: def.type }))))
    }

    function subscribeAll(): Stream.Stream<Payload> {
      log.info("subscribing", { type: "*" })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return Stream.fromPubSub(s.wildcard)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))))
    }

    function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
      return Effect.gen(function* () {
        log.info("subscribing", { type })
        const bridge = yield* EffectBridge.make()
        const scope = yield* Scope.make()
        const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub))

        yield* Scope.provide(scope)(
          Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((msg) =>
              Effect.tryPromise({
                try: () => Promise.resolve().then(() => callback(msg)),
                catch: (cause) => {
                  log.error("subscriber failed", { type, cause })
                },
              }).pipe(Effect.ignore),
            ),
            Effect.forkScoped,
          ),
        )

        return () => {
          log.info("unsubscribing", { type })
          bridge.fork(Scope.close(scope, Exit.void))
        }
      })
    }

    const subscribeCallback = Effect.fn("Bus.subscribeCallback")(function* <D extends BusEvent.Definition>(
      def: D,
      callback: (event: Payload<D>) => unknown,
    ) {
      const s = yield* InstanceState.get(state)
      const ps = yield* getOrCreate(s, def)
      return yield* on(ps, def.type, callback)
    })

    const subscribeAllCallback = Effect.fn("Bus.subscribeAllCallback")(function* (callback: (event: any) => unknown) {
      const s = yield* InstanceState.get(state)
      return yield* on(s.wildcard, "*", callback)
    })

    return Service.of({ publish, subscribe, subscribeAll, subscribeCallback, subscribeAllCallback })
  }),
)

export const defaultLayer = layer

const { runPromise, runSync } = makeRuntime(Service, layer)

export async function publish<D extends BusEvent.Definition>(def: D, properties: BusProperties<D>) {
  return runPromise((svc) => svc.publish(def, properties))
}

// runSync is safe because the entire subscribe chain is synchronous Effect
// nodes:
//   - InstanceState.get → ScopedCache lookup, sync after first init
//   - getOrCreate       → Map.get + (PubSub.sliding = Effect.sync(...)) + Map.set
//   - PubSub.subscribe  → Effect.sync allocation
//   - Scope.make        → sync
//   - Effect.forkScoped → schedules a fiber, doesn't await it
//
// If anything in that chain ever yields, `runSync` throws AsyncFiberException
// — we wrap it so the error names the actual call site rather than dumping
// an unhelpful internal stack at the user. Callers that need to subscribe
// from genuinely async contexts should use `Bus.Service.subscribeCallback`
// directly (returns an Effect) rather than this convenience wrapper.
function runSyncSubscribe<R>(label: string, f: (svc: Interface) => Effect.Effect<R>): R {
  try {
    return runSync(f)
  } catch (e) {
    throw new Error(
      `Bus.${label} can only be called synchronously. The subscribe chain yielded — ` +
        `something in InstanceState/getOrCreate/PubSub became async. Use ` +
        `Bus.Service.${label}Callback in an Effect context instead.`,
      { cause: e },
    )
  }
}

export function subscribe<D extends BusEvent.Definition>(def: D, callback: (event: Payload<D>) => unknown) {
  return runSyncSubscribe("subscribe", (svc) => svc.subscribeCallback(def, callback))
}

export function subscribeAll(callback: (event: any) => unknown) {
  return runSyncSubscribe("subscribeAll", (svc) => svc.subscribeAllCallback(callback))
}

export * as Bus from "."
