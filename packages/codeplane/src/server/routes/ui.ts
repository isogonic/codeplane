import { Flag } from "@/flag/flag"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import { getMimeType } from "hono/utils/mime"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const embeddedUIPromise = Flag.CODEPLANE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("codeplane-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

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

export const UIRoutes = (): Hono =>
  new Hono().all("/*", async (c) => {
    const embeddedWebUI = await embeddedUIPromise
    const path = c.req.path

    if (embeddedWebUI) {
      const requested = path.replace(/^\//, "")
      const match =
        embeddedWebUI[requested] ??
        (requested.startsWith("assets/index-") && requested.endsWith(".js")
          ? embeddedWebUI[indexAsset(embeddedWebUI) ?? ""]
          : undefined) ??
        (requested.startsWith("assets/") ? undefined : embeddedWebUI["index.html"]) ??
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
      } else {
        return c.json({ error: "Not Found" }, 404)
      }
    } else {
      // No embedded UI bundle in this build (typical in `bun run
      // dev:server`). Honour CODEPLANE_DEV_UI_URL if the dev set it
      // — points at a running `bun --cwd packages/app dev` server so
      // the Codeplane backend serves live-reloaded UI without
      // requiring a full binary rebuild. The hardcoded
      // `example.invalid` upstream is the production placeholder
      // that release builds replace at compile time; in dev it's
      // unreachable and would 502 every UI request.
      const upstream = Flag.CODEPLANE_DEV_UI_URL ?? "https://example.invalid/app"
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
  })
