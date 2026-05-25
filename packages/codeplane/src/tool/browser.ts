import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { Agent } from "@/agent/agent"
import { Flag } from "@/flag/flag"
import { Provider } from "@/provider"
import { Config } from "@/config"

const Action = Schema.Union([
  Schema.Literal("navigate"),
  Schema.Literal("screenshot"),
  Schema.Literal("snapshot"),
  Schema.Literal("click"),
  Schema.Literal("type"),
  Schema.Literal("scroll"),
  Schema.Literal("wait"),
  Schema.Literal("evaluate"),
  Schema.Literal("console"),
  Schema.Literal("html"),
  Schema.Literal("close"),
])

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "The browser action: navigate (go to URL), screenshot (capture viewport), snapshot (get interactive elements with refs), click (click element by ref/selector/coords), type (enter text into element), scroll, wait, evaluate (run JS in page), console (get console logs), html (get page source), close (close browser)",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "URL to navigate to (required for navigate action)",
  }),
  ref: Schema.optional(Schema.String).annotate({
    description: "Element ref from snapshot (e.g. @e12) for click/type actions",
  }),
  selector: Schema.optional(Schema.String).annotate({
    description: "CSS selector for click action when ref is not available",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to type into the element (for type action)",
  }),
  x: Schema.optional(Schema.Number).annotate({
    description: "X coordinate in viewport CSS pixels for coordinate-based click/type/scroll actions",
  }),
  y: Schema.optional(Schema.Number).annotate({
    description: "Y coordinate in viewport CSS pixels for coordinate-based click/type/scroll actions",
  }),
  scrollAmount: Schema.optional(Schema.Number).annotate({
    description: "Scroll amount in wheel notches. Positive scrolls down, negative scrolls up. Default 5.",
  }),
  waitMs: Schema.optional(Schema.Number).annotate({
    description: "Milliseconds to wait for wait action or after a navigation/action before screenshot. Default varies by action.",
  }),
  script: Schema.optional(Schema.String).annotate({
    description: "JavaScript to execute in the page (for evaluate action)",
  }),
  fullPage: Schema.optional(Schema.Boolean).annotate({
    description: "Capture full scrollable page for screenshot (default false)",
  }),
  width: Schema.optional(Schema.Number).annotate({
    description: "Viewport width in CSS pixels (default 1280)",
  }),
  height: Schema.optional(Schema.Number).annotate({
    description: "Viewport height in CSS pixels (default 800)",
  }),
})

// --- Chrome discovery & lifecycle ---

const CHROME_CANDIDATES = [
  process.env.CODEPLANE_CHROMIUM_BIN,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((v): v is string => !!v)

function findChrome(): string | null {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.startsWith("/") || candidate.includes(":\\")) {
      if (existsSync(candidate)) return candidate
      continue
    }
    try {
      const result = spawnSync("which", [candidate], { encoding: "utf8" })
      if (result.status === 0 && result.stdout) {
        const found = result.stdout.trim().split("\n")[0]
        if (found) return found
      }
    } catch {}
  }
  return null
}

const CDP_PORT = 9223
const CDP_HOST = "127.0.0.1"

let chromeProcess: ChildProcess | null = null

async function fetchJSON(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`CDP HTTP ${resp.status}: ${resp.statusText}`)
  return resp.json()
}

