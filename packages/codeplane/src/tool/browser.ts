import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { Agent } from "@/agent/agent"
import { Flag } from "@/flag/flag"
import { Provider } from "@/provider"

const Action = Schema.Union(
  Schema.Literal("navigate"),
  Schema.Literal("screenshot"),
  Schema.Literal("snapshot"),
  Schema.Literal("click"),
  Schema.Literal("type"),
  Schema.Literal("evaluate"),
  Schema.Literal("console"),
  Schema.Literal("html"),
  Schema.Literal("close"),
)

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "The browser action: navigate (go to URL), screenshot (capture viewport), snapshot (get interactive elements with refs), click (click element by ref/selector/coords), type (enter text into element), evaluate (run JS in page), console (get console logs), html (get page source), close (close browser)",
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

async function httpGet(url: string): Promise<any> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`CDP HTTP ${resp.status}`)
  return resp.json()
}

async function ensureChrome(): Promise<void> {
  try {
    await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json/version`)
    return
  } catch {}

  const bin = findChrome()
  if (!bin) throw new Error("No Chrome/Chromium found.")

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
    "--window-size=1280,800",
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  })

  for (let i = 0; i < 30; i++) {
    try {
      await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json/version`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  throw new Error("Chrome did not start")
}

function killChrome() {
  if (chromeProcess) {
    chromeProcess.kill("SIGTERM")
    chromeProcess = null
  }
}

// --- CDP session management ---

type CDPSession = {
  ws: WebSocket
  msgId: number
  pending: Map<number, (result: any) => void>
  closed: boolean
}

const sessionState: { current: CDPSession | null; target: string | null } = {
  current: null,
  target: null,
}

function createCDPSession(wsUrl: string): Promise<CDPSession> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const session: CDPSession = { ws, msgId: 0, pending: new Map(), closed: false }

    ws.onopen = () => resolve(session)
    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string)
      if (msg.id && session.pending.has(msg.id)) {
        const resolve = session.pending.get(msg.id)!
        session.pending.delete(msg.id)
        resolve(msg.result ?? msg)
      }
    }
    ws.onerror = () => {
      if (!session.closed) reject(new Error("CDP WebSocket error"))
    }
    ws.onclose = () => {
      session.closed = true
      sessionState.current = null
    }
  })
}

