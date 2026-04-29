import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Effect, Schema } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { SyncEvent } from "@/sync"
import { GlobalBus } from "@/bus/global"
import { AppRuntime } from "@/effect/app-runtime"
import { makeRuntime } from "@/effect/run-service"
import { AsyncQueue } from "@/util/queue"
import { Instance } from "../../project/instance"
import { Installation } from "@/installation"
import { InstallationVersion } from "@/installation/version"
import { Log } from "../../util"
import { lazy } from "../../util/lazy"
import { Config } from "../../config"
import { errors } from "../error"
import { CronRoutes } from "./cron"

const log = Log.create({ service: "server" })
const configRuntime = makeRuntime(Config.Service, Config.defaultLayer)
const eventHeartbeatMs = 5_000

export const GlobalDisposedEvent = BusEvent.define("global.disposed", Schema.Struct({}))

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<string | null>) => () => void) {
  return streamSSE(c, async (stream) => {
    const q = new AsyncQueue<string | null>()
    let done = false

    q.push(
      JSON.stringify({
        payload: {
          type: "server.connected",
          properties: {},
        },
      }),
    )

    // Send heartbeats frequently so browsers and access proxies do not treat
    // quiet sessions as stalled while a task is still running.
    const heartbeat = setInterval(() => {
      q.push(
        JSON.stringify({
          payload: {
            type: "server.heartbeat",
            properties: {},
          },
        }),
      )
    }, eventHeartbeatMs)

    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push(null)
      log.info("global event disconnected")
    }

    const unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const data of q) {
        if (data === null) return
        await stream.writeSSE({ data })
      }
    } finally {
      stop()
    }
  })
}

