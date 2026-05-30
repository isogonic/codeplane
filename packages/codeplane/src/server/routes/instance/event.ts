import z from "zod"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Log } from "@/util"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { AsyncQueue } from "@/util/queue"
import { Flag } from "@/flag/flag"
import { ResumeBuffer, type BufferedEvent } from "../../sse-resume-buffer"

const log = Log.create({ service: "server" })

/**
 * Cap on outbound buffer per SSE connection. Protects the server from
 * a slow consumer pinning unbounded memory while events are produced
 * at high rate (text-delta during streaming can hit 30+/s). On overflow
 * we drop the oldest event and signal the client to refetch state via
 * a `server.dropped` synthetic event.
 *
 * Override via CODEPLANE_SSE_BUFFER_SIZE for ops tuning under unusual load.
 */
const SSE_OUTBOUND_MAX = Flag.CODEPLANE_SSE_BUFFER_SIZE ?? 4096

/**
 * Maximum events kept in memory for `Last-Event-ID` resume. SSE only
 * needs to bridge transient drops (a few seconds for a TCP retry, up to
 * the proxy idle timeout). 1024 events covers minutes of normal
 * activity; clients that drop for longer have to refetch state — that's
 * what the `server.resume_failed` event signals.
 */
const RESUME_BUFFER_SIZE = 1024

/** Heartbeat cadence — must be < the shortest proxy idle timeout in the path. */
const HEARTBEAT_MS = 10_000

export const EventRoutes = () => {
  // Singleton subscriber feeds the resume buffer for the lifetime of
  // the route factory. Every event published to the wildcard PubSub
  // gets a monotonic id assigned exactly once; per-connection callbacks
  // receive the same `BufferedEvent` so live and replay paths share IDs.
  //
  // Lazy-initialised on first request because Bus.subscribeAll requires
  // a bound InstanceState, which isn't established yet when the route
  // factory runs at server-construction time.
  const buffer = new ResumeBuffer(RESUME_BUFFER_SIZE)
  const liveSubscribers = new Set<(ev: BufferedEvent) => void>()
  let busSubscribed = false
  const ensureBusSubscribed = () => {
    if (busSubscribed) return
    busSubscribed = true
    Bus.subscribeAll((event) => {
      const ev = buffer.append(JSON.stringify(event))
      for (const fn of liveSubscribers) {
        try {
          fn(ev)
        } catch (err) {
          // A throwing subscriber must not poison delivery to other
          // connections. Log and move on; the broken subscriber will
          // be dropped when its connection unsub's normally.
          log.error("sse live subscriber threw", { error: err })
        }
      }
    })
  }

  return new Hono().get(
    "/event",
    describeRoute({
      summary: "Subscribe to events",
      description:
        "Server-Sent Events stream. Each event has an `id:` field (monotonic, per server process). " +
        "Reconnect with the standard `Last-Event-ID` header to replay missed events from an in-memory ring " +
        "buffer (last ~1024 events). If the requested id is older than the buffer's tail, the server emits " +
        "a `server.resume_failed` event and the client should refetch state.",
      operationId: "event.subscribe",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z.union(BusEvent.payloads()).meta({
                  ref: "Event",
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      log.info("event connected")
      c.header("Cache-Control", "no-cache, no-transform")
      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")
      ensureBusSubscribed()

      const lastEventID = parseLastEventID(c.req.header("Last-Event-ID"))

      return streamSSE(c, async (stream) => {
        type OutboundItem = { kind: "event"; ev: BufferedEvent } | { kind: "heartbeat" } | { kind: "close" }

        let droppedSinceLastFlush = false
        const q = new AsyncQueue<OutboundItem>({
          maxSize: SSE_OUTBOUND_MAX,
          onDrop: () => {
            // Signaled to the writer loop, which emits a one-shot
            // `server.dropped` synthetic event next time it runs.
            droppedSinceLastFlush = true
          },
        })

        // Backlog events that arrive while we're still emitting the
        // replay window so we don't double-push (replay covers everything
        // up to its tail; live events with id > replayMaxID continue
        // through onLive directly).
        let replayDone = false
        const backlog: BufferedEvent[] = []

        const onLive = (ev: BufferedEvent) => {
          if (!replayDone) {
            backlog.push(ev)
            return
          }
          q.push({ kind: "event", ev })
        }
        liveSubscribers.add(onLive)

        // Replay: stream events the client missed since `Last-Event-ID`.
        // If the buffer rotated past it, emit `server.resume_failed` so
        // the client knows to refetch state, then continue live.
        let replayMaxID = lastEventID ?? 0
        if (lastEventID !== null) {
          const replay = buffer.since(lastEventID)
          if (replay === null) {
            // Per-connection notice — emit directly with id 0 (a non-resumable
            // synthetic, like `server.connected`). Appending it to the SHARED
            // resume buffer gave it a global id and replayed this one client's
            // "resume_failed" to every other client that later reconnected.
            q.push({
              kind: "event",
              ev: { id: 0, data: JSON.stringify({ type: "server.resume_failed", properties: { lastEventID } }) },
            })
            // The client will refetch state, so skip everything already
            // buffered and continue from the current tip.
            replayMaxID = buffer.nextId - 1
          } else {
            for (const ev of replay) {
              q.push({ kind: "event", ev })
              replayMaxID = ev.id
            }
          }
        } else {
          // Fresh connection — synthetic `server.connected` does not go
          // through the resume buffer (it's per-connection noise).
          q.push({
            kind: "event",
            ev: { id: 0, data: JSON.stringify({ type: "server.connected", properties: {} }) },
          })
        }

        // Drain anything that arrived during replay, dedup against the
        // replay window, then flip to direct live mode.
        for (const ev of backlog) {
          if (ev.id <= replayMaxID) continue
          q.push({ kind: "event", ev })
        }
        backlog.length = 0
        replayDone = true

        const heartbeat = setInterval(() => {
          q.push({ kind: "heartbeat" })
        }, HEARTBEAT_MS)

        let done = false
        const stop = () => {
          if (done) return
          done = true
          clearInterval(heartbeat)
          liveSubscribers.delete(onLive)
          unsubDispose()
          q.push({ kind: "close" })
          q.close()
          log.info("event disconnected")
        }

        const unsubDispose = Bus.subscribe(Bus.InstanceDisposed, () => stop())

        stream.onAbort(stop)

        try {
          for await (const item of q) {
            if (item.kind === "close") return
            if (droppedSinceLastFlush) {
              droppedSinceLastFlush = false
              await stream.writeSSE({
                data: JSON.stringify({ type: "server.dropped", properties: {} }),
              })
            }
            if (item.kind === "heartbeat") {
              await stream.writeSSE({
                data: JSON.stringify({ type: "server.heartbeat", properties: {} }),
              })
              continue
            }
            // id 0 is the synthetic "connected" event — emit without an
            // `id:` line so it isn't treated as a resumable position.
            if (item.ev.id > 0) {
              await stream.writeSSE({ data: item.ev.data, id: String(item.ev.id) })
            } else {
              await stream.writeSSE({ data: item.ev.data })
            }
          }
        } finally {
          stop()
        }
      })
    },
  )
}

function parseLastEventID(header: string | undefined): number | null {
  if (!header) return null
  const n = Number.parseInt(header, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}
