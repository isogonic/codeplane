import type { Session } from "electron"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import type { Duplex } from "node:stream"
import tls from "node:tls"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { LEGACY_THEME_ASSETS } from "../../../ui/src/theme/default-themes"

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STATIC_REF_PATTERN =
  /(?:"|')((?:\/|\.\/|\.\.\/)[^"'?#]+\.(?:avif|css|gif|ico|jpeg|jpg|js|json|mjs|png|svg|ttf|txt|webm|webp|woff|woff2))(?:"|')/g
const HTML_ATTR_PATTERN = /\b(?:src|href)=["']([^"']+)["']/g
const CSS_URL_PATTERN = /url\(([^)]+)\)/g
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".mjs", ".svg", ".txt"])
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])
const UPSTREAM_REQUEST_HEADERS_BLOCKED = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-length",
  "cookie",
  "host",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
])
const INSTANCE_HEADER_BLOCKED = new Set(["host", "origin", "referer", "user-agent", "content-length"])
const RESPONSE_HEADERS_BLOCKED = new Set(["content-encoding", "content-length", "content-security-policy", "set-cookie"])
const MIME_TYPES = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
} satisfies Record<string, string>

export type DesktopHostInstance = {
  id: string
  url: string
  label?: string
  local?: { binaryVersion: string }
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
  clientCertSubject?: string
}

type CacheMetadata = {
  entryHash?: string
  fetchedAt: number
  instances?: Record<string, { lastUsedAt: number; origin: string }>
  lastUsedAt: number
  origin: string
  version: string
}

type OriginIndexEntry = {
  checkedAt: number
  version: string
}

type OriginIndex = Record<string, OriginIndexEntry>

type ProxyInstance = {
  id: string
  key: string
  label?: string
  local?: boolean
  proxyUrl: string
  remoteUrl: string
}

export type DesktopUIPrepareProgress = {
  phase: "probe" | "download" | "finalize" | "done"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

export type DesktopUICacheInfo = {
  exists: boolean
  bytes: number
  origins: string[]
  versions: string[]
}

export class DesktopVersionAuthRequiredError extends Error {
  authUrl: string
  instanceUrl: string

  constructor(input: { authUrl: string; instanceUrl: string }) {
    super(`Interactive sign-in is required for ${input.instanceUrl}`)
    this.name = "DesktopVersionAuthRequiredError"
    this.authUrl = input.authUrl
    this.instanceUrl = input.instanceUrl
  }
}

type CrawlTarget = {
  url: string
  optional?: boolean
}

const instanceOrigin = (input: string) => {
  const target = asUrl(input)
  if (!target) throw new Error(`Invalid instance URL: ${input}`)
  return target.origin
}

const exists = (input: string) => fs.access(input).then(() => true).catch(() => false)

const quote = (value: string) => value.replace(/^['"]|['"]$/g, "").trim()

const decodePath = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function asUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  try {
    return new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return
  }
}

function baseUrl(input: string) {
  const target = asUrl(input)
  if (!target) throw new Error(`Invalid instance URL: ${input}`)
  const base = target.toString()
  return new URL(base.endsWith("/") ? base : `${base}/`)
}

function cleanPathname(input: string) {
  return decodePath(input).replace(/^\/+/, "")
}

function isTextAsset(file: string, contentType: string | null) {
  if (contentType?.startsWith("text/")) return true
  if (contentType?.includes("json")) return true
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
}

function isIgnorableRef(input: string) {
  return (
    !input ||
    input.startsWith("#") ||
    input.startsWith("about:") ||
    input.startsWith("blob:") ||
    input.startsWith("data:") ||
    input.startsWith("javascript:") ||
    input.startsWith("mailto:")
  )
}

function optionalRef(sourceFile: string, ref: string) {
  if (![".js", ".mjs"].includes(path.extname(sourceFile).toLowerCase())) return false
  return /^(?:\.{1,2}\/themes|\/assets\/themes)\/[^/?#]+\.json(?:[?#].*)?$/i.test(ref)
}

function collectRefs(source: string, base: URL, sourceFile: string) {
  const found = new Map<string, boolean>()
  const add = (value: string) => {
    const ref = quote(value)
    if (isIgnorableRef(ref)) return
    if (
      !/(?:^|\/)assets\//.test(ref) &&
      !/\.(?:avif|css|gif|ico|jpeg|jpg|js|json|mjs|png|svg|ttf|txt|webm|webp|woff|woff2)(?:[?#].*)?$/i.test(ref)
    ) {
      return
    }
    const resolved = new URL(ref, base)
    if (!/^https?:$/.test(resolved.protocol)) return
    if (resolved.origin !== base.origin) return
    resolved.hash = ""
    const target = resolved.toString()
    if (found.get(target) === false) return
    found.set(target, optionalRef(sourceFile, ref))
  }

  for (const pattern of [HTML_ATTR_PATTERN, CSS_URL_PATTERN, STATIC_REF_PATTERN]) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      const ref = match[1]
      if (!ref) continue
      add(ref)
    }
  }

  return [...found].map(
    ([url, optional]): CrawlTarget => ({
      url,
      optional,
    }),
  )
}

function proxyKey(id: string) {
  return `desktop-instance:${id}`
}

function mime(input: string) {
  return MIME_TYPES[path.extname(input).toLowerCase() as keyof typeof MIME_TYPES] ?? "application/octet-stream"
}

async function readRequestBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

function copyUpstreamRequestHeaders(request: http.IncomingMessage) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (UPSTREAM_REQUEST_HEADERS_BLOCKED.has(name.toLowerCase())) continue
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
      continue
    }
    headers.set(name, value)
  }
  return headers
}

