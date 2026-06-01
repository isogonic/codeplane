import { Installation } from "@/installation"
import { Server } from "@/server/server"
import * as Log from "@/util/log"
import { InstanceRuntime } from "@/tui/_compat/instance-runtime"
import { WithInstance } from "@/tui/_compat/project-with-instance"
import { Rpc } from "@/tui/_compat/util-rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/tui/_compat/config-config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/tui/_compat/server-auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@/util/codeplane-process"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/tui/_compat/server-global-lifecycle"

// AppRuntime.runPromise is typed against a fixed service set. The reload
// path uses Config.Service which isn't statically in that set but IS provided
// at runtime by the worker's bootstrap. Cast just the runner to accept any
// Effect rather than scattering casts through the call site.
const runPromise = AppRuntime.runPromise as <A>(
  effect: Effect.Effect<A, unknown, never>,
) => Promise<A>

ensureProcessMetadata("worker")

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

Heap.start()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC.
// Track the handler so it can be removed on shutdown to avoid leaking
// listeners across reload cycles.
let globalEventHandler: ((event: unknown) => void) | undefined
globalEventHandler = (event: unknown) => {
  try {
    Rpc.emit("global.event", event)
  } catch (error) {
    console.error("[worker] global event forward failed", error)
  }
}
GlobalBus.on("event", globalEventHandler)

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await WithInstance.provide({
      directory: input.directory,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    await runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }) as unknown as Effect.Effect<void, unknown, never>,
    )
  },
  async shutdown() {
    Log.Default.info("worker shutting down")

    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    if (globalEventHandler) {
      GlobalBus.off("event", globalEventHandler)
      globalEventHandler = undefined
    }
  },
}

Rpc.listen(rpc)
