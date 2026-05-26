import { useMarked } from "../context/marked"
import { useI18n } from "../context/i18n"
import { useFileReference, type FileReferenceSelection } from "../context/file"
import DOMPurify from "dompurify"
import morphdom from "morphdom"
import stripAnsi from "strip-ansi"
import { checksum } from "@codeplane-ai/shared/util/encode"
import { ComponentProps, createEffect, createMemo, createResource, createSignal, onCleanup, splitProps } from "solid-js"
import { isServer } from "solid-js/web"
import { stream } from "./markdown-stream"
import { showToast } from "./toast"
import { writeClipboardText } from "./clipboard"

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_ATTR: ["target", "playsinline"],
}

const iconPaths = {
  copy: '<path d="M6.2513 6.24935V2.91602H17.0846V13.7493H13.7513M13.7513 6.24935V17.0827H2.91797V6.24935H13.7513Z" stroke="currentColor" stroke-linecap="round"/>',
  check: '<path d="M5 11.9657L8.37838 14.7529L15 5.83398" stroke="currentColor" stroke-linecap="square"/>',
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function escape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fallback(markdown: string) {
  return escape(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

const wrapCache = new Map<string, string>()
const wrapMax = 200

function wrapWordsRaw(text: string) {
  const escaped = escape(text).replace(/\r\n?/g, "\n")
  let out = ""
  let buffer = ""
  const flush = () => {
    if (!buffer) return
    out += `<span data-md-word>${buffer}</span>`
    buffer = ""
  }
  let i = 0
  while (i < escaped.length) {
    const ch = escaped[i]
    if (ch === "&") {
      const end = escaped.indexOf(";", i)
      if (end !== -1 && end - i <= 8) {
        buffer += escaped.slice(i, end + 1)
        i = end + 1
        continue
      }
    }
    if (ch === "\n") {
      flush()
      out += "<br>"
      i++
      continue
    }
    if (ch === " " || ch === "\t") {
      flush()
      out += ch
      i++
      continue
    }
    buffer += ch
    i++
  }
  flush()
  return out
}

function wrapWords(text: string) {
  if (text.length < 32) return wrapWordsRaw(text)
  const key = checksum(text)
  if (!key) return wrapWordsRaw(text)
  const hit = wrapCache.get(key)
  if (hit !== undefined) {
    wrapCache.delete(key)
    wrapCache.set(key, hit)
    return hit
  }
  const out = wrapWordsRaw(text)
  wrapCache.set(key, out)
  if (wrapCache.size > wrapMax) {
    const first = wrapCache.keys().next().value
    if (first !== undefined) wrapCache.delete(first)
  }
  return out
}

type CopyLabels = {
  copy: string
  copied: string
  copyCode: string
  copiedCode: string
  copyPath: string
  copiedPath: string
}

type Mermaid = (typeof import("mermaid"))["default"]

const urlPattern = /^https?:\/\/[^\s<>()`"']+$/
let mermaidPromise: Promise<Mermaid> | undefined
let mermaidCounter = 0

function codeUrl(text: string) {
  const href = text.trim().replace(/[),.;!?]+$/, "")
  if (!urlPattern.test(href)) return
  try {
    const url = new URL(href)
    return url.toString()
  } catch {
    return
  }
}

/**
 * Best-effort dark-mode detection from the document root. We try a few
 * signals because every codeplane theme system has historically toggled it
 * differently (data attribute, class name, color-scheme media query). This
 * just decides which mermaid built-in theme — `dark` or `default` — gives
 * us readable contrast.
 */
function detectDarkMode(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false
  const root = document.documentElement
  if (root.dataset.theme && /dark/i.test(root.dataset.theme)) return true
  if (root.classList.contains("dark") || root.classList.contains("theme-dark")) return true
  // Fall back to comparing the computed background luminance — if the page
  // background is darker than 50% gray, treat it as a dark theme.
  const bg = getComputedStyle(root).getPropertyValue("--background-base").trim()
  if (bg) {
    const m = bg.match(/^#([0-9a-fA-F]{3,8})$/)
    if (m) {
      const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      if (lum < 0.5) return true
    }
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  }
  return false
}

function loadMermaid() {
  if (mermaidPromise) return mermaidPromise
  mermaidPromise = import("mermaid").then((mod) => {
    // Use mermaid's built-in `default` (light) or `dark` themes. They ship
    // with palettes that are guaranteed to contrast across ALL diagram
    // types — flowchart, mindmap, gantt, sequence, etc. — including the
    // mindmap-specific `cScale*` / `cScaleLabel*` variables. We previously
    // overrode only a handful of theme variables (primaryColor, etc.),
    // which left mindmap nodes with no label color and they rendered
    // black-on-black.
    //
    // We deliberately do NOT pass `themeVariables` here — the moment we
    // pass even ONE `var(--…)` reference, mermaid's color parser crashes
    // because it can't resolve it (it expects literal hex/rgb).
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: detectDarkMode() ? "dark" : "default",
      themeVariables: {
        background: "transparent",
        // `fontFamily` is allowed to be a CSS string — it isn't passed to
        // the color parser, so keeping the var here means the diagram
        // tracks the running theme's font.
        fontFamily: "var(--font-family-sans)",
      },
    })
    return mod.default
  })
  return mermaidPromise
}

/**
 * Sanitise mermaid's SVG output before injecting it into the DOM.
 *
 * Why we don't use DOMPurify here: mermaid mindmap (and several other
 * diagram types) embed node labels inside an SVG `<foreignObject>` whose
 * body is XHTML (`<div xmlns="http://www.w3.org/1999/xhtml"><span
 * class="nodeLabel">…`). DOMPurify's SVG profile strips XHTML-namespaced
 * elements unconditionally, so labels disappeared. Even with the `html`
 * profile bolted on we ended up with empty `<foreignObject>` shells —
 * shapes rendered fine, labels invisible. The user reported this as
 * "black boxes with no text".
 *
 * The mermaid library is trusted (we ship and call it ourselves), so the
 * sanitiser here only needs to defend against tampering of the rendered
 * SVG via untrusted CONTENT (a malicious model emitting an `onerror=…`
 * inside a label, etc.). We:
 *   1. Parse the SVG with the DOMParser (image/svg+xml mode).
 *   2. Walk every node, dropping `<script>` outright.
 *   3. Strip every attribute whose name starts with `on` (event handlers).
 *   4. Strip `href`/`xlink:href` whose value isn't a same-document fragment
 *      or an https URL.
 *
 * That's enough — `<style>` is preserved (otherwise the diagram is
 * unstyled), `<foreignObject>` and its xhtml children are preserved
 * (otherwise mindmap labels are gone), and we still block the actual
 * attack vectors (script injection, event handlers, javascript: URLs).
 */
function sanitizeMermaid(svg: string): string {
  if (typeof window === "undefined") return ""
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  } catch {
    return ""
  }
  // Reject when the parser reported an error.
  if (doc.querySelector("parsererror")) return ""
  const root = doc.documentElement
  if (!root || root.localName !== "svg") return ""

  const isSafeHref = (value: string): boolean => {
    const trimmed = value.trim()
    if (!trimmed) return true
    if (trimmed.startsWith("#")) return true
    if (/^https?:\/\//i.test(trimmed)) return true
    if (trimmed.startsWith("/")) return true
    return false
  }

  const visit = (node: Element) => {
    // Drop <script> entirely.
    if (node.localName === "script") {
      node.remove()
      return
    }
    // Strip event-handler attributes and unsafe URLs.
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith("on")) {
        node.removeAttribute(attr.name)
        continue
      }
      if (name === "href" || name === "xlink:href") {
        if (!isSafeHref(attr.value)) {
          node.removeAttribute(attr.name)
        }
      }
    }
    for (const child of Array.from(node.children)) visit(child)
  }
  visit(root)

  return new XMLSerializer().serializeToString(root)
}

function isMermaidBlock(block: HTMLPreElement) {
  if (block.dataset.language?.toLowerCase() === "mermaid") return true
  const code = block.querySelector("code")
  const className = `${block.className} ${code?.className ?? ""}`
  return /\blang(?:uage)?-mermaid\b/i.test(className)
}

type FileReferenceMatch = {
  raw: string
  path: string
  index: number
  end: number
  selection?: FileReferenceSelection
}

const fileReferenceExtensions =
  "astro|c|cc|cpp|cs|css|go|h|hpp|html|java|js|jsx|json|kt|lua|md|mdx|mjs|py|rs|scss|sh|sql|svelte|swift|toml|ts|tsx|txt|vue|yaml|yml"
const fileReferencePathSource = `@?(?:(?:\\.{1,2}\\/|\\/)?(?:[\\w.$+@ -]+\\/)+[\\w.$+@ -]+\\.[A-Za-z0-9]{1,16}|[\\w.@+-]+\\.(?:${fileReferenceExtensions}))`
const fileReferencePattern = new RegExp(`(^|[\\s([{"'])(${fileReferencePathSource})(?::(\\d+)(?:-(\\d+))?)?`, "g")
const singleFileReferencePattern = new RegExp(`^(${fileReferencePathSource})(?::(\\d+)(?:-(\\d+))?)?$`)

function fileReferenceSelection(start?: string, end?: string) {
  if (!start) return
  const startLine = Number(start)
  if (!Number.isInteger(startLine) || startLine <= 0) return
  const endLine = end ? Number(end) : undefined
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine <= 0)) return { startLine }
  return { startLine, endLine }
}

function cleanFileReferencePath(path: string) {
  return path.startsWith("@") ? path.slice(1) : path
}

function singleFileReference(text: string) {
  const match = text.trim().match(singleFileReferencePattern)
  if (!match?.[1]) return
  return {
    raw: text.trim(),
    path: cleanFileReferencePath(match[1]),
    index: 0,
    end: text.trim().length,
    selection: fileReferenceSelection(match[2], match[3]),
  } satisfies FileReferenceMatch
}

function fileReferences(text: string) {
  const result: FileReferenceMatch[] = []
  fileReferencePattern.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = fileReferencePattern.exec(text))) {
    const prefix = match[1] ?? ""
    const path = match[2]
    if (!path) continue

    const raw = match[0].slice(prefix.length)
    result.push({
      raw,
      path: cleanFileReferencePath(path),
      index: match.index + prefix.length,
      end: match.index + match[0].length,
      selection: fileReferenceSelection(match[3], match[4]),
    })
  }

  return result
}

function createIcon(path: string, slot: string) {
  const icon = document.createElement("div")
  icon.setAttribute("data-component", "icon")
  icon.setAttribute("data-size", "small")
  icon.setAttribute("data-slot", slot)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("data-slot", "icon-svg")
  svg.setAttribute("fill", "none")
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = path
  icon.appendChild(svg)
  return icon
}

function createCopyButton(labels: CopyLabels) {
  const button = document.createElement("button")
  button.type = "button"
  button.setAttribute("data-component", "icon-button")
  button.setAttribute("data-variant", "secondary")
  button.setAttribute("data-size", "small")
  button.setAttribute("data-slot", "markdown-copy-button")
  button.setAttribute("aria-label", labels.copyCode)
  button.setAttribute("data-tooltip", labels.copyCode)
  button.appendChild(createIcon(iconPaths.copy, "copy-icon"))
  button.appendChild(createIcon(iconPaths.check, "check-icon"))
  return button
}

function setCopyState(button: HTMLButtonElement, labels: CopyLabels, copied: boolean) {
  if (copied) {
    button.setAttribute("data-copied", "true")
    button.setAttribute("aria-label", labels.copiedCode)
    button.setAttribute("data-tooltip", labels.copiedCode)
    return
  }
  button.removeAttribute("data-copied")
  button.setAttribute("aria-label", labels.copyCode)
  button.setAttribute("data-tooltip", labels.copyCode)
}

function setSelectionData(element: HTMLElement, selection: FileReferenceSelection | undefined) {
  if (!selection) return
  element.dataset.fileReferenceLineStart = String(selection.startLine)
  if (selection.endLine) element.dataset.fileReferenceLineEnd = String(selection.endLine)
}

function selectionFromElement(element: HTMLElement) {
  const start = element.dataset.fileReferenceLineStart
  if (!start) return
  return fileReferenceSelection(start, element.dataset.fileReferenceLineEnd)
}

function createFileReferenceElement(ref: FileReferenceMatch, label: string, labels: CopyLabels) {
  const wrapper = document.createElement("span")
  wrapper.setAttribute("data-component", "file-reference")

  const open = document.createElement("button")
  open.type = "button"
  open.setAttribute("data-slot", "file-reference-open")
  open.dataset.fileReferencePath = ref.path
  open.title = ref.path
  setSelectionData(open, ref.selection)
  open.textContent = label

  const copy = document.createElement("button")
  copy.type = "button"
  copy.setAttribute("data-component", "icon-button")
  copy.setAttribute("data-variant", "ghost")
  copy.setAttribute("data-size", "small")
  copy.setAttribute("data-slot", "file-reference-copy")
  copy.dataset.fileReferencePath = ref.path
  copy.setAttribute("aria-label", labels.copyPath)
  copy.setAttribute("data-tooltip", labels.copyPath)
  copy.appendChild(createIcon(iconPaths.copy, "copy-icon"))

  wrapper.appendChild(open)
  wrapper.appendChild(copy)
  return wrapper
}

function ensureCodeWrapper(block: HTMLPreElement, labels: CopyLabels) {
  const parent = block.parentElement
  if (!parent) return
  const wrapped = parent.getAttribute("data-component") === "markdown-code"
  if (!wrapped) {
    const wrapper = document.createElement("div")
    wrapper.setAttribute("data-component", "markdown-code")
    parent.replaceChild(wrapper, block)
    wrapper.appendChild(block)
    wrapper.appendChild(createCopyButton(labels))
    return
  }

  const buttons = Array.from(parent.querySelectorAll('[data-slot="markdown-copy-button"]')).filter(
    (el): el is HTMLButtonElement => el instanceof HTMLButtonElement,
  )

  if (buttons.length === 0) {
    parent.appendChild(createCopyButton(labels))
    return
  }

  for (const button of buttons.slice(1)) {
    button.remove()
  }
}

function markCodeLinks(root: HTMLDivElement) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    const href = codeUrl(code.textContent ?? "")
    const parentLink =
      code.parentElement instanceof HTMLAnchorElement && code.parentElement.classList.contains("external-link")
        ? code.parentElement
        : null

    if (!href) {
      if (parentLink) parentLink.replaceWith(code)
      continue
    }

    if (parentLink) {
      parentLink.href = href
      continue
    }

    const link = document.createElement("a")
    link.href = href
    link.className = "external-link"
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    code.parentNode?.replaceChild(link, code)
    link.appendChild(code)
  }
}

function markInlineCodeFileReferences(root: HTMLDivElement, labels: CopyLabels) {
  const codeNodes = Array.from(root.querySelectorAll(":not(pre) > code"))
  for (const code of codeNodes) {
    if (code.closest('[data-component="file-reference"]')) continue
    if (code.parentElement instanceof HTMLAnchorElement) continue

    const ref = singleFileReference(code.textContent ?? "")
    if (!ref) continue

    code.replaceWith(createFileReferenceElement(ref, code.textContent ?? ref.raw, labels))
  }
}

function markTextFileReferences(root: HTMLDivElement, labels: CopyLabels) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT
      if (parent.closest('pre, code, a, button, [data-component="file-reference"]')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node instanceof Text) nodes.push(node)
  }

  for (const textNode of nodes) {
    const refs = fileReferences(textNode.data)
    if (refs.length === 0) continue

    const fragment = document.createDocumentFragment()
    let cursor = 0

    for (const ref of refs) {
      if (ref.index > cursor) fragment.appendChild(document.createTextNode(textNode.data.slice(cursor, ref.index)))
      fragment.appendChild(createFileReferenceElement(ref, ref.raw, labels))
      cursor = ref.end
    }

    if (cursor < textNode.data.length) fragment.appendChild(document.createTextNode(textNode.data.slice(cursor)))
    textNode.replaceWith(fragment)
  }
}

function markMermaidBlocks(root: HTMLDivElement) {
  const blocks = Array.from(root.querySelectorAll("pre")).filter(
    (block): block is HTMLPreElement => block instanceof HTMLPreElement && isMermaidBlock(block),
  )

  for (const block of blocks) {
    const wrapper = block.parentElement
    const code = block.querySelector("code")
    const hash = checksum(code?.textContent ?? "")
    if (!wrapper || !hash) continue

    wrapper.setAttribute("data-mermaid", "true")
    wrapper.dataset.mermaidHash = hash
    block.setAttribute("data-language", "mermaid")

    const existing = Array.from(wrapper.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.getAttribute("data-component") === "mermaid-preview",
    )
    const preview = existing ?? document.createElement("div")
    preview.setAttribute("data-component", "mermaid-preview")
    preview.setAttribute("role", "img")
    preview.setAttribute("aria-label", "Mermaid diagram")
    preview.dataset.mermaidHash = hash

    if (!existing) wrapper.insertBefore(preview, block)
  }
}

function decorate(root: HTMLDivElement, labels: CopyLabels) {
  const blocks = Array.from(root.querySelectorAll("pre"))
  for (const block of blocks) {
    ensureCodeWrapper(block, labels)
  }
  markMermaidBlocks(root)
  markCodeLinks(root)
  markInlineCodeFileReferences(root, labels)
  markTextFileReferences(root, labels)
}

function setupCodeCopy(root: HTMLDivElement, getLabels: () => CopyLabels) {
  const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

  const updateLabel = (button: HTMLButtonElement) => {
    const labels = getLabels()
    const copied = button.getAttribute("data-copied") === "true"
    setCopyState(button, labels, copied)
  }

  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const button = target.closest('[data-slot="markdown-copy-button"]')
    if (!(button instanceof HTMLButtonElement)) return
    const code = button.closest('[data-component="markdown-code"]')?.querySelector("code")
    const content = code?.textContent ?? ""
    if (!content) return
    if (!(await writeClipboardText(content))) return
    const labels = getLabels()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: labels.copied,
      description: labels.copiedCode,
    })
    setCopyState(button, labels, true)
    const existing = timeouts.get(button)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => setCopyState(button, labels, false), 2000)
    timeouts.set(button, timeout)
  }

  const buttons = Array.from(root.querySelectorAll('[data-slot="markdown-copy-button"]'))
  for (const button of buttons) {
    if (button instanceof HTMLButtonElement) updateLabel(button)
  }

  root.addEventListener("click", handleClick)

  return () => {
    root.removeEventListener("click", handleClick)
    for (const timeout of timeouts.values()) {
      clearTimeout(timeout)
    }
  }
}

