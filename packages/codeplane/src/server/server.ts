import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import { Log } from "@/util"
import { Flag } from "@/flag/flag"
import { WorkspaceID } from "@/control-plane/schema"
import { MDNS } from "./mdns"
import {
  AuthMiddleware,
  CompressionMiddleware,
  CorsMiddleware,
  ErrorMiddleware,
  LoggerMiddleware,
  TextJsonMiddleware,
} from "./middleware"
import {
  BodySizeLimitMiddleware,
  IpAllowlistMiddleware,
  OriginValidationMiddleware,
  RequestRateMiddleware,
  SecurityHeadersMiddleware,
  TrustedHostsMiddleware,
} from "./security"
import { FenceMiddleware } from "./fence"
import { initProjectors } from "./projectors"
import { InstanceRoutes } from "./routes/instance"
import { ControlPlaneRoutes } from "./routes/control"
import { PublicUIMiddleware, UIRoutes } from "./routes/ui"
import { GlobalRoutes } from "./routes/global"
import { WorkspaceRouterMiddleware } from "./workspace"
import { InstanceMiddleware } from "./routes/instance/middleware"
import { WorkspaceRoutes } from "./routes/control/workspace"
import { ExperimentalHttpApiServer } from "./routes/instance/httpapi/server"
import { WorkspacePaths } from "./routes/instance/httpapi/workspace"
import { CronScheduler } from "@/cron"
import { PromptQueueWorker } from "@/session/prompt-queue-worker"
import { UpdateChecker } from "@/installation/update-checker"
import { makeRuntime } from "@/effect/run-service"
import { Context } from "effect"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

const log = Log.create({ service: "server" })
const cronSchedulerRuntime = makeRuntime(CronScheduler.Service, CronScheduler.defaultLayer)
const promptQueueWorkerRuntime = makeRuntime(PromptQueueWorker.Service, PromptQueueWorker.defaultLayer)

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

export const Default = lazy(() => create({}))

