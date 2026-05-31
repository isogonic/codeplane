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
import { Flag } from "@/flag/flag"
import { verifyCode as verifyTotpCode } from "../totp"
import { issueToken as issueOtpToken, OTP_SESSION_TTL_MS } from "../totp-session"
import { createHash, timingSafeEqual } from "node:crypto"
import * as AuthRateLimit from "../rate-limit"

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

// Constant-time Basic Auth check for the /auth/verify route, which owns the
// password compare for the second-factor exchange (it runs ahead of the auth
// gate). Mirrors the digest+timingSafeEqual path used elsewhere.
function checkBasicAuthHeader(header: string | undefined, username: string, password: string): boolean {
  if (!header) return false
  const match = /^Basic\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  let decoded: string
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8")
  } catch {
    return false
  }
  const index = decoded.indexOf(":")
  if (index === -1) return false
  const safeEqual = (a: string, b: string) => {
    const da = createHash("sha256").update(a).digest()
    const db = createHash("sha256").update(b).digest()
    return da.length === db.length && timingSafeEqual(da, db)
  }
  return safeEqual(decoded.slice(0, index), username) && safeEqual(decoded.slice(index + 1), password)
}

// Derive a rate-limit key from forwarded-IP headers (same trust order as the
// auth middleware) so the verify endpoint shares the brute-force defense.
function otpClientKey(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")
  if (cf) return `otp:${cf.trim()}`
  const real = c.req.header("x-real-ip")
  if (real) return `otp:${real.trim()}`
  const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  if (xff) return `otp:${xff}`
  return "otp:unknown"
}

export const GlobalDisposedEvent = BusEvent.define("global.disposed", Schema.Struct({}))

/**
 * Cap on outbound buffer per global SSE connection. Same risk as the
 * per-instance stream — a slow consumer holding heartbeats + cross-instance
 * events otherwise pins unbounded RSS. Drop-oldest-on-overflow, surface a
 * one-shot `server.dropped` so the client knows to refetch state.
 */
const GLOBAL_SSE_OUTBOUND_MAX = 4096

type GlobalOutboundItem = { kind: "event"; data: string } | { kind: "heartbeat" } | { kind: "close" }