async function getOrCreateSession(): Promise<CDPSession> {
  if (sessionState.current && !sessionState.current.closed) return sessionState.current

  const pages = (await httpGet(`http://${CDP_HOST}:${CDP_PORT}/json`)) as Array<{
    id: string
    type: string
    webSocketDebuggerUrl: string
  }>

  let target = pages.find((p: { type: string }) => p.type === "page")
  if (!target) {
    const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/new?url=about:blank`, { method: "PUT" })
    target = (await resp.json()) as { id: string; type: string; webSocketDebuggerUrl: string }
  }
  sessionState.target = target.id

  const session = await createCDPSession(target.webSocketDebuggerUrl)
  sessionState.current = session

  await sendCDP(session, "Runtime.enable")
  await sendCDP(session, "Log.enable")
  await sendCDP(session, "Page.enable")
  await sendCDP(session, "Network.enable")
  await sendCDP(session, "DOM.enable")

  return session
}

function sendCDP(session: CDPSession, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    if (session.closed) return reject(new Error("CDP session closed"))
    const id = ++session.msgId
    session.pending.set(id, resolve)
    session.ws.send(JSON.stringify({ id, method, params }))
  })
}

async function screenshotPNG(session: CDPSession, params: {
  width: number
  height: number
  fullPage: boolean
}): Promise<string> {
  const { data } = await sendCDP(session, "Page.captureScreenshot", {
    format: "png",
    clip: params.fullPage ? undefined : { x: 0, y: 0, width: params.width, height: params.height, scale: 1 },
    captureBeyondViewport: !!params.fullPage,
  })
  return `data:image/png;base64,${data}`
}

interface SnapshotNode {
  role: string
  name: string
  ref?: string
  tag?: string
  placeholder?: string
  value?: string
  disabled?: boolean
  checked?: boolean
  children: SnapshotNode[]
}

async function generateSnapshot(session: CDPSession): Promise<{ nodes: SnapshotNode[]; refs: string[] }> {
  const axNodes = (await sendCDP(session, "Accessibility.getFullAXTree", { depth: -1 })).nodes as any[]
  let refCounter = 0
  const refMap: string[] = []

  function resolveAX(axId: string): any {
    return axNodes.find((n: any) => n.nodeId === axId)
  }

  function buildFromAX(axNode: any): SnapshotNode | null {
    if (!axNode) return null
    const role = (axNode.role?.value ?? "unknown").toLowerCase()
    const name = axNode.name?.value ?? ""
    const properties: any[] = axNode.properties ?? []

    const interactiveRoles = new Set([
      "link", "button", "textbox", "searchbox", "combobox", "listbox",
      "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio",
      "checkbox", "switch", "tab", "slider", "spinbutton", "textfield", "textarea",
    ])
    const isInteractive = interactiveRoles.has(role) || (role === "generic" && !!name) || (role === "image" && !!name)

    const result: SnapshotNode = {
      role,
      name: name || (isInteractive ? `[${role}]` : ""),
      children: [],
      disabled: properties.some((p: any) => p.name === "disabled" && p.value?.value === true),
      checked: properties.some((p: any) => p.name === "checked" && p.value?.value === true),
    }

    if (isInteractive) {
      refCounter++
      const ref = `@e${refCounter}`
      result.ref = ref
      refMap.push(ref)
    }

    const childIds: string[] = axNode.childIds ?? []
    for (const childId of childIds) {
      const childAx = resolveAX(childId)
      if (!childAx) continue
      const childRole = (childAx.role?.value ?? "").toLowerCase()
      if (childAx.ignored && childRole === "statictext") {
        if (!result.name) result.name = childAx.name?.value ?? ""
        continue
      }
      if (childAx.ignored && childRole !== "generic") {
        const nested = buildFromAX(childAx)
        if (nested) result.children.push(...nested.children)
        continue
      }
      const childNode = buildFromAX(childAx)
      if (childNode) result.children.push(childNode)
    }
    return result
  }

  const rootAX = axNodes.find((n: any) => n.role?.value === "RootWebArea")
  const tree: SnapshotNode[] = rootAX ? [buildFromAX(rootAX)!] : []
  return { nodes: tree, refs: refMap }
}

function formatSnapshotNode(node: SnapshotNode, indent = 0): string {
  const prefix = "  ".repeat(indent)
  const refStr = node.ref ? ` ${node.ref}` : ""
  const parts: string[] = []
  if (node.tag) parts.push(`<${node.tag}>`)
  parts.push(node.name || node.role)
  if (node.disabled) parts.push("[disabled]")
  if (node.checked) parts.push("[checked]")
  if (node.placeholder) parts.push(`placeholder="${node.placeholder}"`)
  if (node.value) parts.push(`value="${node.value}"`)

  let line = `${prefix}${node.role}${refStr}: ${parts.join(" ")}`
  if (node.role === "heading") line = `\n${line}`

  const children = node.children.map((c) => formatSnapshotNode(c, indent + 1)).join("\n")
  if (children) line += "\n" + children
  return line
}

// --- Main browser API ---

async function browserNavigate(params: {
  url: string
  width: number
  height: number
  fullPage: boolean
}): Promise<{ output: string; title: string; metadata: Record<string, unknown>; attachment?: Tool.Attachment }> {
  await ensureChrome()
  const session = await getOrCreateSession()
  await sendCDP(session, "Page.navigate", { url: params.url })
  await new Promise((r) => setTimeout(r, 1500))

  const png = await screenshotPNG(session, params)
  return {
    output: `# ${params.url}\n\nNavigated successfully. Screenshot captured.`,
    title: params.url,
    metadata: { url: params.url, screenshotMime: "image/png", screenshotDataUrl: png },
    attachment: { type: "file", mime: "image/png", url: png, filename: `browser-navigate-${Date.now()}.png` },
  }
}

async function browserScreenshot(params: {
  width: number
  height: number
  fullPage: boolean
}): Promise<{ output: string; title: string; metadata: Record<string, unknown>; attachment?: Tool.Attachment }> {
  const session = await getOrCreateSession()
  const png = await screenshotPNG(session, params)
  return {
    output: `Screenshot captured (${params.width}x${params.height}).`,
    title: "Screenshot",
    metadata: { screenshotMime: "image/png", screenshotDataUrl: png, width: params.width, height: params.height },
    attachment: { type: "file", mime: "image/png", url: png, filename: `browser-screenshot-${Date.now()}.png` },
  }
}

