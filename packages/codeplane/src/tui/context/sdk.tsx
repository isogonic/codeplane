import { createOpencodeClient } from "@/tui/_compat/sdk-v2"
import type { GlobalEvent } from "@/tui/_compat/sdk-v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { Flag } from "@/flag/flag"
import { batch, onCleanup, onMount } from "solid-js"
import {
  compactTuiEventsForFlush,
  isHeartbeatEvent,
  isTuiStreamDeltaEvent,
  tuiEventFlushDelay,
} from "@/tui/util/stream-backpressure"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<{
      event: GlobalEvent
    }>()

    let externalUnsub: (() => void) | undefined
    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 5000
    const healthyConnectionMs = 10_000

    const flush = () => {
      if (queue.length === 0) return
      const events = compactTuiEventsForFlush(queue)
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      if (isHeartbeatEvent(event)) return
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) {
        if (!isTuiStreamDeltaEvent(event)) {
          clearTimeout(timer)
          flush()
        }
        return
      }

      const delay = tuiEventFlushDelay(event, elapsed)
      if (delay > 0) {
        timer = setTimeout(flush, delay)
        return
      }
      flush()
    }

    const droppedEvent = (): GlobalEvent =>
      ({
        directory: "global",
        payload: { type: "server.dropped", properties: {} },
      }) as GlobalEvent

    const waitForReconnect = (ms: number, ctrl: AbortController) =>
      new Promise<void>((resolve) => {
        if (abort.signal.aborted || ctrl.signal.aborted) {
          resolve()
          return
        }
        let timeout: Timer | undefined
        const done = () => {
          if (timeout) clearTimeout(timeout)
          abort.signal.removeEventListener("abort", done)
          ctrl.signal.removeEventListener("abort", done)
          resolve()
        }
        timeout = setTimeout(done, ms)
        abort.signal.addEventListener("abort", done, { once: true })
        ctrl.signal.addEventListener("abort", done, { once: true })
      })

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          const connectedAt = Date.now()
          let sawUsefulEvent = false
          let reportedGap = false

          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })

            if (Flag.CODEPLANE_EXPERIMENTAL_WORKSPACES) {
              // Start syncing workspaces, it's important to do this after
              // we've started listening to events
              await sdk.sync.start().catch(() => {})
            }

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              const type = event.payload.type as string
              if (type !== "server.connected" && type !== "server.heartbeat") {
                sawUsefulEvent = true
              }
              handleEvent(event)
            }
          } catch {
            if (abort.signal.aborted || ctrl.signal.aborted) break
            reportedGap = true
            handleEvent(droppedEvent())
          }

          if (timer) clearTimeout(timer)
          if (queue.length > 0) flush()
          if (abort.signal.aborted || ctrl.signal.aborted) break

          if (!reportedGap) handleEvent(droppedEvent())
          if (sawUsefulEvent || Date.now() - connectedAt >= healthyConnectionMs) {
            attempt = 0
          } else {
            attempt += 1
          }

          const backoff = Math.min(retryDelay * 2 ** Math.max(attempt - 1, 0), maxRetryDelay)
          await waitForReconnect(backoff, ctrl)
        }
      })().catch(() => {})
    }

    onMount(() => {
      if (props.events) {
        void props.events
          .subscribe(handleEvent)
          .then((unsub) => {
            if (abort.signal.aborted) {
              unsub()
              return
            }
            externalUnsub = unsub
          })
          .catch(() => {
            if (!abort.signal.aborted) handleEvent(droppedEvent())
          })

        if (Flag.CODEPLANE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          void sdk.sync.start().catch(() => {})
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      externalUnsub?.()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
