import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { Flag } from "@/flag/flag"
import { Config } from "@/config"

const Action = Schema.Union([
  Schema.Literal("navigate"),
  Schema.Literal("screenshot"),
  Schema.Literal("snapshot"),
  Schema.Literal("click"),
  Schema.Literal("hover"),
  Schema.Literal("drag"),
  Schema.Literal("type"),
  Schema.Literal("key"),
  Schema.Literal("press"),
  Schema.Literal("scroll"),
  Schema.Literal("wait"),
  Schema.Literal("evaluate"),
  Schema.Literal("console"),
  Schema.Literal("html"),
  Schema.Literal("back"),
  Schema.Literal("forward"),
  Schema.Literal("reload"),
  Schema.Literal("close"),
])

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "The browser action: navigate, screenshot, snapshot, click, hover, drag, type, key/press, scroll, wait, evaluate, console, html, back, forward, reload, or close.",
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
    description: "Text to type into the element, or a key/shortcut for key/press actions.",
  }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key or shortcut to press, such as Enter, Escape, Tab, Cmd+L, Ctrl+R, ArrowDown, or Shift+Tab.",
  }),
  x: Schema.optional(Schema.Number).annotate({
    description: "X coordinate in viewport CSS pixels for coordinate-based click/hover/drag/type/scroll actions.",
  }),
  y: Schema.optional(Schema.Number).annotate({
    description: "Y coordinate in viewport CSS pixels for coordinate-based click/hover/drag/type/scroll actions.",
  }),
  to: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))).annotate({
    description: "Destination viewport coordinate [x, y] for drag actions.",
  }),
  button: Schema.optional(Schema.Literals(["left", "right", "middle"])).annotate({
    description: "Mouse button for click or drag actions. Defaults to left.",
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

const CDP_HOST = "127.0.0.1"

let chromeProcess: ChildProcess | null = null
let cdpPort = Number(process.env.CODEPLANE_BROWSER_CDP_PORT?.trim() || "") || undefined

async function fetchJSON(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`CDP HTTP ${resp.status}: ${resp.statusText}`)
  return resp.json()
}

function cdpBase(port = cdpPort) {
  if (!port) throw new Error("Browser DevTools endpoint is not initialized.")
  return `http://${CDP_HOST}:${port}`
}

function configuredCDPPort() {
  return Number(process.env.CODEPLANE_BROWSER_CDP_PORT?.trim() || "") || undefined
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, CDP_HOST, () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port)
        else reject(new Error("Could not allocate a browser DevTools port."))
      })
    })
  })
}