function create(opts: { cors?: string[] }) {
  // Middleware order matters. From outside to inside:
  //
  //   ErrorMiddleware           — catches anything thrown below.
  //   SecurityHeadersMiddleware — defensive response headers on every
  //                               response (including 4xx/5xx).
  //   IpAllowlistMiddleware     — opt-in via env; drops connections from
  //                               IPs not on the allowlist before doing
  //                               any other work.
  //   RequestRateMiddleware     — blanket per-IP request cap; runs before
  //                               auth so an attacker probing the auth
  //                               surface can't bypass total request
  //                               budgeting.
  //   OriginValidationMiddleware — CSRF defense; only matters for
  //                                state-changing methods + WS upgrades.
  //   BodySizeLimitMiddleware   — refuses absurd Content-Length up front.
  //   TextJsonMiddleware        — content-type normalization.
  //   AuthMiddleware            — Basic Auth + per-IP failed-auth rate
  //                               limit + min-latency floor.
  //   LoggerMiddleware          — only logs after auth so failed-auth
  //                               request paths still hit it but auth
  //                               attempts are dedicated entries.
  //   CompressionMiddleware / CorsMiddleware  — generic.
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(SecurityHeadersMiddleware)
    .use(TrustedHostsMiddleware)
    .use(IpAllowlistMiddleware)
    .use(RequestRateMiddleware)
    .use(OriginValidationMiddleware({ allowedOrigins: opts.cors }))
    .use(BodySizeLimitMiddleware)
    .use(TextJsonMiddleware)
    // CORS runs BEFORE the auth gate so that responses produced ahead of the
    // routes — the public `/global/auth` discovery probe and the 401 the web
    // login screen reads — carry the right `Access-Control-Allow-Origin`
    // header. Without this a cross-origin browser fetch to the probe fails
    // and the app can't tell it needs to show the login screen.
    .use(CorsMiddleware(opts))
    // Serve the public web-UI shell + static assets BEFORE the auth gate so
    // the SPA can boot and render its own login screen instead of the
    // browser's native Basic Auth popup. Only shell/asset GETs are handled
    // here; all API/data requests fall through to AuthMiddleware untouched.
    .use(PublicUIMiddleware)
    .use(AuthMiddleware)
    .use(LoggerMiddleware)
    .use(CompressionMiddleware)
    .route("/global", GlobalRoutes())

  const runtime = adapter.create(app)

  if (Flag.CODEPLANE_WORKSPACE_ID) {
    return {
      app: app
        .use(InstanceMiddleware(Flag.CODEPLANE_WORKSPACE_ID ? WorkspaceID.make(Flag.CODEPLANE_WORKSPACE_ID) : undefined))
        .use(FenceMiddleware)
        .route("/", InstanceRoutes(runtime.upgradeWebSocket)),
      runtime,
    }
  }

  const workspaceApp = new Hono()
  const workspaceLegacyApp = new Hono()
    .use(InstanceMiddleware())
    .route("/experimental/workspace", WorkspaceRoutes())
    .use(WorkspaceRouterMiddleware(runtime.upgradeWebSocket))
  if (Flag.CODEPLANE_EXPERIMENTAL_HTTPAPI) {
    const handler = ExperimentalHttpApiServer.webHandler().handler
    const context = Context.empty() as Context.Context<unknown>
    workspaceApp.get(WorkspacePaths.adaptors, (c) => handler(c.req.raw, context))
    workspaceApp.get(WorkspacePaths.list, (c) => handler(c.req.raw, context))
    workspaceApp.get(WorkspacePaths.status, (c) => handler(c.req.raw, context))
  }
  workspaceApp.route("/", workspaceLegacyApp)

  return {
    app: app
      .route("/", ControlPlaneRoutes())
      .route("/", workspaceApp)
      .route("/", InstanceRoutes(runtime.upgradeWebSocket))
      .route("/", UIRoutes()),
    runtime,
  }
}

export async function openapi() {
  // Build a fresh app with all routes registered directly so
  // hono-openapi can see describeRoute metadata (`.route()` wraps
  // handlers when the sub-app has a custom errorHandler, which
  // strips the metadata symbol).
  const { app } = create({})
  const result = await generateSpecs(app, {
    documentation: {
      info: {
        title: "codeplane",
        version: CodeplaneVersion,
        description: "codeplane api",
      },
      openapi: "3.1.1",
    },
  })
  return result
}

export let url: URL

export async function listen(opts: {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}): Promise<Listener> {
  const built = create(opts)

  const server = await built.runtime.listen(opts)
  await cronSchedulerRuntime.runPromise((svc) => svc.start()).catch((err) => {
    log.error("failed to start cron scheduler", { error: err instanceof Error ? err.message : String(err) })
    throw err
  })
  await promptQueueWorkerRuntime.runPromise((svc) => svc.start()).catch((err) => {
    log.error("failed to start prompt queue worker", { error: err instanceof Error ? err.message : String(err) })
    throw err
  })
  UpdateChecker.start()

  const next = new URL("http://localhost")
  next.hostname = opts.hostname
  next.port = String(server.port)
  url = next

  const mdns =
    opts.mdns &&
    server.port &&
    opts.hostname !== "127.0.0.1" &&
    opts.hostname !== "localhost" &&
    opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(server.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let closing: Promise<void> | undefined
  return {
    hostname: opts.hostname,
    port: server.port,
    url: next,
    stop(close?: boolean) {
      closing ??= (async () => {
        if (mdns) MDNS.unpublish()
        UpdateChecker.stop()
        await cronSchedulerRuntime.runPromise((svc) => svc.stop()).catch(() => undefined)
        await promptQueueWorkerRuntime.runPromise((svc) => svc.stop()).catch(() => undefined)
        await server.stop(close)
      })()
      return closing
    },
  }
}

export * as Server from "./server"
