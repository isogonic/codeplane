import type { Event } from "@codeplane-ai/sdk/v2/client"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { makeEventListener } from "@solid-primitives/event-listener"
import { batch, onCleanup, onMount } from "solid-js"
import z from "zod"
import { createSdkForServer } from "@/utils/server"
import { compactGlobalSdkEventsForFlush, globalSdkCoalesceKey, isGlobalSdkEvent } from "./global-sdk-stream"
import { useLanguage } from "./language"
import { usePlatform } from "./platform"
import { useServer } from "./server"

const abortError = z.object({
  name: z.literal("AbortError"),
})

const globalSdkContext = createSimpleContext({
  name: "GlobalSDK",
  init: () => {
    const language = useLanguage()
    const server = useServer()
    const platform = usePlatform()
    const abort = new AbortController()

    const eventFetch: typeof platform.fetch | undefined =
      !platform.fetch || !server.current || !URL.canParse(server.current.http.url)
        ? undefined
        : (() => {
            const url = new URL(server.current.http.url)
            const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
            return loopback ? undefined : platform.fetch
          })()

    const currentServer = server.current
    if (!currentServer) throw new Error(language.t("error.globalSDK.noServerAvailable"))
    const currentScope = server.scope

    const eventSdk = createSdkForServer({
      signal: abort.signal,
      fetch: eventFetch,
      server: currentServer.http,
    })
    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    type Queued = { directory: string; payload: Event }
    const FLUSH_FRAME_MS = 16
    const FLUSH_BURST_MS = 24
    const BURST_THRESHOLD = 40
    const BURST_WINDOW_MS = 100
    const STREAM_YIELD_MS = 8
    const RECONNECT_DELAY_MS = 250

    let queue: Queued[] = []
    let buffer: Queued[] = []
    const coalesced = new Map<string, number>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0
    const recentEvents: number[] = []

    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined

      if (queue.length === 0) return

      const raw = queue
      queue = buffer
      buffer = raw
      queue.length = 0
      coalesced.clear()

      last = Date.now()
      const events = compactGlobalSdkEventsForFlush(raw)
      batch(() => {
        for (const event of events) {
          // Isolate each emit: a single throwing handler must not blackhole the
          // rest of the flushed batch (which spans all directories).
          try {
            emitter.emit(event.directory, event.payload)
          } catch (error) {
            console.error("global-sdk flush handler threw", { directory: event.directory, error })
          }
        }
      })

      buffer.length = 0
    }

    const schedule = () => {
      if (timer) return
      const now = Date.now()
      recentEvents.push(now)
      const cutoff = now - BURST_WINDOW_MS
      while (recentEvents.length > 0 && recentEvents[0] < cutoff) recentEvents.shift()
      const flushMs = recentEvents.length >= BURST_THRESHOLD ? FLUSH_BURST_MS : FLUSH_FRAME_MS
      const elapsed = now - last
      timer = setTimeout(flush, Math.max(0, flushMs - elapsed))
    }

    let streamErrorLogged = false
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const aborted = (error: unknown) => abortError.safeParse(error).success

    let attempt: AbortController | undefined
    let run: Promise<void> | undefined
    let started = false
    const HEARTBEAT_TIMEOUT_MS = 45_000
    let lastEventAt = Date.now()
    let heartbeat: ReturnType<typeof setTimeout> | undefined
    const resetHeartbeat = () => {
      lastEventAt = Date.now()
      if (heartbeat) clearTimeout(heartbeat)
      heartbeat = setTimeout(() => {
        attempt?.abort()
      }, HEARTBEAT_TIMEOUT_MS)
    }
    const clearHeartbeat = () => {
      if (!heartbeat) return
      clearTimeout(heartbeat)
      heartbeat = undefined
    }

    const start = () => {
      if (started) return run
      started = true
      run = (async () => {
        // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is set to false by stop() which also aborts; both flags are checked to allow graceful exit
        while (!abort.signal.aborted && started) {
          attempt = new AbortController()
          lastEventAt = Date.now()
          const onAbort = () => {
            attempt?.abort()
          }
          abort.signal.addEventListener("abort", onAbort)
          try {
            const events = await eventSdk.global.event({
              signal: attempt.signal,
              onSseError: (error) => {
                if (aborted(error)) return
                if (streamErrorLogged) return
                streamErrorLogged = true
                console.error("[global-sdk] event stream error", {
                  url: currentServer.http.url,
                  fetch: eventFetch ? "platform" : "webview",
                  error,
                })
              },
            })
            let yielded = Date.now()
            resetHeartbeat()
            for await (const event of events.stream) {
              resetHeartbeat()
              streamErrorLogged = false
              const directory = event.directory ?? "global"
              const payload = event.payload
              if (!isGlobalSdkEvent(payload)) continue

              const k = globalSdkCoalesceKey(directory, payload)
              if (k) {
                const i = coalesced.get(k)
                if (i !== undefined) {
                  queue[i] = { directory, payload }
                  continue
                }
                coalesced.set(k, queue.length)
              }
              queue.push({ directory, payload })
              schedule()

              if (Date.now() - yielded < STREAM_YIELD_MS) continue
              yielded = Date.now()
              await wait(0)
            }
          } catch (error) {
            if (!aborted(error) && !streamErrorLogged) {
              streamErrorLogged = true
              console.error("[global-sdk] event stream failed", {
                url: currentServer.http.url,
                fetch: eventFetch ? "platform" : "webview",
                error,
              })
            }
          } finally {
            abort.signal.removeEventListener("abort", onAbort)
            attempt = undefined
            clearHeartbeat()
          }

          if (abort.signal.aborted || !started) return
          await wait(RECONNECT_DELAY_MS)
        }
      })().finally(() => {
        run = undefined
        flush()
      })
      return run
    }

    const stop = () => {
      started = false
      attempt?.abort()
      clearHeartbeat()
    }

    onMount(() => {
      makeEventListener(document, "visibilitychange", () => {
        if (document.visibilityState !== "visible") return
        if (!started) return
        if (Date.now() - lastEventAt < HEARTBEAT_TIMEOUT_MS) return
        attempt?.abort()
      })
    })

    onCleanup(() => {
      stop()
      abort.abort()
      flush()
    })

    const sdk = createSdkForServer({
      server: currentServer.http,
      fetch: platform.fetch,
      throwOnError: true,
    })

    return {
      url: currentServer.http.url,
      scope: currentScope,
      client: sdk,
      event: {
        on: emitter.on.bind(emitter),
        listen: emitter.listen.bind(emitter),
        start,
      },
      createClient(opts: Omit<Parameters<typeof createSdkForServer>[0], "server" | "fetch">) {
        const s = currentServer
        if (!s) throw new Error(language.t("error.globalSDK.serverNotAvailable"))
        return createSdkForServer({
          server: s.http,
          fetch: platform.fetch,
          ...opts,
        })
      },
    }
  },
})

export const useGlobalSDK = () => globalSdkContext.use()
export const GlobalSDKProvider = globalSdkContext.provider
