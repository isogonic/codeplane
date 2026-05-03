import type { JSX } from "@opentui/solid"
import { mount, type TuiHarness } from "../harness/harness"
import { frameToHtml, trimFrame } from "../harness/snapshot"
import { parseChord } from "../harness/keys"

export interface PreviewServerOptions {
  factory: () => JSX.Element
  width?: number
  height?: number
  port?: number
  hostname?: string
  /** Auto-refresh interval in ms for the browser page. Default 250ms. */
  pollMs?: number
}

export interface PreviewHandle {
  url: string
  port: number
  hostname: string
  stop: () => Promise<void>
  harness: TuiHarness
}

/**
 * Boot a TUI fixture and serve a tiny HTML page that streams frames over polling.
 * Endpoints:
 *   GET  /            -> HTML page that polls /frame
 *   GET  /frame.html  -> innerHTML of <pre> for current frame
 *   GET  /frame.json  -> JSON { text, cols, rows, cursor }
 *   POST /press       -> body: { chord }
 *   POST /type        -> body: { text }
 *   POST /resize      -> body: { width, height }
 */
export async function startPreview(opts: PreviewServerOptions): Promise<PreviewHandle> {
  const harness = await mount(opts.factory, { width: opts.width ?? 100, height: opts.height ?? 30 })
  const pollMs = opts.pollMs ?? 250
  const port = opts.port ?? 0
  const hostname = opts.hostname ?? "127.0.0.1"

  const server = Bun.serve({
    port,
    hostname,
    fetch: async (req) => {
      const url = new URL(req.url)
      try {
        switch (url.pathname) {
          case "/":
          case "/index.html":
            return new Response(indexHtml(pollMs), { headers: { "content-type": "text/html; charset=utf-8" } })
          case "/frame.html": {
            const f = harness.frame()
            return new Response(`<pre id="frame">${frameToHtml(f)}</pre>`, {
              headers: { "content-type": "text/html; charset=utf-8" },
            })
          }
          case "/frame.json": {
            const f = harness.frame()
            return Response.json({
              text: trimFrame(f),
              cols: f.cols,
              rows: f.rows,
              cursor: f.cursor,
            })
          }
          case "/press": {
            const body = await safeJson(req)
            parseChord(String(body.chord)) // validate
            await harness.press(String(body.chord))
            return Response.json({ ok: true })
          }
          case "/type": {
            const body = await safeJson(req)
            await harness.type(String(body.text))
            return Response.json({ ok: true })
          }
          case "/resize": {
            const body = await safeJson(req)
            await harness.resize(Number(body.width), Number(body.height))
            return Response.json({ ok: true })
          }
          default:
            return new Response("not found", { status: 404 })
        }
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
      }
    },
  })

  const actualPort = server.port ?? 0
  const url = `http://${hostname}:${actualPort}`
  return {
    url,
    port: actualPort,
    hostname,
    harness,
    stop: async () => {
      server.stop(true)
      await harness.unmount()
    },
  }
}

async function safeJson(req: Request): Promise<any> {
  try {
    return await req.json()
  } catch {
    return {}
  }
}

function indexHtml(pollMs: number): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>tui-suite preview</title><style>
:root { color-scheme: dark; }
body { margin: 0; background: #0a0a0a; color: #fff; font: 14px/1.0 Menlo, Monaco, "Courier New", monospace; }
header { padding: 8px 12px; background: #1a1a1a; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid #333; }
header input, header button { font: inherit; background: #0a0a0a; color: #fff; border: 1px solid #333; padding: 4px 8px; border-radius: 4px; }
header button { cursor: pointer; }
header button:hover { background: #1f1f1f; }
main { padding: 8px 12px; overflow: auto; }
#frame { white-space: pre; line-height: 1.0; margin: 0; }
.muted { opacity: 0.6; font-size: 12px; }
</style></head><body>
<header>
  <strong>tui-suite preview</strong>
  <span class="muted" id="dims">… × …</span>
  <input id="key" placeholder="chord (e.g. ctrl+a)" />
  <button id="pressBtn">press</button>
  <input id="typed" placeholder="text to type" />
  <button id="typeBtn">type</button>
  <span class="muted">polls every ${pollMs}ms</span>
</header>
<main><pre id="frame">loading…</pre></main>
<script>
const frame = document.getElementById('frame');
const dims  = document.getElementById('dims');
async function tick() {
  try {
    const html = await (await fetch('/frame.html')).text();
    frame.outerHTML = html;
    const json = await (await fetch('/frame.json')).json();
    dims.textContent = json.cols + ' × ' + json.rows;
  } catch (e) { /* ignore */ }
}
async function press() {
  const chord = document.getElementById('key').value.trim();
  if (!chord) return;
  await fetch('/press', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chord}) });
  tick();
}
async function typeText() {
  const text = document.getElementById('typed').value;
  if (!text) return;
  await fetch('/type', { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({text}) });
  document.getElementById('typed').value = '';
  tick();
}
document.getElementById('pressBtn').onclick = press;
document.getElementById('typeBtn').onclick = typeText;
document.getElementById('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') press(); });
document.getElementById('typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') typeText(); });
setInterval(tick, ${pollMs});
tick();
</script>
</body></html>`
}