async function ensureChrome(): Promise<void> {
  cdpPort = configuredCDPPort() ?? cdpPort
  if (cdpPort) {
    try {
      await fetchJSON(`${cdpBase()}/json/version`)
      return
    } catch {
      if (chromeProcess) chromeProcess = null
    }
  }

  cdpPort = configuredCDPPort() ?? (await freePort())

  try {
    await fetchJSON(`${cdpBase()}/json/version`)
    return
  } catch {}

  const bin = findChrome()
  if (!bin) throw new Error("No Chrome/Chromium found. Install Chrome or set CODEPLANE_CHROMIUM_BIN.")

  const userDataDir = `${tmpdir()}/codeplane-chrome-${process.pid}`

  chromeProcess = spawn(bin, [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
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
      await fetchJSON(`${cdpBase()}/json/version`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error("Chrome did not start within 6 seconds")
}

function killChrome() {
  activeSession.current?.ws.close()
  activeSession.current = null
  activeSession.pageTargetId = null
  refTargets = new Map()
  if (chromeProcess) {
    chromeProcess.kill("SIGTERM")
    chromeProcess = null
  }
  if (!configuredCDPPort()) cdpPort = undefined
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
  if (!cdpPort) await ensureChrome()
  const pages = (await fetchJSON(`${cdpBase()}/json`)) as Array<{
    id: string
    type: string
    webSocketDebuggerUrl: string
  }>
  let target = pages.find((p) => p.type === "page")
  if (!target) {
    const newPage = (await (
      await fetch(`${cdpBase()}/json/new?url=about:blank`, { method: "PUT" })
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
  if (params.fullPage) {
    const metrics = await sendCommand(session, "Page.getLayoutMetrics")
    const content = metrics.cssContentSize ?? metrics.contentSize
    const fullWidth = Math.ceil(Math.max(width, content?.width ?? width))
    const fullHeight = Math.ceil(Math.max(height, content?.height ?? height))
    const { data } = await sendCommand(session, "Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: fullWidth, height: fullHeight, scale: 1 },
      captureBeyondViewport: true,
    })
    return { dataUrl: `data:image/png;base64,${data}`, width: fullWidth, height: fullHeight }
  }
  const { data } = await sendCommand(session, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width, height, scale: 1 },
    captureBeyondViewport: false,
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

function viewportCoordinate(value: number[] | undefined, name: string) {
  if (!value || value.length < 2) throw new Error(`${name} coordinate is required as [x, y].`)
  const x = Math.round(value[0])
  const y = Math.round(value[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${name} coordinate must contain finite numbers.`)
  return { x, y }
}

function viewportXY(x: number | undefined, y: number | undefined, name: string) {
  if (x === undefined || y === undefined) throw new Error(`${name} coordinate is required as [x, y].`)
  return viewportCoordinate([x, y], name)
}

function mouseButton(button: Schema.Schema.Type<typeof Parameters>["button"]) {
  return button ?? "left"
}

async function clickViewport(session: CDPSession, x: number, y: number, button: Schema.Schema.Type<typeof Parameters>["button"]) {
  const resolved = mouseButton(button)
  const buttons = resolved === "left" ? 1 : resolved === "right" ? 2 : 4
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" })
  await sendCommand(session, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: resolved,
    buttons,
    clickCount: 1,
  })
  await sendCommand(session, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: resolved,
    buttons: 0,
    clickCount: 1,
  })
}

async function hoverViewport(session: CDPSession, x: number, y: number) {
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" })
}

async function dragViewport(session: CDPSession, from: ElementTarget, to: ElementTarget, button: Schema.Schema.Type<typeof Parameters>["button"]) {
  const resolved = mouseButton(button)
  await sendCommand(session, "Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y, button: "none" })
  await sendCommand(session, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: resolved,
    buttons: resolved === "left" ? 1 : resolved === "right" ? 2 : 4,
    clickCount: 1,
  })
  for (let i = 1; i <= 12; i++) {
    const x = from.x + ((to.x - from.x) * i) / 12
    const y = from.y + ((to.y - from.y) * i) / 12
    await sendCommand(session, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: resolved,
      buttons: resolved === "left" ? 1 : resolved === "right" ? 2 : 4,
    })
  }
  await sendCommand(session, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: resolved,
    buttons: 0,
    clickCount: 1,
  })
}

const KEY_ALIASES: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
  enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  return: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
  tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  esc: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  end: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
}

function keyDescriptor(input: string) {
  const parts = input.split("+").map((part) => part.trim()).filter(Boolean)
  const rawKey = parts.pop() ?? ""
  const modifiers = parts.reduce((mask, part) => {
    const item = part.toLowerCase()
    if (item === "alt" || item === "option") return mask | 1
    if (item === "ctrl" || item === "control") return mask | 2
    if (item === "cmd" || item === "command" || item === "meta" || item === "super") return mask | 4
    if (item === "shift") return mask | 8
    return mask
  }, 0)
  const key = rawKey.length === 1 ? rawKey : rawKey.toLowerCase()
  const alias = KEY_ALIASES[key]
  if (alias) return { ...alias, modifiers, text: modifiers === 0 && alias.key.length === 1 ? alias.key : undefined }
  if (rawKey.length === 1) {
    const upper = rawKey.toUpperCase()
    return {
      key: rawKey,
      code: /[a-z]/i.test(rawKey) ? `Key${upper}` : /[0-9]/.test(rawKey) ? `Digit${rawKey}` : rawKey,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      modifiers,
      text: modifiers === 0 ? rawKey : undefined,
    }
  }
  return {
    key: rawKey,
    code: rawKey,
    windowsVirtualKeyCode: rawKey.toUpperCase().charCodeAt(0),
    modifiers,
    text: undefined,
  }
}

async function pressBrowserKey(session: CDPSession, input: string) {
  const key = keyDescriptor(input)
  await sendCommand(session, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    nativeVirtualKeyCode: key.windowsVirtualKeyCode,
    modifiers: key.modifiers,
    text: key.text,
    unmodifiedText: key.text,
  })
  await sendCommand(session, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    nativeVirtualKeyCode: key.windowsVirtualKeyCode,
    modifiers: key.modifiers,
  })
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

async function targetFromParams(
  session: CDPSession,
  params: Pick<Schema.Schema.Type<typeof Parameters>, "ref" | "selector" | "x" | "y">,
) {
  if (params.selector) return objectIDForSelector(session, params.selector).then((id) => elementTarget(session, id))
  if (params.ref) return objectIDForRef(session, params.ref).then((id) => elementTarget(session, id))
  if (params.x !== undefined || params.y !== undefined) return viewportXY(params.x, params.y, "coordinate")
  throw new Error("action requires 'ref', 'selector', or x/y coordinates")
}

async function navigateHistory(session: CDPSession, direction: "back" | "forward") {
  const history = await sendCommand(session, "Page.getNavigationHistory")
  const entries = history.entries as Array<{ id: number }> | undefined
  const currentIndex = Number(history.currentIndex)
  const nextIndex = direction === "back" ? currentIndex - 1 : currentIndex + 1
  const entry = entries?.[nextIndex]
  if (!entry) throw new Error(`Cannot navigate ${direction}; no history entry is available.`)
  await sendCommand(session, "Page.navigateToHistoryEntry", { entryId: entry.id })
}

// --- Main tool ---

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
            const target = yield* Effect.promise(() => targetFromParams(session, params))

            yield* Effect.promise(() => clickViewport(session, target.x, target.y, params.button))
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 800, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Clicked ${params.ref ?? (params.selector ? `selector "${params.selector}"` : `(${target.x}, ${target.y})`)}. Screenshot after click captured.`,
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

          if (action === "hover") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const target = yield* Effect.promise(() => targetFromParams(session, params))

            yield* Effect.promise(() => hoverViewport(session, target.x, target.y))
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 400, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Hovered ${params.ref ?? (params.selector ? `selector "${params.selector}"` : `(${target.x}, ${target.y})`)}. Screenshot after hover captured.`,
              title: `Hover: ${params.ref ?? params.selector}`,
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, target },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-hover-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "drag") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const target = yield* Effect.promise(() => targetFromParams(session, params))
            const destination = viewportCoordinate(params.to, "to")

            yield* Effect.promise(() => dragViewport(session, target, destination, params.button))
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 800, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Dragged from ${params.ref ?? (params.selector ? `selector "${params.selector}"` : `(${target.x}, ${target.y})`)} to (${destination.x}, ${destination.y}). Screenshot after drag captured.`,
              title: "Drag",
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, target, destination },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-drag-${Date.now()}.png`,
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
              const point = viewportXY(params.x, params.y, "coordinate")
              target = point
              yield* Effect.promise(() => clickViewport(session, point.x, point.y, params.button))
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

          if (action === "key" || action === "press") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const key = params.key ?? params.text
            if (!key) throw new Error("key or text is required for key/press action")
            yield* Effect.promise(() => pressBrowserKey(session, key))
            yield* Effect.sleep(`${Math.min(params.waitMs ?? 300, 10_000)} millis`)
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `Pressed ${key}. Screenshot after keypress captured.`,
              title: `Key: ${key}`,
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl, key },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-key-${Date.now()}.png`,
                },
              ],
            }
          }

          if (action === "scroll") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            const { x, y } = viewportXY(params.x ?? 640, params.y ?? 400, "coordinate")
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

          if (action === "back" || action === "forward" || action === "reload") {
            const session = yield* Effect.promise(() => getOrCreateSession())
            if (action === "reload") yield* Effect.promise(() => sendCommand(session, "Page.reload", { ignoreCache: true }))
            else yield* Effect.promise(() => navigateHistory(session, action))
            yield* Effect.promise(() => waitForPageReady(session, params.waitMs ?? 5_000))
            const screenshot = yield* Effect.promise(() => captureBrowserScreenshot(session, params))
            return {
              output: `${action} completed. Screenshot captured.`,
              title: action,
              metadata: { screenshotMime: "image/png", screenshotDataUrl: screenshot.dataUrl },
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: screenshot.dataUrl,
                  filename: `browser-${action}-${Date.now()}.png`,
                },
              ],
            }
          }

          throw new Error(`Unknown browser action: ${action}`)
        }).pipe(Effect.orDie),
    }
  }) as any,
)