function headersRecord(headers: Headers) {
  const out: Record<string, string> = {}
  for (const [name, value] of headers.entries()) out[name] = value
  return out
}

function responseHeaders(headers: Headers | http.IncomingHttpHeaders) {
  const out: Record<string, string | string[]> = {}
  if (headers instanceof Headers) {
    for (const [name, value] of headers.entries()) {
      if (RESPONSE_HEADERS_BLOCKED.has(name.toLowerCase())) continue
      out[name] = value
    }
    return out
  }
  for (const [name, value] of Object.entries(headers)) {
    if (RESPONSE_HEADERS_BLOCKED.has(name.toLowerCase())) continue
    if (value === undefined) continue
    out[name] = typeof value === "number" ? String(value) : value
  }
  return out
}

function isLiveEventStreamRequest(request: http.IncomingMessage, pathname: string, instance: DesktopHostInstance) {
  if (request.method !== "GET" && request.method !== "HEAD") return false
  if (instance.clientCertSubject) return false
  return pathname === "/global/event" || pathname === "/event"
}

async function cookieHeader(session: Session, remote: URL) {
  if (!("cookies" in session)) return
  try {
    const cookies = await session.cookies.get({ url: remote.toString() })
    const value = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
    return value || undefined
  } catch {
    return
  }
}

function upgradeRemotePath(remote: URL) {
  return `${remote.pathname || "/"}${remote.search}`
}

function upgradeHeaders(
  request: http.IncomingMessage,
  remote: URL,
  instance: DesktopHostInstance,
) {
  const headers = new Map<string, string[]>()
  const set = (name: string, value: string) => headers.set(name.toLowerCase(), [value])
  const append = (name: string, value: string) => {
    const key = name.toLowerCase()
    headers.set(key, [...(headers.get(key) ?? []), value])
  }
  for (const [name, value] of Object.entries(request.headers)) {
    const key = name.toLowerCase()
    if (key === "host" || key === "connection" || key === "upgrade") continue
    if (UPSTREAM_REQUEST_HEADERS_BLOCKED.has(key) && !key.startsWith("sec-websocket-")) continue
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) append(name, item)
      continue
    }
    set(name, value)
  }
  for (const [name, value] of Object.entries(instance.headers ?? {})) {
    if (!value) continue
    set(name, value)
  }
  set("host", remote.host)
  set("connection", "Upgrade")
  set("upgrade", "websocket")
  return [...headers.entries()].flatMap(([name, values]) => values.map((value) => `${name}: ${value}`))
}

function openUpgradeSocket(remote: URL, instance: DesktopHostInstance, onConnect: () => void) {
  const secure = remote.protocol === "https:"
  const port = Number(remote.port || (secure ? 443 : 80))
  if (secure) {
    return tls.connect(
      {
        host: remote.hostname,
        port,
        servername: remote.hostname,
        rejectUnauthorized: !instance.ignoreCertificateErrors,
      },
      onConnect,
    )
  }
  if (remote.protocol === "http:") {
    return net.connect({ host: remote.hostname, port }, onConnect)
  }
  throw new Error(`Unsupported WebSocket proxy target protocol: ${remote.protocol}`)
}

function responseOpen(response: http.ServerResponse<http.IncomingMessage>) {
  return !response.destroyed && !response.writableEnded
}

function isClientClosedError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown }
  const code = typeof candidate.code === "string" ? candidate.code : ""
  if (
    code === "ERR_STREAM_PREMATURE_CLOSE" ||
    code === "ERR_STREAM_UNABLE_TO_PIPE" ||
    code === "ERR_STREAM_WRITE_AFTER_END" ||
    code === "ERR_HTTP_HEADERS_SENT"
  ) {
    return true
  }
  const message = typeof candidate.message === "string" ? candidate.message : ""
  return (
    message.includes("Premature close") ||
    message.includes("closed or destroyed stream") ||
    message.includes("Cannot write headers after they are sent")
  )
}

async function readMetadata(root: string) {
  const file = path.join(root, "meta.json")
  if (!(await exists(file))) return
  return (JSON.parse(await fs.readFile(file, "utf8")) as CacheMetadata) || undefined
}

async function writeMetadata(root: string, value: CacheMetadata) {
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, "meta.json"), `${JSON.stringify(value, null, 2)}\n`)
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function localEntryHash(root: string) {
  return hashBytes(await fs.readFile(path.join(root, "index.html")))
}

