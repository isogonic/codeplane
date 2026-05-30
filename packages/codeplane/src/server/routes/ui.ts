import { Flag } from "@/flag/flag"
import { Hono, type Context, type MiddlewareHandler } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import embeddedWebUI from "./codeplane-web-ui.gen"

const themePreloadScript =
  /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data: https: ws: wss:`

const cspForHTML = (html: string) => {
  const match = html.match(themePreloadScript)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

const indexAsset = (embeddedWebUI: Record<string, string>) =>
  Object.keys(embeddedWebUI).find((key) => /^assets\/index-[^/]+\.js$/.test(key))

// Static file extensions that belong to the web UI shell. A request for one
// of these can only ever resolve to a bundled asset (or 404) — never to API
// data — so it is safe to serve without authentication. This is what lets
// the SPA boot far enough to render its own login screen instead of the
// browser's native Basic Auth popup.
const STATIC_ASSET_EXTENSIONS =
  /\.(js|mjs|cjs|css|map|json|wasm|png|jpg|jpeg|gif|svg|webp|avif|ico|cur|woff|woff2|ttf|otf|eot|webmanifest|txt|wav|mp3|ogg)$/i

// Well-known root files that the browser fetches before the app boots.
const STATIC_ROOT_FILES = new Set([
  "/",
  "/index.html",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/robots.txt",
])

// First path segments that belong to the server API. Document navigations
// to these keep flowing through the auth gate and the real API routes
// (preserving every existing behavior — including raw JSON when no password
// is set). Everything else is an SPA route (home, /settings, /:dir deep
// links, …) and is safe to answer with the shell pre-auth.
const API_SEGMENTS = new Set([
  "global",
  "auth",
  "doc",
  "log",
  "experimental",
  "console",
  "project",
  "pty",
  "config",
  "session",
  "permission",
  "question",
  "provider",
  "sync",
  "mcp",
  "find",
  "file",
  "instance",
  "path",
  "vcs",
  "command",
  "agent",
  "skill",
  "lsp",
  "formatter",
  "event",
])

function firstSegment(path: string): string {
  return path.replace(/^\/+/, "").split("/")[0] ?? ""
}

function isStaticAssetPath(path: string): boolean {
  if (STATIC_ROOT_FILES.has(path)) return true
  if (path.startsWith("/assets/")) return true
  return STATIC_ASSET_EXTENSIONS.test(path)
}

// A top-level browser navigation (typing a URL, refreshing a deep link).
// The crucial security property: these are answered with the SPA shell
// (index.html), never with API data, so allowing them through the auth
// gate cannot leak anything. The SPA then probes /global/auth and renders
// the login screen when credentials are required.
function isDocumentNavigation(c: Context): boolean {
  if (API_SEGMENTS.has(firstSegment(c.req.path))) return false
  const dest = c.req.header("sec-fetch-dest")
  if (dest) return dest === "document"
  // Older clients without Sec-Fetch metadata: fall back to Accept. Only a
  // real browser navigation asks for text/html as the top preference.
  const accept = c.req.header("accept") ?? ""
  return accept.includes("text/html")
}

// Decides whether a request may be served as part of the public UI shell
// without authentication. Returns the kind of response to produce:
//   - "asset": serve the matching static file (or 404)
//   - "shell": serve index.html (SPA boot / deep link)
//   - null:    not a public UI request — must go through the auth gate
export function classifyPublicUIRequest(c: Context): "asset" | "shell" | null {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return null
  const path = c.req.path
  if (isStaticAssetPath(path)) return "asset"
  if (isDocumentNavigation(c)) return "shell"
  return null
}

async function serveEmbedded(
  c: Context,
  embedded: Record<string, string>,
  kind: "asset" | "shell" | "any",
): Promise<Response> {
  const path = c.req.path
  const requested = path.replace(/^\//, "")

  // For document navigations / SPA deep links we always serve the shell.
  if (kind === "shell") {
    const shell = embedded["index.html"]
    if (!shell || !(await fs.exists(shell))) return c.json({ error: "Not Found" }, 404)
    const html = await fs.readFile(shell, "utf8")
    c.header("Content-Type", "text/html; charset=utf-8")
    c.header("Cache-Control", "no-store, no-cache, must-revalidate")
    c.header("Content-Security-Policy", cspForHTML(html))
    return c.body(html)
  }

  const match =
    embedded[requested] ??
    (requested.startsWith("assets/index-") && requested.endsWith(".js")
      ? embedded[indexAsset(embedded) ?? ""]
      : undefined) ??
    (requested.startsWith("assets/") ? undefined : embedded["index.html"]) ??
    null
  if (!match) return c.json({ error: "Not Found" }, 404)

  if (await fs.exists(match)) {
    const mime = getMimeType(match) ?? "text/plain"
    c.header("Content-Type", mime)
    if (requested === "" || requested === "index.html" || mime.startsWith("text/html")) {
      c.header("Cache-Control", "no-store, no-cache, must-revalidate")
    } else if (requested.startsWith("assets/index-")) {
      c.header("Cache-Control", "no-store, no-cache, must-revalidate")
    }
    if (mime.startsWith("text/html")) {
      const html = await fs.readFile(match, "utf8")
      c.header("Content-Security-Policy", cspForHTML(html))
      return c.body(html)
    }
    return c.body(new Uint8Array(await fs.readFile(match)))
  }
  return c.json({ error: "Not Found" }, 404)
}

async function serveProxiedUI(c: Context, upstream: string): Promise<Response> {
  const path = c.req.path
  const upstreamHost = (() => {
    try {
      return new URL(upstream).host
    } catch {
      return "app.example.invalid"
    }
  })()
  const response = await proxy(`${upstream.replace(/\/$/, "")}${path}`, {
    raw: c.req.raw,
    headers: {
      ...Object.fromEntries(c.req.raw.headers.entries()),
      host: upstreamHost,
    },
  })
  response.headers.set(
    "Content-Security-Policy",
    response.headers.get("content-type")?.includes("text/html")
      ? cspForHTML(await response.clone().text())
      : csp(),
  )
  return response
}

async function renderUI(c: Context, kind: "asset" | "shell" | "any"): Promise<Response> {
  const resolvedEmbeddedWebUI = Flag.CODEPLANE_DISABLE_EMBEDDED_WEB_UI ? null : embeddedWebUI
  if (resolvedEmbeddedWebUI) return serveEmbedded(c, resolvedEmbeddedWebUI, kind)

  // No embedded UI bundle in this build (typical in `bun run dev:server`).
  // Honour CODEPLANE_DEV_UI_URL if the dev set it — points at a running
  // `bun --cwd packages/app dev` server so the Codeplane backend serves
  // live-reloaded UI without requiring a full binary rebuild.
  const upstream = Flag.CODEPLANE_DEV_UI_URL
  if (!upstream) {
    return c.json(
      {
        error:
          "This Codeplane runtime was built without an embedded web UI. Set CODEPLANE_DEV_UI_URL for dev, or use a packaged runtime with the web UI embedded.",
      },
      503,
    )
  }
  return serveProxiedUI(c, upstream)
}

// Serves the public web-UI shell ahead of the auth gate. Only static shell
// assets and top-level document navigations are handled here; every other
// request (API fetch, SSE, WebSocket) falls through to the authenticated
// routes. Because document navigations are always answered with the SPA
// shell, this can never expose API data to an unauthenticated client.
export const PublicUIMiddleware: MiddlewareHandler = (c, next) => {
  const kind = classifyPublicUIRequest(c)
  if (!kind) return next()
  return renderUI(c, kind)
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => renderUI(c, "any"))