async function browserSnapshot(params: {
  width: number
  height: number
}): Promise<{ output: string; title: string; metadata: Record<string, unknown>; attachment?: Tool.Attachment }> {
  const session = await getOrCreateSession()
  const { nodes, refs } = await generateSnapshot(session)
  const png = await screenshotPNG(session, { ...params, fullPage: false })

  const treeStr = nodes.map((n) => formatSnapshotNode(n)).join("\n")
  const output = [
    "## Page Snapshot",
    `${refs.length} interactive elements found. Use refs (@e1, @e2, ...) for click/type.`,
    "```",
    treeStr.slice(0, 8000),
    treeStr.length > 8000 ? "\n... (truncated)" : "",
    "```",
  ].join("\n")

  return {
    output,
    title: `Snapshot (${refs.length} elements)`,
    metadata: { elementCount: refs.length, screenshotMime: "image/png", screenshotDataUrl: png, refs: refs.slice(0, 100) },
    attachment: { type: "file", mime: "image/png", url: png, filename: `browser-snapshot-${Date.now()}.png` },
  }
}

async function browserClick(params: {
  ref?: string
  selector?: string
  width: number
  height: number
}): Promise<{ output: string; title: string; metadata: Record<string, unknown>; attachment?: Tool.Attachment }> {
  const session = await getOrCreateSession()

  if (params.selector) {
    await sendCDP(session, "Runtime.evaluate", {
      expression: `(()=>{const e=document.querySelector('${params.selector!.replace(/'/g, "\\'")}');if(!e)return{error:'not found'};e.scrollIntoView({behavior:'instant',block:'center'});e.click();return{ok:true}})()`,
    })
  } else if (params.ref) {
    const m = params.ref.match(/^@e(\d+)$/)
    if (!m) throw new Error(`Invalid ref: ${params.ref}`)
    const idx = parseInt(m[1]) - 1
    await sendCDP(session, "Runtime.evaluate", {
      expression: `(()=>{const all=document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=menuitem],[role=tab],[role=combobox],[role=listbox],[role=option]');const e=all[${idx}];if(!e)return{error:'ref @e${idx + 1} not found (' + all.length + ' elements)'};e.scrollIntoView({behavior:'instant',block:'center'});e.click();return{ok:true,tag:e.tagName}})()`,
    })
  } else {
    throw new Error("click requires ref or selector")
  }

  await new Promise((r) => setTimeout(r, 800))
  const png = await screenshotPNG(session, { ...params, fullPage: false })

  return {
    output: `Clicked ${params.ref ?? params.selector}.`,
    title: `Click: ${params.ref ?? params.selector}`,
    metadata: { screenshotMime: "image/png", screenshotDataUrl: png },
    attachment: { type: "file", mime: "image/png", url: png, filename: `browser-click-${Date.now()}.png` },
  }
}

async function browserType(params: {
  ref?: string
  selector?: string
  text: string
  width: number
  height: number
}): Promise<{ output: string; title: string; metadata: Record<string, unknown>; attachment?: Tool.Attachment }> {
  const session = await getOrCreateSession()

  if (params.ref) {
    const m = params.ref.match(/^@e(\d+)$/)
    if (!m) throw new Error(`Invalid ref: ${params.ref}`)
    const idx = parseInt(m[1]) - 1
    await sendCDP(session, "Runtime.evaluate", {
      expression: `(()=>{const all=document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=menuitem],[role=tab],[role=combobox],[role=listbox],[role=option]');const e=all[${idx}];if(!e)return{error:'not found'};e.focus();e.value='';e.value=${JSON.stringify(params.text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true}})()`,
    })
  } else if (params.selector) {
    await sendCDP(session, "Runtime.evaluate", {
      expression: `(()=>{const e=document.querySelector('${params.selector!.replace(/'/g, "\\'")}');if(!e)return{error:'not found'};e.focus();e.value='';e.value=${JSON.stringify(params.text)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true}})()`,
    })
  } else {
    throw new Error("type requires ref or selector")
  }

  await new Promise((r) => setTimeout(r, 500))
  const png = await screenshotPNG(session, { ...params, fullPage: false })

  return {
    output: `Typed "${params.text}" into ${params.ref ?? params.selector}.`,
    title: `Type: "${params.text.slice(0, 30)}"`,
    metadata: { screenshotMime: "image/png", screenshotDataUrl: png },
    attachment: { type: "file", mime: "image/png", url: png, filename: `browser-type-${Date.now()}.png` },
  }
}