export const GlobalRoutes = lazy(() =>
  new Hono()
    .route("/cron", CronRoutes())
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the CodePlane server.",
        operationId: "global.health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: InstallationVersion })
      },
    )
    .get(
      "/version",
      describeRoute({
        summary: "Get installation version",
        description: "Get current and latest available codeplane versions and the detected install method.",
        operationId: "global.version",
        responses: {
          200: {
            description: "Version information",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    current: z.string(),
                    latest: z.string().nullable(),
                    hasUpdate: z.boolean(),
                    method: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const method = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
        const latest = await AppRuntime.runPromise(Installation.Service.use((svc) => svc.latest(method))).catch(
          () => null as string | null,
        )
        const current = InstallationVersion
        const hasUpdate = !!latest && latest !== current
        return c.json({ current, latest, hasUpdate, method })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the CodePlane system using server-sent events.",
        operationId: "global.event",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      project: z.string().optional(),
                      workspace: z.string().optional(),
                      payload: z.union([...BusEvent.payloads(), ...SyncEvent.payloads()]),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("Cache-Control", "no-cache, no-transform")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamEvents(c, (q) => {
          async function handler(event: any) {
            q.push(JSON.stringify(event))
          }
          GlobalBus.on("event", handler)
          return () => GlobalBus.off("event", handler)
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global CodePlane configuration settings and preferences.",
        operationId: "global.config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await configRuntime.runPromise((cfg) => cfg.getGlobal()))
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global CodePlane configuration settings and preferences.",
        operationId: "global.config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info.zod),
      async (c) => {
        const config = c.req.valid("json")
        const next = await configRuntime.runPromise((cfg) => cfg.updateGlobal(config))
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all CodePlane instances, releasing all resources.",
        operationId: "global.dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/upgrade",
      describeRoute({
        summary: "Upgrade codeplane",
        description: "Upgrade codeplane to the specified version or latest if not specified.",
        operationId: "global.upgrade",
        responses: {
          200: {
            description: "Upgrade result",
            content: {
              "application/json": {
                schema: resolver(
                  z.union([
                    z.object({
                      success: z.literal(true),
                      version: z.string(),
                      restart: z.boolean().optional(),
                      skipped: z.boolean().optional(),
                    }),
                    z.object({
                      success: z.literal(false),
                      error: z.string(),
                    }),
                  ]),
                ),
              },
            },
          },
          ...errors(400, 500),
        },
      }),
      validator(
        "json",
        z
          .object({
            target: z.string().optional(),
          })
          .optional(),
      ),
      async (c) => {
        const body = c.req.valid("json") ?? {}
        const result = await AppRuntime.runPromise(
          Installation.Service.use((svc) =>
            Effect.gen(function* () {
              const method = yield* svc.method()
              if (method === "unknown") {
                return {
                  success: false as const,
                  status: 400 as const,
                  error: "Unknown installation method",
                  method,
                }
              }

              const target = (body.target || (yield* svc.latest(method))).replace(/^v/, "")
              if (target === InstallationVersion) {
                return {
                  success: true as const,
                  status: 200 as const,
                  version: target,
                  method,
                  skipped: true as const,
                }
              }

              const result = yield* Effect.catch(
                svc.upgrade(method, target).pipe(Effect.as({ success: true as const, version: target, method })),
                (err) =>
                  Effect.succeed({
                    success: false as const,
                    status: 500 as const,
                    error: err instanceof Error ? err.message : String(err),
                    method,
                  }),
              )
              if (!result.success) return result
              return { ...result, status: 200 as const }
            }),
          ),
        )
        if (!result.success) {
          return c.json({ success: false, error: result.error }, result.status)
        }
        const target = result.version
        if (!result.skipped) {
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: Installation.Event.Updated.type,
              properties: { version: target },
            },
          })
        }
        const restart = result.method === "selfhosted" && !result.skipped
        // For self-hosted deployments, the upgrade script swaps the binary on disk
        // but the in-process binary is unchanged. Exit so the container's restart
        // policy brings us back on the new binary. Delay so the response flushes.
        if (restart) {
          setTimeout(() => process.exit(0), 3000)
        }
        return c.json({ success: true, version: target, restart, skipped: result.skipped || undefined })
      },
    )
    .post(
      "/transcribe",
      describeRoute({
        summary: "Transcribe audio to text",
        description:
          "Forwards a multipart audio upload to an OpenAI-compatible /v1/audio/transcriptions endpoint and returns the transcript. Configure with CODEPLANE_TRANSCRIBE_API_KEY (required), CODEPLANE_TRANSCRIBE_BASE_URL (default https://api.openai.com), CODEPLANE_TRANSCRIBE_MODEL (default whisper-1).",
        operationId: "global.transcribe",
        responses: {
          200: {
            description: "Transcription result",
            content: {
              "application/json": {
                schema: resolver(z.object({ text: z.string() })),
              },
            },
          },
          ...errors(400, 502),
        },
      }),
      async (c) => {
        const apiKey = process.env.CODEPLANE_TRANSCRIBE_API_KEY
        if (!apiKey) {
          return c.json(
            {
              error:
                "CODEPLANE_TRANSCRIBE_API_KEY is not set. Set it (and optionally CODEPLANE_TRANSCRIBE_BASE_URL / CODEPLANE_TRANSCRIBE_MODEL) to enable voice transcription.",
            },
            400,
          )
        }
        const baseUrl = (process.env.CODEPLANE_TRANSCRIBE_BASE_URL || "https://api.openai.com").replace(/\/+$/, "")
        const model = process.env.CODEPLANE_TRANSCRIBE_MODEL || "whisper-1"

        const incoming = await c.req.formData()
        const file = incoming.get("file")
        if (!(file instanceof File)) {
          return c.json({ error: "Missing 'file' part in multipart body." }, 400)
        }
        const requestedLanguage = incoming.get("language")
        const promptValue = incoming.get("prompt")

        const forward = new FormData()
        forward.set("file", file, file.name || "audio.webm")
        forward.set("model", model)
        forward.set("response_format", "json")
        if (typeof requestedLanguage === "string" && requestedLanguage) forward.set("language", requestedLanguage)
        if (typeof promptValue === "string" && promptValue) forward.set("prompt", promptValue)

        let upstream: Response
        try {
          upstream = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: forward,
          })
        } catch (err) {
          return c.json({ error: `Transcription upstream unreachable: ${err instanceof Error ? err.message : String(err)}` }, 502)
        }
        if (!upstream.ok) {
          const body = await upstream.text().catch(() => "")
          return c.json({ error: `Transcription failed (${upstream.status}): ${body.slice(0, 500)}` }, 502)
        }
        const json = (await upstream.json().catch(() => null)) as { text?: string } | null
        const text = (json?.text ?? "").trim()
        return c.json({ text })
      },
    ),
)