function setupFileReferences(
  root: HTMLDivElement,
  getLabels: () => CopyLabels,
  getOpen: () => ((path: string, selection?: FileReferenceSelection) => void) | undefined,
) {
  const handleClick = async (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const copy = target.closest('[data-slot="file-reference-copy"]')
    if (copy instanceof HTMLElement) {
      const path = copy.dataset.fileReferencePath
      if (!path) return
      event.preventDefault()
      event.stopPropagation()

      if (!(await writeClipboardText(path))) return

      const labels = getLabels()
      showToast({
        variant: "success",
        icon: "circle-check",
        title: labels.copied,
        description: labels.copiedPath,
      })
      return
    }

    const open = target.closest('[data-slot="file-reference-open"]')
    if (!(open instanceof HTMLElement)) return

    const path = open.dataset.fileReferencePath
    if (!path) return

    const handler = getOpen()
    if (!handler) return

    event.preventDefault()
    event.stopPropagation()
    handler(path, selectionFromElement(open))
  }

  root.addEventListener("click", handleClick)
  return () => root.removeEventListener("click", handleClick)
}

function renderMermaidPreviews(root: HTMLDivElement) {
  const blocks = Array.from(root.querySelectorAll('[data-component="markdown-code"][data-mermaid="true"]')).filter(
    (block): block is HTMLElement => block instanceof HTMLElement,
  )
  const pending = blocks.filter((block) => {
    const hash = block.dataset.mermaidHash
    const preview = Array.from(block.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.getAttribute("data-component") === "mermaid-preview",
    )
    if (!hash || !preview) return false
    if (preview.dataset.mermaidRendering === hash) return false
    return preview.dataset.mermaidRendered !== hash
  })
  if (pending.length === 0) return

  void loadMermaid()
    .then((mermaid) => {
      for (const block of pending) {
        const hash = block.dataset.mermaidHash
        const preview = Array.from(block.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && child.getAttribute("data-component") === "mermaid-preview",
        )
        const source = block.querySelector("pre code")?.textContent
        if (!hash || !preview || !source) continue

        preview.dataset.mermaidRendering = hash
        block.dataset.mermaidState = "pending"

        void mermaid
          .render(`markdown-mermaid-${hash}-${mermaidCounter++}`, source)
          .then((result) => {
            if (block.dataset.mermaidHash !== hash) return
            const svg = sanitizeMermaid(result.svg)
            if (!svg) {
              delete preview.dataset.mermaidRendering
              block.dataset.mermaidState = "error"
              return
            }
            preview.innerHTML = svg
            result.bindFunctions?.(preview)
            preview.dataset.mermaidRendered = hash
            delete preview.dataset.mermaidRendering
            block.dataset.mermaidState = "rendered"
          })
          .catch(() => {
            if (block.dataset.mermaidHash !== hash) return
            preview.replaceChildren()
            delete preview.dataset.mermaidRendered
            delete preview.dataset.mermaidRendering
            block.dataset.mermaidState = "error"
          })
      }
    })
    .catch(() => {
      for (const block of pending) {
        block.dataset.mermaidState = "error"
      }
    })
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

function normalizeText(input: string) {
  if (!input) return input
  // Strip ANSI escape sequences so terminal output (e.g. test runners,
  // shell tools) doesn't render ESC bytes as visible glyphs in chat.
  return stripAnsi(input)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    streaming?: boolean
    class?: string
    classList?: Record<string, boolean>
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "streaming", "class", "classList"])
  const marked = useMarked()
  const i18n = useI18n()
  const fileReference = useFileReference()
  const [root, setRoot] = createSignal<HTMLDivElement>()
  const cachedHtml = createMemo(() => {
    if (isServer) return undefined
    const text = normalizeText(local.text)
    if (!text) return ""
    const base = local.cacheKey ?? checksum(text)
    if (!base) return undefined
    const blocks = stream(text, local.streaming ?? false)
    const out: string[] = []
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]
      const hash = checksum(block.raw)
      if (!hash) return undefined
      const key = `${base}:${index}:${block.mode}`
      const cached = cache.get(key)
      if (!cached || cached.hash !== hash) return undefined
      touch(key, cached)
      out.push(cached.html)
    }
    return out.join("")
  })

  const liveHtml = createMemo(() => {
    if (isServer) return undefined
    if (!local.streaming) return undefined
    const text = normalizeText(local.text)
    if (!text) return undefined
    const base = local.cacheKey ?? checksum(text)
    if (!base) return undefined
    const blocks = stream(text, true)
    if (blocks.length === 0) return undefined
    const out: string[] = []
    let usedFallback = false
    for (let index = 0; index < blocks.length; index++) {
      const block = blocks[index]
      const hash = checksum(block.raw)
      if (!hash) return undefined
      const key = `${base}:${index}:${block.mode}`
      const cached = cache.get(key)
      if (cached && cached.hash === hash) {
        out.push(cached.html)
        continue
      }
      out.push(wrapWords(block.src))
      usedFallback = true
    }
    return usedFallback ? out.join("") : undefined
  })

  const [html] = createResource(
    () => {
      const cached = cachedHtml()
      if (cached !== undefined) return null
      return {
        text: normalizeText(local.text),
        key: local.cacheKey,
        streaming: local.streaming ?? false,
      }
    },
    async (src) => {
      if (src === null) return ""
      if (isServer) return fallback(src.text)
      if (!src.text) return ""

      const base = src.key ?? checksum(src.text)
      return Promise.all(
        stream(src.text, src.streaming).map(async (block, index) => {
          const hash = checksum(block.raw)
          const key = base ? `${base}:${index}:${block.mode}` : hash

          if (key && hash) {
            const cached = cache.get(key)
            if (cached && cached.hash === hash) {
              touch(key, cached)
              return cached.html
            }
          }

          const next = await Promise.resolve(marked.parse(block.src))
          const safe = sanitize(next)
          if (key && hash) touch(key, { hash, html: safe })
          return safe
        }),
      )
        .then((list) => list.join(""))
        .catch(() => fallback(src.text))
    },
    { initialValue: fallback(normalizeText(local.text)) },
  )

  let copyCleanup: (() => void) | undefined
  let fileReferenceCleanup: (() => void) | undefined
  let lastContent: string | undefined
  let lastLocale: string | undefined

  createEffect(() => {
    const container = root()
    const cached = cachedHtml()
    const live = liveHtml()
    const parsed = html.latest ?? html()
    const content = local.text ? (cached ?? parsed ?? live ?? "") : ""
    if (!container) return
    if (isServer) return

    if (!content) {
      if (lastContent !== "") {
        container.innerHTML = ""
        lastContent = ""
      }
      return
    }

    const locale = i18n.t("ui.message.copyCode")
    if (content === lastContent && locale === lastLocale) return

    const labels = {
      copy: i18n.t("ui.message.copy"),
      copied: i18n.t("ui.message.copied"),
      copyCode: locale,
      copiedCode: i18n.t("ui.message.copiedCode"),
      copyPath: i18n.t("ui.message.copyPath"),
      copiedPath: i18n.t("ui.message.copiedPath"),
    }
    lastContent = content
    lastLocale = locale
    const temp = document.createElement("div")
    temp.innerHTML = content
    decorate(temp, labels)

    morphdom(container, temp, {
      childrenOnly: true,
      onBeforeElUpdated: (fromEl, toEl) => {
        if (fromEl instanceof HTMLElement && toEl instanceof HTMLElement) {
          if (
            fromEl.getAttribute("data-component") === "mermaid-preview" &&
            toEl.getAttribute("data-component") === "mermaid-preview" &&
            fromEl.dataset.mermaidHash === toEl.dataset.mermaidHash &&
            fromEl.dataset.mermaidRendered === fromEl.dataset.mermaidHash
          ) {
            return false
          }
          if (
            fromEl.getAttribute("data-component") === "markdown-code" &&
            toEl.getAttribute("data-component") === "markdown-code" &&
            fromEl.dataset.mermaid === "true" &&
            fromEl.dataset.mermaidHash === toEl.dataset.mermaidHash &&
            fromEl.dataset.mermaidState
          ) {
            toEl.dataset.mermaidState = fromEl.dataset.mermaidState
          }
        }
        if (
          fromEl instanceof HTMLButtonElement &&
          toEl instanceof HTMLButtonElement &&
          fromEl.getAttribute("data-slot") === "markdown-copy-button" &&
          toEl.getAttribute("data-slot") === "markdown-copy-button" &&
          fromEl.getAttribute("data-copied") === "true"
        ) {
          setCopyState(toEl, labels, true)
        }
        if (fromEl.isEqualNode(toEl)) return false
        return true
      },
    })
    renderMermaidPreviews(container)

    if (!copyCleanup)
      copyCleanup = setupCodeCopy(container, () => ({
        copy: i18n.t("ui.message.copy"),
        copied: i18n.t("ui.message.copied"),
        copyCode: i18n.t("ui.message.copyCode"),
        copiedCode: i18n.t("ui.message.copiedCode"),
        copyPath: i18n.t("ui.message.copyPath"),
        copiedPath: i18n.t("ui.message.copiedPath"),
      }))
    if (!fileReferenceCleanup)
      fileReferenceCleanup = setupFileReferences(
        container,
        () => ({
          copy: i18n.t("ui.message.copy"),
          copied: i18n.t("ui.message.copied"),
          copyCode: i18n.t("ui.message.copyCode"),
          copiedCode: i18n.t("ui.message.copiedCode"),
          copyPath: i18n.t("ui.message.copyPath"),
          copiedPath: i18n.t("ui.message.copiedPath"),
        }),
        () => fileReference.open,
      )
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (fileReferenceCleanup) fileReferenceCleanup()
  })

  return (
    <div
      data-component="markdown"
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      ref={setRoot}
      {...others}
    />
  )
}