async function directoryBytes(target: string): Promise<number> {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => undefined)
  if (!entries) return 0
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const child = path.join(target, entry.name)
      if (entry.isDirectory()) return directoryBytes(child)
      const stat = await fs.lstat(child).catch(() => undefined)
      return stat?.size ?? 0
    }),
  )
  return sizes.reduce((sum, value) => sum + value, 0)
}

function cacheRoot(base: string) {
  return path.join(base, "ui-cache")
}

function versionRoot(base: string, version: string) {
  return path.join(cacheRoot(base), version)
}

function originIndexFile(base: string) {
  return path.join(cacheRoot(base), "origins.json")
}

async function readOriginIndex(base: string): Promise<OriginIndex> {
  const file = originIndexFile(base)
  if (!(await exists(file))) return {}
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"))
    return parsed && typeof parsed === "object" ? (parsed as OriginIndex) : {}
  } catch {
    return {}
  }
}

async function writeOriginIndex(base: string, value: OriginIndex) {
  await fs.mkdir(cacheRoot(base), { recursive: true })
  await fs.writeFile(originIndexFile(base), `${JSON.stringify(value, null, 2)}\n`)
}

async function markOriginChecked(base: string, origin: string, version: string) {
  const index = await readOriginIndex(base)
  index[origin] = { checkedAt: Date.now(), version }
  await writeOriginIndex(base, index)
}

function staticFile(root: string, pathname: string) {
  const relative = cleanPathname(pathname)
  const resolved = path.resolve(root, relative || "index.html")
  return resolved.startsWith(root) ? resolved : path.join(root, "index.html")
}

async function ensureLegacyThemeAssets(root: string) {
  const target = path.join(root, "assets", "themes")
  await fs.mkdir(target, { recursive: true })
  await Promise.all(
    Object.entries(LEGACY_THEME_ASSETS).map(([id, theme]) =>
      fs.writeFile(path.join(target, `${id}.json`), `${JSON.stringify(theme, null, 2)}\n`),
    ),
  )
}

async function touchVersion(base: string, version: string, origin: string, instanceID: string) {
  const root = versionRoot(base, version)
  const current = await readMetadata(root)
  await writeMetadata(root, {
    entryHash: current?.entryHash,
    fetchedAt: current?.fetchedAt ?? Date.now(),
    instances: {
      ...current?.instances,
      [instanceID]: {
        lastUsedAt: Date.now(),
        origin,
      },
    },
    lastUsedAt: Date.now(),
    origin,
    version,
  })
}

async function cleanupUnused(base: string) {
  const root = cacheRoot(base)
  if (!(await exists(root))) return
  const cutoff = Date.now() - CACHE_TTL_MS
  const entries = await fs.readdir(root, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const target = path.join(root, entry.name)
        const meta = await readMetadata(target)
        if ((meta?.lastUsedAt ?? 0) >= cutoff) return
        await fs.rm(target, { force: true, recursive: true })
      }),
  )
}

async function fetchThroughSession(session: Session, input: string | URL, init?: RequestInit) {
  const nativeFetch =
    "fetch" in session && typeof session.fetch === "function"
      ? session.fetch.bind(session)
      : fetch
  return nativeFetch(typeof input === "string" ? input : input.toString(), { redirect: "follow", ...init })
}

// Some auth proxies (Cloudflare Access, identity-aware proxies, custom SSO) gate
// `/global/version` behind a sign-in flow. They surface in three shapes that all
// need to be treated as "interactive sign-in required":
//   1. 200 with HTML body (login page rendered inline at the same URL),
//   2. 30x redirect chain ending at the IdP (we land at a non-instance origin),
//   3. 401/403 directly (some setups skip the redirect for non-browser callers).
// In every case we want to send the desktop window to a URL the user can
// actually sign in on. `response.url` is the post-redirect URL, falling back
// to the instance home so the user always lands somewhere usable.
async function fetchVersion(session: Session, instance: DesktopHostInstance) {
  const url = new URL("global/version", baseUrl(instance.url))
  const response = await fetchThroughSession(session, url)
  const finalUrl = response.url || url.toString()
  const finalOrigin = (() => {
    try {
      return new URL(finalUrl).origin
    } catch {
      return undefined
    }
  })()
  const instanceOriginValue = (() => {
    try {
      return baseUrl(instance.url).origin
    } catch {
      return undefined
    }
  })()
  const contentType = response.headers.get("content-type") ?? ""
  const looksLikeJson = contentType.includes("json")
  const redirectedAway = !!finalOrigin && !!instanceOriginValue && finalOrigin !== instanceOriginValue
  const authStatus = response.status === 401 || response.status === 403
  const authShape = authStatus || redirectedAway || (response.ok && !looksLikeJson)
  if (authShape) {
    // Drain the body so the underlying socket doesn't sit half-open while the
    // user signs in elsewhere.
    await response.body?.cancel().catch(() => undefined)
    // For 401/403 with no redirect we don't have a sign-in page from the
    // proxy; fall back to the instance home, which is the most universal
    // entry point that any auth front-end will redirect to its own login.
    const fallbackHome = new URL("/", baseUrl(instance.url)).toString()
    const authUrl = authStatus && !redirectedAway ? fallbackHome : finalUrl
    throw new DesktopVersionAuthRequiredError({
      authUrl,
      instanceUrl: instance.url,
    })
  }
  if (!response.ok) throw new Error(`Version probe failed with HTTP ${response.status}`)
  if (!looksLikeJson) {
    throw new DesktopVersionAuthRequiredError({
      authUrl: finalUrl,
      instanceUrl: instance.url,
    })
  }
  const payload = (await response.json()) as { current?: string }
  if (!payload.current) throw new Error(`Version probe returned no current version for ${instance.url}`)
  return payload.current
}