async function streamEvents(c: Context, subscribe: (q: AsyncQueue<GlobalOutboundItem>) => () => void) {
  return streamSSE(c, async (stream) => {
    let droppedSinceLastFlush = false
    let totalDropped = 0
    const q = new AsyncQueue<GlobalOutboundItem>({
      maxSize: GLOBAL_SSE_OUTBOUND_MAX,
      onDrop: () => {
        droppedSinceLastFlush = true
        totalDropped += 1
      },
    })
    let done = false

    q.push(
      {
        kind: "event",
        data: JSON.stringify({
          directory: "global",
          payload: {
            type: "server.connected",
            properties: {},
          },
        }),
      },
    )

    // Send heartbeats frequently so browsers and access proxies do not treat
    // quiet sessions as stalled while a task is still running.
    const heartbeat = setInterval(() => {
      q.push({
        kind: "heartbeat",
      })
    }, eventHeartbeatMs)

    let unsub = () => {}
    const stop = () => {
      if (done) return
      done = true
      clearInterval(heartbeat)
      unsub()
      q.push({ kind: "close" })
      q.close()
      if (totalDropped > 0) {
        log.warn("global event disconnected with drops", { totalDropped })
      } else {
        log.info("global event disconnected")
      }
    }

    unsub = subscribe(q)

    stream.onAbort(stop)

    try {
      for await (const item of q) {
        if (item.kind === "close") return
        // Surface backlog overflow once per flush so the client can refetch.
        if (droppedSinceLastFlush) {
          droppedSinceLastFlush = false
          await stream.writeSSE({
            data: JSON.stringify({
              directory: "global",
              payload: { type: "server.dropped", properties: {} },
            }),
          })
        }
        if (item.kind === "heartbeat") {
          await stream.writeSSE({
            data: JSON.stringify({
              directory: "global",
              payload: {
                type: "server.heartbeat",
                properties: {},
              },
            }),
          })
          continue
        }
        await stream.writeSSE({ data: item.data })
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
        description: "Get health information about the Codeplane server.",
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
    .post(
      "/auth/verify",
      describeRoute({
        summary: "Verify second factor",
        description:
          "Exchange a valid Basic Auth password plus a TOTP code for a short-lived second-factor session token. Returns 401 if the password is wrong, 400 if TOTP is not enabled, and 401 with { totp: true } if the code is invalid.",
        operationId: "global.auth.verify",
        responses: {
          200: {
            description: "Second-factor session token",
            content: {
              "application/json": {
                schema: resolver(z.object({ token: z.string(), expiresAt: z.number() })),
              },
            },
          },
        },
      }),
      validator("json", z.object({ code: z.string().min(1).max(16) })),
      async (c) => {
        const password = Flag.CODEPLANE_SERVER_PASSWORD
        const secret = Flag.CODEPLANE_SERVER_TOTP_SECRET
        if (!password || !secret) {
          return c.json({ error: "Two-factor authentication is not enabled on this server." }, 400)
        }
        const clientKey = otpClientKey(c)
        const gate = AuthRateLimit.check(clientKey)
        if (!gate.allowed) {
          const retrySeconds = Math.max(1, Math.ceil(gate.retryAfterMs / 1000))
          return c.json({ error: "Too many attempts. Try again later." }, 429, {
            "retry-after": String(retrySeconds),
          })
        }
        const username = Flag.CODEPLANE_SERVER_USERNAME ?? "codeplane"
        // Re-check the password here: the verify endpoint runs ahead of the
        // auth gate (the client can't pass the gate yet), so it owns the
        // password compare for this request.
        if (!checkBasicAuthHeader(c.req.header("authorization"), username, password)) {
          AuthRateLimit.recordFailure(clientKey)
          return c.json({ error: "Unauthorized" }, 401)
        }
        const code = c.req.valid("json").code
        if (!verifyTotpCode(secret, code)) {
          AuthRateLimit.recordFailure(clientKey)
          log.warn("totp failure", { audit: true, client: clientKey })
          return c.json({ error: "Invalid code", totp: true }, 401)
        }
        AuthRateLimit.recordSuccess(clientKey)
        const token = issueOtpToken({ password, secret })
        return c.json({ token, expiresAt: Date.now() + OTP_SESSION_TTL_MS })
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
        description: "Subscribe to global events from the Codeplane system using server-sent events.",
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
          function handler(event: any) {
            q.push({ kind: "event", data: JSON.stringify(event) })
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
        description: "Retrieve the current global Codeplane configuration settings and preferences.",
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
        return c.json(await configRuntime.runPromise((cfg) => cfg.getGlobalRaw()))
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global Codeplane configuration settings and preferences.",
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
        description: "Clean up and dispose all Codeplane instances, releasing all resources.",
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
      "/restart",
      describeRoute({
        summary: "Restart codeplane",
        description:
          "Dispose all instances so mode, plugin, and MCP changes are reloaded on the next request. " +
          "If disposal fails, exits the process so a supervisor (docker/systemd/pm2) can restart it.",
        operationId: "global.restart",
        responses: {
          200: {
            description: "Restart result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    ok: z.literal(true),
                    method: z.enum(["reload", "exit"]),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        try {
          await Instance.disposeAll()
          GlobalBus.emit("event", {
            directory: "global",
            payload: {
              type: GlobalDisposedEvent.type,
              properties: {},
            },
          })
          return c.json({ ok: true as const, method: "reload" as const })
        } catch (error) {
          log.warn("restart dispose failed, falling back to process exit", { error })
          setTimeout(() => process.exit(0), 500)
          return c.json({ ok: true as const, method: "exit" as const })
        }
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
        // Outer try/catch ensures any unhandled failure inside the Effect
        // pipeline (svc.method() / svc.latest() rejecting for network, PATH,
        // or permission reasons) is surfaced as a structured JSON 500 instead
        // of an empty `Failed to load resource: 500` from Hono.
        let result
        try {
          result = await AppRuntime.runPromise(
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
                if (method === "desktop") {
                  return {
                    success: false as const,
                    status: 400 as const,
                    error:
                      "Updates for desktop-managed instances are handled by the Codeplane desktop app. " +
                      "Open the desktop app's Updates panel to install a new version.",
                    method,
                  }
                }
                if (method === "managed-local") {
                  // The TUI spawned this server from
                  // local_server/binaries/<version>/. Tell the client
                  // exactly how to upgrade — the manager fetches new
                  // versions on next start, no in-place swap is possible
                  // for a binary that's currently executing.
                  const requested = body.target ? `v${Installation.cleanVersion(body.target)}` : "the latest version"
                  return {
                    success: false as const,
                    status: 400 as const,
                    error:
                      `This server runs as a managed local instance under the TUI. ` +
                      `To upgrade to ${requested}, quit the TUI and restart it — the manager will ` +
                      `fetch the new runtime version into local_server/binaries/ on next launch. ` +
                      `To pre-fetch without restarting the current session, run ` +
                      `\`codeplane instance local install ${body.target ?? "latest"}\` from another shell.`,
                    method,
                  }
                }

                const target = Installation.cleanVersion(body.target || (yield* svc.latest(method)))
                if (Installation.isDesktopReleaseVersion(target)) {
                  return {
                    success: false as const,
                    status: 400 as const,
                    error: `Desktop release targets (${target}) are only valid for the desktop shell`,
                    method,
                  }
                }
                if (Installation.isMobileReleaseVersion(target)) {
                  // Same shape as the desktop guard above. Mobile artefacts
                  // (iOS / Android) update through the App Store / Play
                  // Store, not through the in-app update path.
                  return {
                    success: false as const,
                    status: 400 as const,
                    error: `Mobile release targets (${target}) are only valid for the mobile shell — update via the App Store / Play Store`,
                    method,
                  }
                }
                if (Installation.isPreReleaseVersion(target)) {
                  return {
                    success: false as const,
                    status: 400 as const,
                    error: `Pre-release targets (${target}) cannot be installed through the automatic update path. Install manually if you want a preview build.`,
                    method,
                  }
                }
                if (Installation.isSameVersion(InstallationVersion, target)) {
                  return {
                    success: true as const,
                    status: 200 as const,
                    version: target,
                    method,
                    skipped: true as const,
                  }
                }

                const inner = yield* Effect.catch(
                  svc.upgrade(method, target).pipe(Effect.as({ success: true as const, version: target, method })),
                  (err) =>
                    Effect.succeed({
                      success: false as const,
                      status: 500 as const,
                      error: err instanceof Error ? err.message : String(err),
                      method,
                    }),
                )
                if (!inner.success) return inner
                return { ...inner, status: 200 as const }
              }),
            ),
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json(
            {
              success: false,
              error: `Upgrade failed: ${message}`,
            },
            500,
          )
        }
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
