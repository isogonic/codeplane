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
import { UpdateChecker } from "@/installation/update-checker"
import { Log } from "../../util"
import { lazy } from "../../util/lazy"
import { Config } from "../../config"
import { errors } from "../error"
import { killProc as bashInteractiveKill } from "../../tool/bash_interactive_runtime"
import { CronRoutes } from "./cron"

const log = Log.create({ service: "server" })
const configRuntime = makeRuntime(Config.Service, Config.defaultLayer)
const eventHeartbeatMs = 5_000

// Small in-process cache for release-notes lookups. Notes are immutable per
// version, so a long TTL is fine; we just want to avoid hammering GitHub when
// many tabs/clients fetch the same version.
const RELEASE_NOTES_TTL_MS = 6 * 60 * 60 * 1000
const releaseNotesCache = new Map<string, { value: Installation.ReleaseNotes | null; fetchedAt: number }>()
const releaseNotesInflight = new Map<string, Promise<Installation.ReleaseNotes | null>>()
const ReleaseNotesCache = {
  async get(version: string): Promise<Installation.ReleaseNotes | null> {
    const key = Installation.cleanVersion(version)
    const entry = releaseNotesCache.get(key)
    if (entry && Date.now() - entry.fetchedAt < RELEASE_NOTES_TTL_MS) return entry.value
    const inflight = releaseNotesInflight.get(key)
    if (inflight) return inflight
    const promise = AppRuntime.runPromise(Installation.Service.use((svc) => svc.releaseNotes(key)))
      .catch(() => null)
      .then((value) => {
        releaseNotesCache.set(key, { value, fetchedAt: Date.now() })
        return value
      })
      .finally(() => {
        releaseNotesInflight.delete(key)
      })
    releaseNotesInflight.set(key, promise)
    return promise
  },
}

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
        const force = c.req.query("refresh") === "1"
        if (force) UpdateChecker.invalidate()
        const snapshot = await UpdateChecker.current()
        return c.json({
          current: snapshot.current,
          latest: snapshot.latest,
          hasUpdate: snapshot.hasUpdate,
          method: snapshot.method,
        })
      },
    )
    .get(
      "/release-notes/:version",
      describeRoute({
        summary: "Get release notes for a version",
        description: "Fetch the GitHub release notes for the given codeplane version (cached in-process).",
        operationId: "global.releaseNotes",
        responses: {
          200: {
            description: "Release notes",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    tag: z.string(),
                    name: z.string().nullable(),
                    body: z.string().nullable(),
                    url: z.string().nullable(),
                    publishedAt: z.string().nullable(),
                  }),
                ),
              },
            },
          },
          404: {
            description: "No release notes found",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ version: z.string() })),
      async (c) => {
        const { version } = c.req.valid("param")
        const notes = await ReleaseNotesCache.get(version)
        if (!notes) return c.json({ error: "Release notes not found" }, 404)
        return c.json(notes)
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
                      restartRequired: z.boolean().optional(),
                      skipped: z.boolean().optional(),
                      method: z.string().optional(),
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

              const target = Installation.cleanVersion(body.target || (yield* svc.latest(method)))
              if (Installation.isSameVersion(InstallationVersion, target)) {
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
          // Stop re-emitting "update available" for the version we just installed.
          UpdateChecker.acknowledge(target)
          UpdateChecker.invalidate()
        }
        const restart = result.method === "selfhosted" && !result.skipped
        // Non-selfhosted upgrades swap the on-disk binary but the running process
        // keeps the old version until the user restarts. Surface that explicitly
        // so the UI can prompt rather than silently leaving the user on stale code.
        const restartRequired = !result.skipped && !restart
        // For self-hosted deployments, the upgrade script swaps the binary on disk
        // but the in-process binary is unchanged. Exit so the container's restart
        // policy brings us back on the new binary. Delay so the response flushes.
        if (restart) {
          setTimeout(() => process.exit(0), 3000)
        }
        return c.json({
          success: true,
          version: target,
          restart,
          restartRequired: restartRequired || undefined,
          skipped: result.skipped || undefined,
          method: result.method,
        })
      },
    )
    .post(
      "/bash-interactive/:callID/kill",
      describeRoute({
        summary: "Kill a running bash_interactive tool call",
        description: "Sends SIGTERM to the PTY-backed bash_interactive tool call identified by callID.",
        operationId: "global.bashInteractive.kill",
        responses: {
          200: {
            description: "Signal was sent.",
            content: { "application/json": { schema: resolver(z.object({ ok: z.literal(true) })) } },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ callID: z.string() })),
      async (c) => {
        const { callID } = c.req.valid("param")
        const ok = bashInteractiveKill(callID)
        if (!ok) return c.json({ error: "No active bash_interactive call with that id." }, 404)
        return c.json({ ok: true as const })
      },
    ),
)