async function crawlUI(
  session: Session,
  instance: DesktopHostInstance,
  targetRoot: string,
  log?: (event: string, data?: unknown) => void,
  progress?: (progress: DesktopUIPrepareProgress) => void,
) {
  const start = baseUrl(instance.url)
  const pending = new Map<string, boolean>([[start.toString(), false]])
  const seen = new Set<string>()
  const saved = new Set<string>()
  log?.("crawl.start", { root: targetRoot, start: start.toString(), url: instance.url })
  progress?.({
    phase: "download",
    message: "Downloading UI assets (0/1)…",
    percent: 12,
    completed: 0,
    total: 1,
  })

  while (pending.size > 0) {
    const next = pending.entries().next().value as [string, boolean] | undefined
    if (!next) break
    const [current, optional] = next
    pending.delete(current)
    if (seen.has(current)) continue
    seen.add(current)

    const response = await fetchThroughSession(session, current)
    if (!response.ok) {
      // Vite can leave source-relative theme glob strings in JS bundles even when
      // they do not map to emitted files for an older server build.
      if (optional && response.status === 404) {
        log?.("crawl.optional-miss", { status: response.status, url: current })
        continue
      }
      throw new Error(`UI download failed with HTTP ${response.status} for ${current}`)
    }

    const finalUrl = new URL(response.url || current)
    const file =
      current === start.toString()
        ? "index.html"
        : finalUrl.pathname.endsWith("/")
          ? `${cleanPathname(finalUrl.pathname)}index.html`
          : cleanPathname(finalUrl.pathname)
    const out = path.join(targetRoot, file)
    const bytes = Buffer.from(await response.arrayBuffer())
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, bytes)
    saved.add(file)
    log?.("crawl.asset", { contentType: response.headers.get("content-type"), file, status: response.status, url: current })

    if (!isTextAsset(file, response.headers.get("content-type"))) continue

    const text = bytes.toString("utf8")
    for (const ref of collectRefs(text, finalUrl, file)) {
      if (seen.has(ref.url)) continue
      if (pending.get(ref.url) === false) continue
      pending.set(ref.url, ref.optional ?? false)
    }
    const completed = saved.size
    const total = Math.max(completed + pending.size, completed + 1)
    progress?.({
      phase: "download",
      message: `Downloading UI assets (${completed}/${total})…`,
      percent: Math.min(84, Math.max(12, 12 + Math.round((completed / total) * 72))),
      completed,
      total,
    })
  }

  if (!saved.has("index.html")) throw new Error(`UI download for ${instance.url} did not produce index.html`)
  if (![...saved].some((entry) => entry.startsWith("assets/"))) {
    throw new Error(`UI download for ${instance.url} did not expose bundled assets`)
  }
  log?.("crawl.success", { assets: saved.size, root: targetRoot, url: instance.url })
}

async function remoteEntryHash(session: Session, instance: DesktopHostInstance) {
  const response = await fetchThroughSession(session, baseUrl(instance.url), {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  })
  if (!response.ok) throw new Error(`UI entry validation failed with HTTP ${response.status} for ${instance.url}`)
  const contentType = response.headers.get("content-type") ?? ""
  if (!isTextAsset("index.html", contentType)) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`UI entry validation returned ${contentType || "an unknown content type"} for ${instance.url}`)
  }
  return hashBytes(new Uint8Array(await response.arrayBuffer()))
}

async function cachedEntryStillCurrent(
  base: string,
  session: Session,
  instance: DesktopHostInstance,
  version: string,
  log?: (event: string, data?: unknown) => void,
) {
  const root = versionRoot(base, version)
  const [cached, remote] = await Promise.all([
    readMetadata(root).then((meta) => meta?.entryHash ?? localEntryHash(root)),
    remoteEntryHash(session, instance),
  ])
  const current = cached === remote
  log?.(current ? "cache.entry.current" : "cache.entry.stale", {
    id: instance.id,
    version,
  })
  return current
}