async function ensureChrome(): Promise<void> {
  try {
    await fetchJSON(`http://${CDP_HOST}:${CDP_PORT}/json/version`)
    return
  } catch {}

  const bin = findChrome()
  if (!bin) throw new Error("No Chrome/Chromium found. Install Chrome or set CODEPLANE_CHROMIUM_BIN.")

  const userDataDir = `${tmpdir()}/codeplane-chrome-${process.pid}`

  chromeProcess = spawn(bin, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--window-size=1280,800`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  })

  for (let i = 0; i < 30; i++) {
    try {
      await fetchJSON(`http://${CDP_HOST}:${CDP_PORT}/json/version`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error("Chrome did not start within 6 seconds")
}

function killChrome() {
  if (chromeProcess) {
    chromeProcess.kill("SIGTERM")
    chromeProcess = null
  }
}

// --- CDP WebSocket session ---

type CDPSession = {
  ws: WebSocket
  msgId: number
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>
  eventHandlers: Map<string, Set<(params: any) => void>>
  closed: boolean
}

const activeSession: { current: CDPSession | null; pageTargetId: string | null } = {
  current: null,
  pageTargetId: null,
}

async function createCDPSession(): Promise<CDPSession> {
  const pages = (await fetchJSON(`http://${CDP_HOST}:${CDP_PORT}/json`)) as Array<{
    id: string
    type: string
    webSocketDebuggerUrl: string
  }>
  let target = pages.find((p) => p.type === "page")
  if (!target) {
    const newPage = (await (
      await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?url=about:blank`, { method: "PUT" })
    ).json()) as { id: string; type: string; webSocketDebuggerUrl: string }
    target = { ...newPage, type: "page" }
  }
  activeSession.pageTargetId = target.id

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const session: CDPSession = { ws, msgId: 0, pending: new Map(), eventHandlers: new Map(), closed: false }

    ws.onopen = () => {
      resolve(session)
    }
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string)
      if (msg.id && session.pending.has(msg.id)) {
        const { resolve, reject } = session.pending.get(msg.id)!
        session.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message ?? JSON.stringify(msg.error)}`))
        else resolve(msg.result)
      }
      if (msg.method) {
        const handlers = session.eventHandlers.get(msg.method)
        if (handlers) for (const h of handlers) h(msg.params)
      }
    }
    ws.onerror = (err) => {
      if (!session.closed) reject(new Error("CDP WebSocket error"))
    }
    ws.onclose = () => {
      session.closed = true
      if (activeSession.current === session) activeSession.current = null
    }
  })
}

async function getOrCreateSession(): Promise<CDPSession> {
  if (activeSession.current && !activeSession.current.closed) return activeSession.current
  const session = await createCDPSession()
  activeSession.current = session

  session.eventHandlers.set(
    "Runtime.consoleAPICalled",
    new Set([
      (params: any) => {
        if (!consoleBuffer) return
        const args = (params.args ?? [])
          .map((a: any) => a.value ?? a.description ?? JSON.stringify(a))
          .join(" ")
        consoleBuffer.push({ type: params.type, text: args, timestamp: Date.now() })
      },
    ]),
  )

  session.eventHandlers.set(
    "Log.entryAdded",
    new Set([
      (params: any) => {
        if (!consoleBuffer) return
        const entry = params.entry
        consoleBuffer.push({
          type: entry.level ?? "log",
          text: entry.text ?? JSON.stringify(entry),
          timestamp: entry.timestamp ?? Date.now(),
          url: entry.url,
          lineNumber: entry.lineNumber,
        })
      },
    ]),
  )

  await sendCommand(session, "Runtime.enable")
  await sendCommand(session, "Log.enable")
  await sendCommand(session, "Page.enable")
  await sendCommand(session, "Network.enable")
  await sendCommand(session, "DOM.enable")

  return session
}

function sendCommand(session: CDPSession, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    if (session.closed) return reject(new Error("CDP session is closed"))
    const id = ++session.msgId
    session.pending.set(id, { resolve, reject })
    session.ws.send(JSON.stringify({ id, method, params }))
  })
}

type BrowserScreenshot = { dataUrl: string; width: number; height: number }
type ElementTarget = { x: number; y: number; tag?: string; text?: string; value?: string }

async function waitForPageReady(session: CDPSession, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await sendCommand(session, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      })
      const state = result.result?.value
      if (state === "complete" || state === "interactive") return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function captureBrowserScreenshot(
  session: CDPSession,
  params: Pick<Schema.Schema.Type<typeof Parameters>, "width" | "height" | "fullPage">,
): Promise<BrowserScreenshot> {
  const width = Math.min(2560, Math.max(320, params.width ?? 1280))
  const height = Math.min(2160, Math.max(240, params.height ?? 800))
  await sendCommand(session, "Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const { data } = await sendCommand(session, "Page.captureScreenshot", {
    format: "png",
    clip: params.fullPage ? undefined : { x: 0, y: 0, width, height, scale: 1 },
    captureBeyondViewport: !!params.fullPage,
  })
  return { dataUrl: `data:image/png;base64,${data}`, width, height }
}

let refTargets = new Map<string, { backendNodeId: number }>()

