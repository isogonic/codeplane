import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import * as Tool from "./tool"
import DESCRIPTION from "./browse.txt"

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "URL to navigate to (must be http:// or https://)" }),
  screenshot: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(true))).annotate({
    description: "Capture a PNG screenshot of the rendered viewport (default: true).",
  }),
  width: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(1280))).annotate({
    description: "Viewport width in CSS pixels (default 1280, range 320-2560).",
  }),
  height: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(800))).annotate({
    description: "Viewport height in CSS pixels (default 800, range 240-2160).",
  }),
  wait: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(1500))).annotate({
    description: "Milliseconds to wait after load before capturing (default 1500, max 15000).",
  }),
  fullPage: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description: "Screenshot the full scrollable page instead of just the viewport (default false).",
  }),
})

const CHROMIUM_CANDIDATES = [
  process.env.CODEPLANE_CHROMIUM_BIN,
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter((value): value is string => !!value)

function findChromium(): string | null {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (candidate.startsWith("/")) {
      if (existsSync(candidate)) return candidate
      continue
    }
    // PATH lookup via /usr/bin/which fallback to existsSync of common paths
    try {
      const result = require("node:child_process").spawnSync("which", [candidate], { encoding: "utf8" })
      if (result.status === 0 && result.stdout) {
        const found = result.stdout.trim().split("\n")[0]
        if (found) return found
      }
    } catch {
      // ignore
    }
  }
  return null
}

function chromiumScreenshot(input: {
  bin: string
  url: string
  width: number
  height: number
  fullPage: boolean
  waitMs: number
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(path.join(tmpdir(), "codeplane-browse-"))
    const out = path.join(dir, "screenshot.png")
    const args = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--disable-extensions",
      "--disable-dev-shm-usage",
      `--window-size=${input.width},${input.height}`,
      `--virtual-time-budget=${Math.min(15_000, Math.max(0, input.waitMs))}`,
      `--screenshot=${out}`,
    ]
    if (input.fullPage) args.push("--full-page-screenshot")
    args.push(input.url)

    const child = spawn(input.bin, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("chromium screenshot timed out"))
    }, 30_000)

    child.on("error", (err) => {
      clearTimeout(timeout)
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {}
      reject(err)
    })
    child.on("exit", (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {}
        reject(new Error(`chromium exited with code ${code}: ${stderr.slice(0, 500)}`))
        return
      }
      try {
        const buf = readFileSync(out)
        rmSync(dir, { recursive: true, force: true })
        resolve(buf)
      } catch (err) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {}
        reject(err)
      }
    })
  })
}

async function extractTextFromHTML(html: string): Promise<string> {
  let text = ""
  let skip = false
  const blockSet = new Set(["script", "style", "noscript", "iframe", "object", "embed", "svg"])
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed, svg", {
      element() {
        skip = true
      },
    })
    .on("*", {
      element(element) {
        if (!blockSet.has(element.tagName)) skip = false
      },
      text(input) {
        if (!skip) text += input.text
      },
    })
    .transform(new Response(html))
  await rewriter.text()
  return text.replace(/\s+/g, " ").trim()
}

export const BrowseTool = Tool.define(
  "browse",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          const width = Math.min(2560, Math.max(320, Math.floor(params.width ?? 1280)))
          const height = Math.min(2160, Math.max(240, Math.floor(params.height ?? 800)))
          const waitMs = Math.min(15_000, Math.max(0, Math.floor(params.wait ?? 1500)))
          const wantScreenshot = params.screenshot ?? true
          const fullPage = params.fullPage ?? false

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              screenshot: wantScreenshot,
              width,
              height,
              fullPage,
            },
          })

          // 1) Fetch text content via plain HTTP. Same path as webfetch text mode.
          const textResponse = yield* httpOk
            .execute(
              HttpClientRequest.get(params.url).pipe(
                HttpClientRequest.setHeaders({
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
                  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
                  "Accept-Language": "en-US,en;q=0.9",
                }),
              ),
            )
            .pipe(
              Effect.timeoutOrElse({
                duration: "30 seconds",
                orElse: () => Effect.die(new Error("page fetch timed out")),
              }),
            )

          const html = yield* textResponse.text
          const text = yield* Effect.promise(() => extractTextFromHTML(html))

          // 2) Capture screenshot if requested AND chromium is available.
          let attachment:
            | { type: "file"; mime: string; url: string; filename?: string }
            | null = null
          let screenshotNote = ""

          if (wantScreenshot) {
            const bin = findChromium()
            if (!bin) {
              screenshotNote =
                "\n\n[browse] Screenshot skipped: no chromium binary found. Install chromium (apt-get install -y chromium) or set CODEPLANE_CHROMIUM_BIN to use vision capture."
            } else {
              try {
                const png = yield* Effect.promise(() =>
                  chromiumScreenshot({ bin, url: params.url, width, height, waitMs, fullPage }),
                )
                attachment = {
                  type: "file" as const,
                  mime: "image/png",
                  url: `data:image/png;base64,${png.toString("base64")}`,
                  filename: `browse-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.png`,
                }
              } catch (err) {
                screenshotNote = `\n\n[browse] Screenshot failed: ${err instanceof Error ? err.message : String(err)}`
              }
            }
          }

          const trimmed = text.length > 20_000 ? text.slice(0, 20_000) + "\n\n…[text truncated to 20k chars]" : text

          return {
            output: `# ${params.url}\n\n${trimmed}${screenshotNote}`,
            title: params.url,
            metadata: {},
            attachments: attachment ? [attachment] : undefined,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