async function browserEvaluate(params: {
  script: string
}): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  const session = await getOrCreateSession()
  const result = await sendCDP(session, "Runtime.evaluate", {
    expression: params.script,
    returnByValue: true,
    awaitPromise: true,
  })
  const value = result.result?.value ?? result.result?.description ?? JSON.stringify(result)
  return {
    output: `# Result\n\n\`\`\`json\n${JSON.stringify(value, null, 2).slice(0, 10000)}\n\`\`\``,
    title: "JS Evaluate",
    metadata: { result: typeof value === "string" ? value : JSON.stringify(value) },
  }
}

async function browserConsole(): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  return {
    output: "Use snapshot to capture console output during page interaction.",
    title: "Console logs",
    metadata: {},
  }
}

async function browserHTML(): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  const session = await getOrCreateSession()
  const result = await sendCDP(session, "Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  })
  const html = String(result.result?.value ?? "")
  return {
    output: `# Page HTML\n\n\`\`\`html\n${html.slice(0, 20000)}${html.length > 20000 ? "\n... (truncated)" : ""}\n\`\`\``,
    title: "Page HTML",
    metadata: { htmlLength: html.length },
  }
}

// --- Tool definition ---

type Attachment = { type: "file"; mime: string; url: string; filename?: string }

// --- Tool definition ---

type BrowserResult = {
  output: string
  title: string
  metadata: Record<string, unknown>
  attachment?: Attachment
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
          const client = Flag.CODEPLANE_CLIENT
          const isDesktop = client === "app" || process.env.CODEPLANE_DESKTOP_MANAGED === "1"
          if (!isDesktop) {
            return {
              output: "Browser control is only available in the desktop app.",
              title: "browser",
              metadata: {},
            }
          }

          const agents = yield* Agent.Service
          const agentInfo = yield* agents.get(ctx.agent)
          const providerSvc = yield* Provider.Service
          if (!agentInfo.model?.providerID || !agentInfo.model?.modelID) {
            return { output: "Browser requires a vision-capable model.", title: "browser", metadata: {} }
          }
          const model = yield* providerSvc.getModel(agentInfo.model.providerID, agentInfo.model.modelID)
          if (!model?.capabilities?.input?.image) {
            return { output: "Browser requires a vision-capable model.", title: "browser", metadata: {} }
          }

          yield* ctx.ask({
            permission: "browser",
            patterns: params.url ? [params.url] : ["*"],
            always: ["*"],
            metadata: { action: params.action, url: params.url },
          })

          const width = Math.min(2560, Math.max(320, params.width ?? 1280))
          const height = Math.min(2160, Math.max(240, params.height ?? 800))
          const fullPage = params.fullPage ?? false
          const action = params.action

          let result: BrowserResult

          if (action === "close") {
            killChrome()
            return { output: "Browser closed.", title: "browser", metadata: {} }
          }

          if (action === "navigate") {
            if (!params.url) throw new Error("url is required for navigate")
            result = yield* Effect.promise(() => browserNavigate({ url: params.url!, width, height, fullPage }))
          } else if (action === "screenshot") {
            result = yield* Effect.promise(() => browserScreenshot({ width, height, fullPage }))
          } else if (action === "snapshot") {
            result = yield* Effect.promise(() => browserSnapshot({ width, height }))
          } else if (action === "click") {
            result = yield* Effect.promise(() => browserClick({ ref: params.ref, selector: params.selector, width, height }))
          } else if (action === "type") {
            if (!params.text) throw new Error("text is required for type")
            result = yield* Effect.promise(() => browserType({ ref: params.ref, selector: params.selector, text: params.text!, width, height }))
          } else if (action === "evaluate") {
            if (!params.script) throw new Error("script is required for evaluate")
            result = yield* Effect.promise(() => browserEvaluate({ script: params.script! }))
          } else if (action === "console") {
            result = yield* Effect.promise(() => browserConsole())
          } else if (action === "html") {
            result = yield* Effect.promise(() => browserHTML())
          } else {
            throw new Error(`Unknown action: ${action}`)
          }

          return {
            output: result.output,
            title: result.title,
            metadata: result.metadata,
            ...(result.attachment ? { attachments: [result.attachment] } : {}),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