async function objectIDForRef(session: CDPSession, ref: string) {
  const target = refTargets.get(ref)
  if (!target) throw new Error(`Element ref ${ref} is stale or unknown. Run browser snapshot again.`)
  const resolved = await sendCommand(session, "DOM.resolveNode", { backendNodeId: target.backendNodeId })
  const objectID = resolved.object?.objectId
  if (!objectID) throw new Error(`Element ref ${ref} could not be resolved. Run browser snapshot again.`)
  return objectID
}

async function objectIDForSelector(session: CDPSession, selector: string) {
  const escaped = JSON.stringify(selector)
  const result = await sendCommand(session, "Runtime.evaluate", {
    expression: `document.querySelector(${escaped})`,
    objectGroup: "codeplane-browser",
  })
  const objectID = result.result?.objectId
  if (!objectID) throw new Error(`Selector not found: ${selector}`)
  return objectID
}

async function elementTarget(session: CDPSession, objectId: string): Promise<ElementTarget> {
  const result = await sendCommand(session, "Runtime.callFunctionOn", {
    objectId,
    returnByValue: true,
    functionDeclaration: `function() {
      this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = this.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        tag: this.tagName,
        text: (this.innerText || this.textContent || '').slice(0, 120),
        value: typeof this.value === 'string' ? this.value.slice(0, 120) : undefined
      };
    }`,
  })
  const value = result.result?.value
  if (!value || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error("Could not determine element coordinates.")
  }
  return value
}

async function clickViewport(session: CDPSession, x: number, y: number) {
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" })
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}

async function typeIntoObject(session: CDPSession, objectId: string, text: string) {
  await sendCommand(session, "Runtime.callFunctionOn", {
    objectId,
    arguments: [{ value: text }],
    returnByValue: true,
    functionDeclaration: `function(text) {
      this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      this.focus();
      if (this.isContentEditable) {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        return { tag: this.tagName, text: this.textContent };
      }
      if ('value' in this) {
        this.value = '';
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.value = text;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return { tag: this.tagName, value: this.value };
      }
      this.textContent = text;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      return { tag: this.tagName, text: this.textContent };
    }`,
  })
}

let consoleBuffer: Array<{ type: string; text: string; timestamp: number; url?: string; lineNumber?: number }> | null =
  null

function enableConsoleBuffer() {
  consoleBuffer = []
}

function drainConsole(maxEntries = 50): string {
  if (!consoleBuffer) return "Console buffer not enabled. Run snapshot first."
  const entries = consoleBuffer.splice(0, Math.min(consoleBuffer.length, maxEntries))
  if (entries.length === 0) return "No console output captured."
  return entries
    .map((e) => `[${e.type.toUpperCase()}] ${e.text}${e.url ? ` (${e.url}:${e.lineNumber ?? "?"})` : ""}`)
    .join("\n")
}

// --- Snapshot generation ---

interface SnapshotNode {
  role: string
  name: string
  ref?: string
  tag?: string
  type?: string
  value?: string
  placeholder?: string
  checked?: boolean
  disabled?: boolean
  children: SnapshotNode[]
}