async function ensureCachedVersion(
  base: string,
  session: Session,
  instance: DesktopHostInstance,
  version: string,
  log?: (event: string, data?: unknown) => void,
  progress?: (progress: DesktopUIPrepareProgress) => void,
) {
  const root = versionRoot(base, version)
  if (await exists(path.join(root, "index.html"))) {
    if (await cachedEntryStillCurrent(base, session, instance, version, log)) {
      await ensureLegacyThemeAssets(root)
      log?.("cache.hit", { root, version })
      progress?.({
        phase: "download",
        message: `Using cached UI for Codeplane ${version}.`,
        percent: 86,
        version,
        completed: 1,
        total: 1,
        cacheHit: true,
      })
      await touchVersion(base, version, instanceOrigin(instance.url), instance.id)
      return root
    }
    await fs.rm(root, { force: true, recursive: true })
  }

  const temp = `${root}.tmp-${Date.now()}`
  log?.("cache.miss", { root, temp, version })
  progress?.({
    phase: "download",
    message: `Downloading UI for Codeplane ${version}…`,
    percent: 12,
    version,
    completed: 0,
    total: 1,
  })
  await fs.rm(temp, { force: true, recursive: true })
  await fs.mkdir(temp, { recursive: true })
  await crawlUI(session, instance, temp, log, progress)
  await ensureLegacyThemeAssets(temp)
  log?.("legacy-themes.ready", { root: temp, themeCount: Object.keys(LEGACY_THEME_ASSETS).length })
  progress?.({
    phase: "finalize",
    message: "Finalizing local UI cache…",
    percent: 92,
    version,
  })
  await writeMetadata(temp, {
    entryHash: await localEntryHash(temp),
    fetchedAt: Date.now(),
    instances: {
      [instance.id]: {
        lastUsedAt: Date.now(),
        origin: instanceOrigin(instance.url),
      },
    },
    lastUsedAt: Date.now(),
    origin: instanceOrigin(instance.url),
    version,
  })
  await fs.rm(root, { force: true, recursive: true })
  await fs.rename(temp, root)
  return root
}

