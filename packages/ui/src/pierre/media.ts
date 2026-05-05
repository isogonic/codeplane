import type { FileContent } from "@codeplane-ai/sdk/v2"

export type MediaKind = "image" | "audio" | "video" | "svg" | "pdf" | "table" | "html" | "markdown" | "json"

const imageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "heif",
  "apng",
  "jxl",
])
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus", "weba"])
const videoExtensions = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv", "avi", "mpg", "mpeg"])
const tableExtensions = new Set(["csv", "tsv"])
const htmlExtensions = new Set(["html", "htm"])
const markdownExtensions = new Set(["md", "markdown", "mdown", "mkdn", "mdx"])
const jsonExtensions = new Set(["json", "jsonc", "json5", "geojson", "topojson"])

type MediaValue = unknown

function mediaRecord(value: unknown) {
  if (!value || typeof value !== "object") return
  return value as Partial<FileContent> & {
    content?: unknown
    encoding?: unknown
    mimeType?: unknown
    type?: unknown
  }
}

export function normalizeMimeType(type: string | undefined) {
  if (!type) return
  const mime = type.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return
  if (mime === "audio/x-aac") return "audio/aac"
  if (mime === "audio/x-m4a") return "audio/mp4"
  if (mime === "video/quicktime") return "video/mp4"
  if (mime === "video/x-matroska") return "video/webm"
  return mime
}

export function fileExtension(path: string | undefined) {
  if (!path) return ""
  const idx = path.lastIndexOf(".")
  if (idx === -1) return ""
  return path.slice(idx + 1).toLowerCase()
}

export function mediaKindFromPath(path: string | undefined): MediaKind | undefined {
  const ext = fileExtension(path)
  if (ext === "svg") return "svg"
  if (imageExtensions.has(ext)) return "image"
  if (audioExtensions.has(ext)) return "audio"
  if (videoExtensions.has(ext)) return "video"
  if (ext === "pdf") return "pdf"
  if (tableExtensions.has(ext)) return "table"
  if (htmlExtensions.has(ext)) return "html"
  if (markdownExtensions.has(ext)) return "markdown"
  if (jsonExtensions.has(ext)) return "json"
}

export function isBinaryContent(value: MediaValue) {
  return mediaRecord(value)?.type === "binary"
}

function validDataUrl(value: string, kind: MediaKind) {
  if (kind === "svg") return value.startsWith("data:image/svg+xml") ? value : undefined
  if (kind === "image") return value.startsWith("data:image/") ? value : undefined
  if (kind === "video") {
    if (value.startsWith("data:video/quicktime;")) return value.replace("data:video/quicktime;", "data:video/mp4;")
    if (value.startsWith("data:video/x-matroska;")) return value.replace("data:video/x-matroska;", "data:video/webm;")
    return value.startsWith("data:video/") ? value : undefined
  }
  if (kind === "pdf") return value.startsWith("data:application/pdf") ? value : undefined
  if (kind === "audio") {
    if (value.startsWith("data:audio/x-aac;")) return value.replace("data:audio/x-aac;", "data:audio/aac;")
    if (value.startsWith("data:audio/x-m4a;")) return value.replace("data:audio/x-m4a;", "data:audio/mp4;")
    if (value.startsWith("data:audio/")) return value
  }
}

export function dataUrlFromMediaValue(value: MediaValue, kind: MediaKind) {
  if (!value) return

  if (typeof value === "string") {
    return validDataUrl(value, kind)
  }

  const record = mediaRecord(value)
  if (!record) return

  if (typeof record.content !== "string") return

  const mime = normalizeMimeType(typeof record.mimeType === "string" ? record.mimeType : undefined)
  if (!mime) return

  if (kind === "svg") {
    if (mime !== "image/svg+xml") return
    if (record.encoding === "base64") return `data:image/svg+xml;base64,${record.content}`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(record.content)}`
  }

  if (kind === "pdf") {
    if (mime !== "application/pdf") return
    if (record.encoding !== "base64") return
    return `data:application/pdf;base64,${record.content}`
  }

  if (kind === "image" && !mime.startsWith("image/")) return
  if (kind === "audio" && !mime.startsWith("audio/")) return
  if (kind === "video" && !mime.startsWith("video/")) return
  if (record.encoding !== "base64") return

  return `data:${mime};base64,${record.content}`
}

function decodeBase64Utf8(value: string) {
  if (typeof atob !== "function") return

  try {
    const raw = atob(value)
    const bytes = Uint8Array.from(raw, (x) => x.charCodeAt(0))
    if (typeof TextDecoder === "function") return new TextDecoder().decode(bytes)
    return raw
  } catch {}
}

export function svgTextFromValue(value: MediaValue) {
  const record = mediaRecord(value)
  if (!record) return
  if (typeof record.content !== "string") return

  const mime = normalizeMimeType(typeof record.mimeType === "string" ? record.mimeType : undefined)
  if (mime !== "image/svg+xml") return
  if (record.encoding === "base64") return decodeBase64Utf8(record.content)
  return record.content
}

export function textFromValue(value: MediaValue) {
  if (typeof value === "string") return value
  const record = mediaRecord(value)
  if (!record) return
  if (typeof record.content !== "string") return
  if (record.type === "binary") return
  if (record.encoding === "base64") return decodeBase64Utf8(record.content)
  return record.content
}

export function hasMediaValue(value: MediaValue) {
  if (typeof value === "string") return value.length > 0
  const record = mediaRecord(value)
  if (!record) return false
  return typeof record.content === "string" && record.content.length > 0
}