async function generateSnapshot(session: CDPSession): Promise<{ nodes: SnapshotNode[]; refs: string[] }> {
  enableConsoleBuffer()

  await sendCommand(session, "DOM.getDocument", { depth: -1 })

  const { nodes: axNodes } = await sendCommand(session, "Accessibility.getFullAXTree", {
    depth: -1,
  })

  let refCounter = 0
  const refMap: string[] = []
  const nextRefTargets = new Map<string, { backendNodeId: number }>()

  function resolveAXNode(axId: string): any {
    return axNodes.find((n: any) => n.nodeId === axId)
  }

  async function resolveDOMNode(backendNodeId: number): Promise<SnapshotNode | null> {
    try {
      const { node } = await sendCommand(session, "DOM.pushNodesByBackendIdsToFrontend", {
        backendNodeIds: [backendNodeId],
      })
      if (!node || node.length === 0) return null
      const domNode = node[0]
      return {
        role: "element",
        name: "",
        tag: domNode.nodeName.toLowerCase(),
        type: domNode.attributes?.find((_: string, i: number) => domNode.attributes[i - 1] === "type") ?? undefined,
        placeholder: domNode.attributes?.find((_: string, i: number) => domNode.attributes[i - 1] === "placeholder"),
        disabled: domNode.attributes?.includes("disabled"),
        checked: domNode.attributes?.includes("checked"),
        children: [],
      }
    } catch {
      return null
    }
  }

  function buildFromAX(axNode: any, parentRole?: string): SnapshotNode | null {
    if (!axNode) return null
    const role = (axNode.role?.value ?? "unknown").toLowerCase()
    const name = axNode.name?.value ?? ""
    const properties = axNode.properties ?? []

    const isInteractive =
      role === "link" ||
      role === "button" ||
      role === "textbox" ||
      role === "searchbox" ||
      role === "combobox" ||
      role === "listbox" ||
      role === "menuitem" ||
      role === "menuitemcheckbox" ||
      role === "menuitemradio" ||
      role === "option" ||
      role === "radio" ||
      role === "checkbox" ||
      role === "switch" ||
      role === "tab" ||
      role === "slider" ||
      role === "spinbutton" ||
      role === "textfield" ||
      role === "textarea" ||
      (role === "generic" && name) ||
      (role === "image" && name)

    const isHeading = role === "heading"
    const isLandmark = ["navigation", "main", "banner", "contentinfo", "complementary", "region", "form", "search"].includes(role)
    const isText = role === "statictext" || role === "text"
    const isSignificant = isInteractive || isHeading || isLandmark

    const result: SnapshotNode = {
      role,
      name: name || (isInteractive ? `[${role}]` : ""),
      tag: axNode.ignored ? undefined : undefined,
      children: [],
      disabled: properties.some((p: any) => p.name === "disabled" && p.value?.value === true),
      checked: properties.some((p: any) => p.name === "checked" && p.value?.value === true),
    }

    if (isInteractive) {
      refCounter++
      const ref = `@e${refCounter}`
      result.ref = ref
      refMap.push(ref)
      if (typeof axNode.backendDOMNodeId === "number") {
        nextRefTargets.set(ref, { backendNodeId: axNode.backendDOMNodeId })
      }
    }

    const childIds = axNode.childIds ?? []
    for (const childId of childIds) {
      const childAx = resolveAXNode(childId)
      if (!childAx) continue
      const childRole = (childAx.role?.value ?? "").toLowerCase()
      if (childAx.ignored && childRole === "statictext") {
        if (!result.name) result.name = childAx.name?.value ?? ""
        continue
      }
      if (childAx.ignored && childRole !== "generic") {
        const nested = buildFromAX(childAx, role)
        if (nested) result.children.push(...nested.children)
        continue
      }
      const childNode = buildFromAX(childAx, role)
      if (childNode) result.children.push(childNode)
    }

    return result
  }

  const rootAX = axNodes.find((n: any) => n.role?.value === "RootWebArea")
  const tree: SnapshotNode[] = rootAX ? [buildFromAX(rootAX)!] : []
  refTargets = nextRefTargets

  return { nodes: tree, refs: refMap }
}

function formatSnapshotNode(node: SnapshotNode, indent = 0): string {
  const prefix = "  ".repeat(indent)
  const refStr = node.ref ? ` ${node.ref}` : ""
  let desc = node.name || node.role
  if (node.tag) desc = `<${node.tag}> ${desc}`
  if (node.disabled) desc += " [disabled]"
  if (node.checked) desc += " [checked]"
  if (node.placeholder) desc += ` placeholder="${node.placeholder}"`
  if (node.value) desc += ` value="${node.value}"`

  let line = `${prefix}${node.role}${refStr}: ${desc}`
  if (node.role === "heading") line = `\n${line}`

  const children = node.children.map((c) => formatSnapshotNode(c, indent + 1)).join("\n")
  if (children) line += "\n" + children
  return line
}

// --- Main tool ---

function contextModel(ctx: Tool.Context) {
  const model = ctx.extra?.model
  if (!model || typeof model !== "object") return
  if (!("capabilities" in model)) return
  return model as Provider.Model
}