export function createDesktopUIHost(input: {
  cacheDir: string
  getInstance(id: string): DesktopHostInstance | undefined
  getSession(instance: DesktopHostInstance): Session
  ensureReady?(instance: DesktopHostInstance): Promise<DesktopHostInstance>
  handleInternalRequest?(
    request: http.IncomingMessage,
    reqUrl: URL,
  ): Promise<{ status?: number; headers?: Record<string, string>; body?: string | Uint8Array } | undefined>
  log?(event: string, data?: unknown): void
}) {
  let activeID = ""
  let origin = ""
  let root = ""
  let server: http.Server | undefined
  const inflight = new Map<string, Promise<string>>()
  const log = (event: string, data?: unknown) => input.log?.(event, data)
  const httpOrigin = (instance: DesktopHostInstance) => {
    const target = asUrl(instance.url)
    if (target?.protocol !== "http:" && target?.protocol !== "https:") return
    return target.origin
  }

  const inferInstance = (request: http.IncomingMessage, reqUrl: URL) => {
    const id =
      reqUrl.searchParams.get("server") ||
      (() => {
        const referrer = request.headers.referer
        if (!referrer || !URL.canParse(referrer)) return
        const parsed = new URL(referrer)
        if (parsed.origin !== origin) return
        return parsed.searchParams.get("server")
      })() ||
      activeID
    if (!id) return
    return input.getInstance(id)
  }

  const proxyLiveEventStream = async (
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>,
    session: Session,
    instance: DesktopHostInstance,
    remote: URL,
    pathname: string,
  ) => {
    const headers = copyUpstreamRequestHeaders(request)
    headers.set("accept", headers.get("accept") || "text/event-stream")
    headers.set("cache-control", "no-cache")
    for (const [name, value] of Object.entries(instance.headers ?? {})) {
      if (!value) continue
      if (INSTANCE_HEADER_BLOCKED.has(name.toLowerCase())) continue
      if (headers.has(name)) continue
      headers.set(name, value)
    }
    const cookies = await cookieHeader(session, remote)
    if (cookies) headers.set("cookie", cookies)

    request.socket?.setNoDelay(true)
    request.socket?.setKeepAlive(true, 30_000)
    response.socket?.setNoDelay(true)
    response.socket?.setKeepAlive(true, 30_000)

    await new Promise<void>((resolve, reject) => {
      const client = remote.protocol === "https:" ? https : remote.protocol === "http:" ? http : undefined
      if (!client) {
        reject(new Error(`Unsupported stream proxy target protocol: ${remote.protocol}`))
        return
      }
      let settled = false
      const settle = (error?: unknown) => {
        if (settled) return
        settled = true
        if (error) {
          reject(error)
          return
        }
        resolve()
      }
      const upstream = client.request(
        remote,
        {
          headers: headersRecord(headers),
          method: request.method,
          ...(remote.protocol === "https:" ? { rejectUnauthorized: !instance.ignoreCertificateErrors } : {}),
        },
        (upstreamResponse) => {
          log("proxy.stream.response", {
            id: instance.id,
            method: request.method,
            pathname,
            remote: remote.toString(),
            status: upstreamResponse.statusCode,
          })
          if (!responseOpen(response)) {
            upstream.destroy()
            settle()
            return
          }
          response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders(upstreamResponse.headers))
          response.flushHeaders()
          if (request.method === "HEAD") {
            upstreamResponse.resume()
            response.end()
            settle()
            return
          }
          upstreamResponse.socket?.setNoDelay(true)
          upstreamResponse.socket?.setKeepAlive(true, 30_000)
          let completed = false
          const cancelUpstream = () => {
            if (completed) return
            upstream.destroy()
            upstreamResponse.destroy()
          }
          response.once("close", cancelUpstream)
          void pipeline(upstreamResponse, response)
            .then(() => settle())
            .catch((error) => {
              if (isClientClosedError(error) || !responseOpen(response)) {
                log("proxy.stream.client-closed", {
                  id: instance.id,
                  method: request.method,
                  pathname,
                  remote: remote.toString(),
                })
                settle()
                return
              }
              settle(error)
            })
            .finally(() => {
              completed = true
              response.removeListener("close", cancelUpstream)
            })
        },
      )
      upstream.once("error", (error) => {
        if (isClientClosedError(error) || !responseOpen(response)) {
          log("proxy.stream.client-closed", {
            id: instance.id,
            method: request.method,
            pathname,
            remote: remote.toString(),
          })
          settle()
          return
        }
        settle(error)
      })
      request.once("close", () => {
        if (!responseOpen(response)) upstream.destroy()
      })
      upstream.end()
    })
  }

  const proxyRequest = async (
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>,
    reqUrl: URL,
    rawInstance: DesktopHostInstance,
    pathname: string,
  ) => {
    const instance = input.ensureReady ? await input.ensureReady(rawInstance) : rawInstance
    const session = input.getSession(instance)
    const remote = new URL(pathname.replace(/^\/+/, ""), baseUrl(instance.url))
    remote.search = reqUrl.search
    if (isLiveEventStreamRequest(request, pathname, instance)) {
      await proxyLiveEventStream(request, response, session, instance, remote, pathname)
      return
    }
    const headers = copyUpstreamRequestHeaders(request)
    const upstream = await fetchThroughSession(session, remote, {
      method: request.method,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await readRequestBody(request),
      headers,
    })
    log("proxy.response", {
      id: instance.id,
      method: request.method,
      pathname,
      remote: remote.toString(),
      status: upstream.status,
    })
    if (!responseOpen(response)) {
      await upstream.body?.cancel().catch(() => undefined)
      log("proxy.client-closed", {
        id: instance.id,
        method: request.method,
        pathname,
        phase: "before-headers",
        remote: remote.toString(),
      })
      return
    }
    response.writeHead(upstream.status, responseHeaders(upstream.headers))
    if (!upstream.body) {
      response.end()
      return
    }
    let completed = false
    const cancelUpstream = () => {
      if (completed) return
      void upstream.body?.cancel().catch(() => undefined)
    }
    response.once("close", cancelUpstream)
    try {
      await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream), response)
    } catch (error) {
      if (isClientClosedError(error) || !responseOpen(response)) {
        await upstream.body.cancel().catch(() => undefined)
        log("proxy.client-closed", {
          id: instance.id,
          method: request.method,
          pathname,
          phase: "body",
          remote: remote.toString(),
        })
        return
      }
      throw error
    } finally {
      completed = true
      response.removeListener("close", cancelUpstream)
    }
  }

  const proxyUpgrade = async (
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const reqUrl = new URL(request.url ?? "/", origin || "http://127.0.0.1")
    const routed = (() => {
      if (reqUrl.pathname.startsWith("/instance/")) {
        const [, , id, ...rest] = reqUrl.pathname.split("/")
        const instance = id ? input.getInstance(decodePath(id)) : undefined
        if (!instance) return
        return { instance, pathname: `/${rest.join("/")}` }
      }
      const instance = inferInstance(request, reqUrl)
      if (!instance) return
      return { instance, pathname: reqUrl.pathname }
    })()
    if (!routed) {
      log("proxy.upgrade.instance.unknown", { pathname: reqUrl.pathname })
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
      return
    }
    const instance = input.ensureReady ? await input.ensureReady(routed.instance) : routed.instance
    const remote = new URL(routed.pathname.replace(/^\/+/, ""), baseUrl(instance.url))
    remote.search = reqUrl.search
    log("proxy.upgrade", {
      id: instance.id,
      method: request.method,
      pathname: routed.pathname,
      remote: remote.toString(),
    })
    await new Promise<void>((resolve, reject) => {
      let connected = false
      const upstream = openUpgradeSocket(remote, instance, () => {
        connected = true
        upstream.write(
          [
            `${request.method ?? "GET"} ${upgradeRemotePath(remote)} HTTP/1.1`,
            ...upgradeHeaders(request, remote, instance),
            "",
            "",
          ].join("\r\n"),
        )
        if (head.length > 0) upstream.write(head)
        upstream.on("data", (chunk) => {
          if (!socket.destroyed) socket.write(chunk)
        })
        socket.on("data", (chunk) => {
          if (!upstream.destroyed) upstream.write(chunk)
        })
        upstream.once("end", () => {
          if (!socket.destroyed) socket.end()
        })
        socket.once("end", () => {
          if (!upstream.destroyed) upstream.end()
        })
        log("proxy.upgrade.connected", {
          id: instance.id,
          pathname: routed.pathname,
          remote: remote.toString(),
        })
        resolve()
      })
      const fail = (error: Error) => {
        log("proxy.upgrade.error", {
          error,
          id: instance.id,
          pathname: routed.pathname,
          remote: remote.toString(),
        })
        socket.destroy()
        upstream.destroy()
        if (!connected) reject(error)
      }
      upstream.once("error", fail)
      socket.once("error", () => upstream.destroy())
      socket.once("close", () => upstream.destroy())
    })
  }

  const ensureServer = async () => {
    if (server && origin) return origin
    server = http.createServer((request, response) => {
      void (async () => {
        const reqUrl = new URL(request.url ?? "/", origin || "http://127.0.0.1")
        const internal = input.handleInternalRequest ? await input.handleInternalRequest(request, reqUrl) : undefined
        if (internal) {
          response.writeHead(internal.status ?? 200, internal.headers)
          response.end(internal.body)
          return
        }
        if (reqUrl.pathname.startsWith("/instance/")) {
          const [, , id, ...rest] = reqUrl.pathname.split("/")
          const instance = id ? input.getInstance(id) : undefined
          if (!instance) {
            log("proxy.instance.unknown", { id, pathname: reqUrl.pathname })
            response.writeHead(404)
            response.end("Unknown instance")
            return
          }
          await proxyRequest(request, response, reqUrl, instance, `/${rest.join("/")}`)
          return
        }

        if (!root) {
          log("server.not-ready", { pathname: reqUrl.pathname })
          response.writeHead(503)
          response.end("Desktop UI not ready")
          return
        }

        const accept = request.headers.accept ?? ""
        const instance = inferInstance(request, reqUrl)
        const apiRequest =
          reqUrl.pathname !== "/" &&
          !reqUrl.pathname.startsWith("/assets/") &&
          path.extname(reqUrl.pathname) === "" &&
          (request.method !== "GET" && request.method !== "HEAD" ? true : !accept.includes("text/html"))
        if (instance && apiRequest) {
          await proxyRequest(request, response, reqUrl, instance, reqUrl.pathname)
          return
        }

        const requested = staticFile(root, reqUrl.pathname)
        const fallback = path.join(root, "index.html")
        const assetRequest = reqUrl.pathname.includes("/assets/") || path.extname(reqUrl.pathname) !== ""
        const file =
          (await exists(requested)) && !(await fs.stat(requested)).isDirectory()
            ? requested
            : assetRequest
              ? ""
              : fallback
        if (!file) {
          log("server.asset-miss", { pathname: reqUrl.pathname, requested })
          response.writeHead(404)
          response.end("Not found")
          return
        }
        const body = await fs.readFile(file)
        response.setHeader("Content-Type", mime(file))
        response.setHeader(
          "Cache-Control",
          file.endsWith("index.html") ? "no-store, no-cache, must-revalidate" : "public, max-age=31536000, immutable",
        )
        log("server.asset-hit", { file, pathname: reqUrl.pathname })
        response.end(body)
      })().catch((error) => {
        if (isClientClosedError(error) || !responseOpen(response)) {
          log("server.client-closed", { pathname: request.url ?? "/" })
          if (responseOpen(response)) response.destroy()
          return
        }
        log("server.error", { error, pathname: request.url ?? "/" })
        if (response.headersSent || !responseOpen(response)) return
        response.writeHead(502)
        response.end(error instanceof Error ? error.message : String(error))
      })
    })
    server.on("upgrade", (request, socket, head) => {
      void proxyUpgrade(request, socket, head).catch((error) => {
        log("server.upgrade.error", { error, pathname: request.url ?? "/" })
        socket.destroy()
      })
    })
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject)
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address()
        if (!address || typeof address === "string") {
          reject(new Error("Unable to resolve desktop UI host address"))
          return
        }
        origin = `http://127.0.0.1:${address.port}`
        log("server.ready", { origin })
        resolve()
      })
    })
    return origin
  }

  const prepare = async (
    instance: DesktopHostInstance,
    progress?: (progress: DesktopUIPrepareProgress) => void,
    opts?: { targetVersion?: string },
  ) => {
    log("prepare.start", { id: instance.id, targetVersion: opts?.targetVersion, url: instance.url })
    const session = input.getSession(instance)
    const originValue = instanceOrigin(instance.url)

    progress?.({
      phase: "probe",
      message: opts?.targetVersion
        ? `Preparing UI for Codeplane ${opts.targetVersion}…`
        : "Checking server version…",
      percent: 5,
      version: opts?.targetVersion,
    })
    // Always re-check the server before choosing a UI bundle. A fresh
    // origin-cache entry only proves that the cache was valid at the last
    // connection; after an external server upgrade it becomes exactly the
    // stale pointer that makes Desktop keep loading the old client.
    const version = opts?.targetVersion ?? (await fetchVersion(session, instance))
    log(opts?.targetVersion ? "version.target.given" : "version.fetch.success", {
      id: instance.id,
      url: instance.url,
      version,
    })
    activeID = instance.id
    progress?.({
      phase: "download",
      message: `Preparing UI for Codeplane ${version}…`,
      percent: 10,
      version,
    })
    const existing = inflight.get(version)
    const ready =
      existing ??
      ensureCachedVersion(input.cacheDir, session, instance, version, log, progress)
        .then((value) => {
          log("cache.ready", { root: value, version })
          return value
        })
        .finally(() => inflight.delete(version))
    log(existing ? "cache.inflight.reuse" : "cache.inflight.start", { version })
    inflight.set(version, ready)
    try {
      root = await ready
    } catch (error) {
      inflight.delete(version)
      throw error
    }
    progress?.({
      phase: "finalize",
      message: "Finishing desktop cache setup…",
      percent: 97,
      version,
    })
    await cleanupUnused(input.cacheDir)
    await touchVersion(input.cacheDir, version, originValue, instance.id)
    await markOriginChecked(input.cacheDir, originValue, version)
    log("prepare.success", { id: instance.id, root, version })
    const url = `${await ensureServer()}/?server=${encodeURIComponent(instance.id)}&ui=${encodeURIComponent(version)}`
    progress?.({
      phase: "done",
      message: `UI ready for Codeplane ${version}.`,
      percent: 100,
      version,
    })
    return {
      url,
      version,
    }
  }

  const cacheInfo = async (instance: DesktopHostInstance): Promise<DesktopUICacheInfo> => {
    const originValue = httpOrigin(instance)
    const index = await readOriginIndex(input.cacheDir)
    const root = cacheRoot(input.cacheDir)
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    const versions = new Set<string>()
    const origins = new Set<string>()
    if (originValue) {
      origins.add(originValue)
      const indexed = index[originValue]
      if (indexed) versions.add(indexed.version)
    }
    if (instance.local?.binaryVersion) versions.add(instance.local.binaryVersion)

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const meta = await readMetadata(path.join(root, entry.name))
          const recorded = meta?.instances?.[instance.id]
          if (recorded) {
            versions.add(entry.name)
            origins.add(recorded.origin)
            return
          }
          if (originValue && meta?.origin === originValue) versions.add(entry.name)
        }),
    )

    const resolved = (
      await Promise.all(
        [...versions].map(async (version) => {
          const bytes = await directoryBytes(versionRoot(input.cacheDir, version))
          if (bytes === 0) return
          return { bytes, version }
        }),
      )
    ).filter((entry): entry is { bytes: number; version: string } => entry !== undefined)

    return {
      bytes: resolved.reduce((sum, entry) => sum + entry.bytes, 0),
      exists: resolved.length > 0,
      origins: [...origins].filter(Boolean).sort(),
      versions: resolved.map((entry) => entry.version).sort(),
    }
  }

  const clearCache = async (instance: DesktopHostInstance): Promise<DesktopUICacheInfo> => {
    const before = await cacheInfo(instance)
    if (!before.exists) return before

    const index = await readOriginIndex(input.cacheDir)
    const nextIndex: OriginIndex = { ...index }
    for (const originValue of before.origins) delete nextIndex[originValue]
    await writeOriginIndex(input.cacheDir, nextIndex)

    await Promise.all(
      before.versions.map(async (version) => {
        const target = versionRoot(input.cacheDir, version)
        const meta = await readMetadata(target)
        const nextInstances = { ...meta?.instances }
        delete nextInstances[instance.id]
        const usedByOrigin = Object.values(nextIndex).some((entry) => entry.version === version)
        const usedByInstance = Object.keys(nextInstances).length > 0
        if (usedByOrigin || usedByInstance) {
          if (meta) {
            await writeMetadata(target, {
              ...meta,
              instances: usedByInstance ? nextInstances : undefined,
            })
          }
          return
        }
        await fs.rm(target, { force: true, recursive: true })
      }),
    )
    return before
  }

  return {
    origin: () => ensureServer(),
    bootstrap(instances: DesktopHostInstance[], currentID?: string) {
      if (!origin) throw new Error("Desktop UI host is not ready")
      if (currentID) activeID = currentID
      return {
        currentKey: currentID ? proxyKey(currentID) : null,
        instances: instances.map(
          (instance): ProxyInstance => ({
            id: instance.id,
            key: proxyKey(instance.id),
            label: instance.label,
            local: !!instance.local,
            proxyUrl: `${origin}/instance/${encodeURIComponent(instance.id)}`,
            remoteUrl: instance.url,
          }),
        ),
      }
    },
    async cleanup() {
      log("cleanup.start", { cacheDir: input.cacheDir })
      await cleanupUnused(input.cacheDir)
      log("cleanup.success", { cacheDir: input.cacheDir })
    },
    cacheInfo,
    clearCache,
    prepare,
    proxyKey,
  }
}