export const BrowserTool = Tool.define(
  "browser",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      timeoutMs: 120_000,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          // Gate: desktop only
          const client = Flag.CODEPLANE_CLIENT
          const isDesktop = client === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
          if (!isDesktop) {
            return {
              output:
                "Browser control is only available in the desktop app. Launch Codeplane Desktop to use this feature.",
              title: "browser",
              metadata: {},
            }
          }

          // Gate: explicit opt-in
          const config = yield* Config.Service
          const cfg = yield* config.get()
          if (cfg.tools?.browser !== true) {
            return {
              output: "Browser use is disabled. Enable Browser use in Desktop Settings → General first.",
              title: "browser",
              metadata: {},
            }
          }

          // Gate: check vision capability
          const agents = yield* Agent.Service
          const agentInfo = yield* agents.get(ctx.agent)
          const activeModel = contextModel(ctx)
          if (activeModel) {
            if (!activeModel.capabilities?.input?.image) {
              return {
                output:
                  "Browser tool is only available with vision-capable models. Please switch to a model that supports image input.",
                title: "browser",
                metadata: {},
              }
            }
          } else if (!agentInfo.model?.providerID || !agentInfo.model?.modelID) {
            return {
              output: "Browser tool requires a model that supports vision/image input.",
              title: "browser",
              metadata: {},
            }
          } else {
            const providerSvc = yield* Provider.Service
            const model = yield* providerSvc
              .getModel(agentInfo.model.providerID, agentInfo.model.modelID)
              .pipe(Effect.catch(() => Effect.succeed(undefined)), Effect.catchDefect(() => Effect.succeed(undefined)))
            if (!model?.capabilities?.input?.image) {
              return {
                output:
                  "Browser tool is only available with vision-capable models. Please switch to a model that supports image input.",
                title: "browser",
                metadata: {},
              }
            }
          }

          yield* ctx.ask({
            permission: "browser",
            patterns: params.url ? [params.url] : ["*"],
            always: ["*"],
            metadata: { action: params.action, url: params.url },
          })

          const action = params.action

          if (action === "close") {
            killChrome()
            return { output: "Browser closed.", title: "browser", metadata: {} }
          }

          yield* Effect.promise(() => ensureChrome())

          if (action === "navigate") {
            if (!params.url) throw new Error("url is required for navigate action")
            const session = yield* Effect.promise(() => getOrCreateSession())
            yield* Effect.promise(() => sendCommand(session, "Page.navigate", { url: params.url }))
            yield* Effect.promise(() => waitForPageReady(session, params.waitMs ?? 5_000))
            if (params.waitMs) yield* Effect.sleep(`${Math.min(params.waitMs, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `# ${params.url}\n\nNavigated successfully. Screenshot captured.`,
              title: params.url,
              metadata: { url: params.url, screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-navigate-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "screenshot") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Screenshot captured (${screenshot.width}x${screenshot.height}${params.fullPage ? ", full page" : ""}).`,
              title: "Screenshot",
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, width: screenshot.width, height: screenshot.height },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-screenshot-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "snapshot") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const { nodes, refs } = yield* Effect.promise(() => generateSnapshot(session))

            const treeStr = nodes.map((n) => formatSnapshotNode(n)).join("\n")
            const consoleText = drainConsole(30)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))

            const output = [
              "## Page Snapshot",
              "",
              `${refs.length} interactive elements found. Use refs (@e1, @e2, ...) for click/type actions.`,
              "",
              "```",
              treeStr.slice(0, 8000),
              treeStr.length > 8000 ? "\n... (truncated)" : "",
              "```",
              "",
              "## Console",
              "```",
              consoleText.slice(0, 2000),
              "```",
            ].join("\n")

            return {
              output,
              title: `Snapshot (${refs.length} elements)`,
              metadata: {
                elementCount: refs.length,
                screenshotMime: "image/png",
                screenshotDataUrl: screenshot.dataUrl,
                refs: refs.slice(0, 100),
              },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-snapshot-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "click") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            let target: ElementTarget | undefined

            if (params.selector) {
              target = yield* Effect.promise(() => objectIDForSelector(session, params.selector!).then((id) => elementTarget(session, id)))
            } else if (params.ref) {
              target = yield* Effect.promise(() => objectIDForRef(session, params.ref!).then((id) => elementTarget(session, id)))
            } else if (params.x !== undefined && params.y !== undefined) {
              target = { x: params.x, y: params.y }
            } else {
              throw new Error("click requires 'ref', 'selector', or x/y coordinates")
            }

            yield* Effect.promise(() => clickViewport(session, target!.x, target!.y))
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 800, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Clicked ${params.ref ?? (params.selector ? `selector "${params.selector}"` : `(${target!.x}, ${target!.y})`)}. Screenshot after click captured.`,
              title: `Click: ${params.ref ?? params.selector}`,
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, target },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-click-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "type") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            if (!params.text) throw new Error("text is required for type action")
            let target: ElementTarget | undefined

            if (params.ref) {
              const objectId = yield* Effect.promise(() => objectIDForRef(session, params.ref!))
              target = yield* Effect.promise(() => elementTarget(session, objectId))
              yield* Effect.promise(() => typeIntoObject(session, objectId, params.text!))
            } else if (params.selector) {
              const objectId = yield* Effect.promise(() => objectIDForSelector(session, params.selector!))
              target = yield* Effect.promise(() => elementTarget(session, objectId))
              yield* Effect.promise(() => typeIntoObject(session, objectId, params.text!))
            } else if (params.x !== undefined && params.y !== undefined) {
              target = { x: params.x, y: params.y }
              yield* Effect.promise(() => clickViewport(session, params.x!, params.y!))
              yield* Effect.promise(() => sendCommand(session, "Input.insertText", { text: params.text }))
            } else {
              throw new Error("type requires 'ref', 'selector', or x/y coordinates")
            }

            yield* Effect.sleep(`${Math.min(params.waitMs ?? 500, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            const typedTarget = params.ref ?? (params.selector ? `selector "${params.selector}"` : `(${target!.x}, ${target!.y})`)
            return {
              output: `Typed "${params.text}" into ${typedTarget}. Screenshot after typing captured.`,
              title: `Type: "${params.text.slice(0, 30)}"`,
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, target },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-type-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "scroll") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const x = params.x ?? 640
            const y = params.y ?? 400
            const amount = params.scrollAmount ?? 5
            yield* Effect.promise(() =>
              sendCommand(session, "Input.dispatchMouseEvent", {
                type: "mouseWheel",
                x,
                y,
                deltaX: 0,
                deltaY: amount * 120,
              }),
            )
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 500, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Scrolled ${amount} notches at (${x}, ${y}). Screenshot after scroll captured.`,
              title: "Scroll",
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, x, y, amount },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-scroll-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "wait") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const waitMs = Math.min(params.waitMs ?? 1_000, 30_000)
            yield* Effect.sleep(`${waitMs} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Waited ${waitMs}ms. Screenshot after wait captured.`,
              title: "Wait",
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, waitMs },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-wait-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "evaluate") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            if (!params.script) throw new Error("script is required for evaluate action")

            const result = yield* Effect.promise(() =>
              sendCommand(session, "Runtime.evaluate", {
                expression: params.script,
                returnByValue: true,
                awaitPromise: true,
              }),
            )

            const value = result.result?.value ?? result.result?.description ?? JSON.stringify(result)
            return {
              output: `# JavaScript Result\n\n\`\`\`json\n${JSON.stringify(value, null, 2).slice(0, 10000)}\n\`\`\``,
              title: "JS Evaluate",
              metadata: { result: typeof value === "string" ? value : JSON.stringify(value) },
            }
          }

          if (action === "console") {
            const text = drainConsole(100)
            return {
              output: `## Console Logs\n\n\`\`\`\n${text.slice(0, 5000)}\n\`\`\``,
              title: "Console logs",
              metadata: {},
            }
          }

          if (action === "html") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const result = yield* Effect.promise(() =>
              sendCommand(session, "Runtime.evaluate", {
                expression: "document.documentElement.outerHTML",
                returnByValue: true,
              }),
            )
            const html = String(result.result?.value ?? "")
            return {
              output: `## Page HTML\n\n\`\`\`html\n${html.slice(0, 20000)}${html.length > 20000 ? "\n\n... (truncated)" : ""}\n\`\`\``,
              title: "Page HTML",
              metadata: { htmlLength: html.length },
            }
          }

          throw new Error(`Unknown browser action: ${action}`)
        }).pipe(Effect.orDie),
    }
  }) as any,
)
