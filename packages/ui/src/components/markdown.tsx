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

function setupRichBlocks(root: HTMLDivElement) {
  const handleClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const tab = target.closest('[data-component="markdown-block"][data-block-type="tabs"] [data-slot="tabs-tab"]')
    if (!(tab instanceof HTMLButtonElement)) return
    const container = tab.closest('[data-component="markdown-block"][data-block-type="tabs"]')
    if (!(container instanceof HTMLElement)) return
    const index = tab.dataset.tabsIndex
    if (index === undefined) return
    activateTab(container, index)
  }

  const handleKey = (event: KeyboardEvent) => {
    const target = event.target
    if (!(target instanceof HTMLButtonElement)) return
    if (target.dataset.slot !== "tabs-tab") return
    const container = target.closest('[data-component="markdown-block"][data-block-type="tabs"]')
    if (!(container instanceof HTMLElement)) return
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-tab"]'))
    const current = tabs.indexOf(target)
    if (current < 0) return
    let next = current
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % tabs.length
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + tabs.length) % tabs.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = tabs.length - 1
    else return
    event.preventDefault()
    const target2 = tabs[next]
    if (!target2) return
    const index = target2.dataset.tabsIndex
    if (index === undefined) return
    activateTab(container, index)
    target2.focus()
  }

  root.addEventListener("click", handleClick)
  root.addEventListener("keydown", handleKey)
  // Hydrate any plot/coordinate-system blocks already in the tree, and
  // observe mutations so blocks streaming in later get hydrated too.
  setupPlotBlocks(root)
  const plotObserver = new MutationObserver(() => setupPlotBlocks(root))
  plotObserver.observe(root, { childList: true, subtree: true })
  return () => {
    root.removeEventListener("click", handleClick)
    root.removeEventListener("keydown", handleKey)
    plotObserver.disconnect()
    teardownPlotBlocks(root)
  }
}

function activateTab(container: HTMLElement, index: string) {
  const tabs = container.querySelectorAll<HTMLElement>('[data-slot="tabs-tab"]')
  const panels = container.querySelectorAll<HTMLElement>('[data-slot="tabs-panel"]')
  tabs.forEach((tab) => {
    const active = tab.dataset.tabsIndex === index
    tab.setAttribute("aria-selected", active ? "true" : "false")
    tab.setAttribute("tabindex", active ? "0" : "-1")
  })
  panels.forEach((panel) => {
    const active = panel.dataset.tabsIndex === index
    if (active) panel.removeAttribute("hidden")
    else panel.setAttribute("hidden", "")
  })
}

/* ------------------------------------------------------------------ *
 * Plot block hydration — turns the server-rendered SVG of a coordinate
 * system into an INTERACTIVE one with pan / zoom / hover.
 *
 * The block exposes its config via `data-plot-config` (a JSON blob we
 * trust because we wrote it). On hydration we:
 *   - parse the config,
 *   - keep a working `xRange` / `yRange` (mutated by pan/zoom),
 *   - re-render the SVG contents on every interaction (the same code
 *     that runs server-side, ported to the browser).
 *
 * Each block we touch gets `data-plot-hydrated="true"` so we don't
 * double-bind handlers — important because the markdown effect re-runs
 * on every streamed delta.
 * ------------------------------------------------------------------ */

type PlotKindH = "fn" | "points" | "line"
type PlotSeriesH = {
  kind: PlotKindH
  expr?: string | null
  data?: Array<[number, number]> | null
  color: string
  label?: string | null
  width: number
  dashed: boolean
}
type PlotConfigH = {
  xRange: [number, number]
  yRange: [number, number]
  grid: boolean
  title: string | null
  axisLabels: [string, string] | null
  series: PlotSeriesH[]
}

const plotTeardowns = new WeakMap<HTMLElement, () => void>()

function setupPlotBlocks(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>(
    '[data-component="markdown-block"][data-block-type="plot"]:not([data-plot-hydrated="true"])',
  )
  for (const block of Array.from(blocks)) {
    const teardown = hydratePlotBlock(block)
    if (teardown) {
      block.dataset.plotHydrated = "true"
      plotTeardowns.set(block, teardown)
    }
  }
}

function teardownPlotBlocks(root: HTMLElement) {
  const blocks = root.querySelectorAll<HTMLElement>(
    '[data-component="markdown-block"][data-block-type="plot"][data-plot-hydrated="true"]',
  )
  for (const block of Array.from(blocks)) {
    const fn = plotTeardowns.get(block)
    if (fn) {
      fn()
      plotTeardowns.delete(block)
    }
    block.removeAttribute("data-plot-hydrated")
  }
}

function plotIsSafeMathExpr(expr: string): boolean {
  if (typeof expr !== "string") return false
  if (expr.length > 200) return false
  if (!/^[a-zA-Z0-9_+\-*/%^().,\s]+$/.test(expr)) return false
  if (
    /\b(?:return|function|class|new|var|let|const|=>|\bthis\b|prototype|constructor|window|document|globalThis|process|require|import|eval|with|yield|async|await)\b/.test(
      expr,
    )
  ) {
    return false
  }
  return true
}

function plotCompileExpr(rawExpr: string): ((x: number) => number) | null {
  if (!plotIsSafeMathExpr(rawExpr)) return null
  const jsExpr = rawExpr.replace(/\^/g, "**")
  try {
    const body =
      "const { sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, exp, log, log2, log10, sqrt, cbrt, abs, sign, floor, ceil, round, pow, min, max, hypot, PI, E } = Math; " +
      "const pi = Math.PI, e = Math.E; " +
      `try { const __r = (${jsExpr}); return Number.isFinite(__r) ? __r : NaN; } catch { return NaN; }`
    return new Function("x", body) as (x: number) => number
  } catch {
    return null
  }
}

function plotNiceTickStep(range: number, target = 8): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const rough = range / target
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / pow
  let nice = 1
  if (norm >= 5) nice = 5
  else if (norm >= 2) nice = 2
  else if (norm >= 1) nice = 1
  return nice * pow
}

function plotFormatTick(value: number): string {
  if (!Number.isFinite(value)) return ""
  if (Math.abs(value) < 1e-9) return "0"
  const abs = Math.abs(value)
  if (abs >= 1000 || abs < 0.01) {
    return value
      .toExponential(1)
      .replace(/(\.\d*?)0+e/, "$1e")
      .replace(/\.e/, "e")
  }
  return parseFloat(value.toPrecision(4)).toString()
}

function plotEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function hydratePlotBlock(block: HTMLElement): (() => void) | undefined {
  const cfgRaw = block.dataset.plotConfig
  if (!cfgRaw) return
  let initial: PlotConfigH
  try {
    initial = JSON.parse(cfgRaw) as PlotConfigH
  } catch {
    return
  }
  const svg = block.querySelector<SVGSVGElement>("svg")
  const tooltip = block.querySelector<HTMLDivElement>('[data-slot="plot-tooltip"]')
  if (!svg || !tooltip) return

  let xRange: [number, number] = [...initial.xRange]
  let yRange: [number, number] = [...initial.yRange]

  const compiled = initial.series.map((s) =>
    s.kind === "fn" && s.expr ? plotCompileExpr(s.expr) : null,
  )

  const W = 640
  const H = 400
  // Match the renderer's gutters — keep these in sync with renderPlot()
  // so tick labels stay aligned through pan/zoom.
  const PAD_L = 56
  const PAD_R = 16
  const PAD_T = initial.title ? 36 : 16
  const PAD_B = 36
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  const xToPx = (x: number) => PAD_L + ((x - xRange[0]) / (xRange[1] - xRange[0])) * innerW
  const yToPx = (y: number) => PAD_T + (1 - (y - yRange[0]) / (yRange[1] - yRange[0])) * innerH
  const pxToX = (px: number) => xRange[0] + ((px - PAD_L) / innerW) * (xRange[1] - xRange[0])

  const gridLayer = svg.querySelector<SVGGElement>('[data-slot="plot-grid-layer"]')
  const axesLayer = svg.querySelector<SVGGElement>('[data-slot="plot-axes"]')
  const seriesLayer = svg.querySelector<SVGGElement>('[data-slot="plot-series-layer"]')
  const crosshairX = svg.querySelector<SVGLineElement>(
    '[data-slot="plot-crosshair"][data-axis="x"]',
  )
  const crosshairY = svg.querySelector<SVGLineElement>(
    '[data-slot="plot-crosshair"][data-axis="y"]',
  )
  const cursorDot = svg.querySelector<SVGCircleElement>('[data-slot="plot-cursor-dot"]')
  const resetBtn = block.querySelector<HTMLButtonElement>('[data-slot="plot-reset"]')
  if (!gridLayer || !axesLayer || !seriesLayer) return

  const rerender = () => {
    const xStep = plotNiceTickStep(xRange[1] - xRange[0])
    const yStep = plotNiceTickStep(yRange[1] - yRange[0])
    const xTicks: number[] = []
    for (let v = Math.ceil(xRange[0] / xStep) * xStep; v <= xRange[1] + xStep / 2; v += xStep) {
      xTicks.push(Number(v.toFixed(10)))
    }
    const yTicks: number[] = []
    for (let v = Math.ceil(yRange[0] / yStep) * yStep; v <= yRange[1] + yStep / 2; v += yStep) {
      yTicks.push(Number(v.toFixed(10)))
    }
    const lines: string[] = []
    if (initial.grid) {
      for (const tx of xTicks) {
        const x = xToPx(tx).toFixed(2)
        lines.push(
          `<line data-slot="plot-grid" x1="${x}" y1="${PAD_T}" x2="${x}" y2="${PAD_T + innerH}" />`,
        )
      }
      for (const ty of yTicks) {
        const y = yToPx(ty).toFixed(2)
        lines.push(
          `<line data-slot="plot-grid" x1="${PAD_L}" y1="${y}" x2="${PAD_L + innerW}" y2="${y}" />`,
        )
      }
    }
    gridLayer.innerHTML = lines.join("")

    const zeroX = xRange[0] <= 0 && xRange[1] >= 0 ? xToPx(0) : null
    const zeroY = yRange[0] <= 0 && yRange[1] >= 0 ? yToPx(0) : null
    const axisX = zeroY ?? PAD_T + innerH
    const axisY = zeroX ?? PAD_L
    const axisHTML: string[] = []
    axisHTML.push(
      `<line data-slot="plot-axis" data-axis="x" x1="${PAD_L}" y1="${axisX.toFixed(2)}" x2="${PAD_L + innerW}" y2="${axisX.toFixed(2)}" />`,
      `<line data-slot="plot-axis" data-axis="y" x1="${axisY.toFixed(2)}" y1="${PAD_T}" x2="${axisY.toFixed(2)}" y2="${PAD_T + innerH}" />`,
    )
    // Tick labels live on the PERIMETER (left edge / bottom edge), never on
    // the axis lines themselves — see renderPlot() for the rationale.
    const labelLeft = PAD_L - 6
    const labelBottom = PAD_T + innerH + 14
    for (const tx of xTicks) {
      if (Math.abs(tx) < 1e-12) continue
      const x = xToPx(tx).toFixed(2)
      axisHTML.push(
        `<text data-slot="plot-tick" data-axis="x" x="${x}" y="${labelBottom.toFixed(2)}">${plotEscape(plotFormatTick(tx))}</text>`,
      )
    }
    for (const ty of yTicks) {
      if (Math.abs(ty) < 1e-12) continue
      const y = yToPx(ty).toFixed(2)
      axisHTML.push(
        `<text data-slot="plot-tick" data-axis="y" x="${labelLeft.toFixed(2)}" y="${(Number(y) + 3).toFixed(2)}">${plotEscape(plotFormatTick(ty))}</text>`,
      )
    }
    if (zeroX !== null && zeroY !== null) {
      axisHTML.push(
        `<text data-slot="plot-tick" data-axis="origin" x="${labelLeft.toFixed(2)}" y="${labelBottom.toFixed(2)}">0</text>`,
      )
    }
    axesLayer.innerHTML = axisHTML.join("")

    const SAMPLES = 600
    const clampY = (y: number) =>
      Math.max(yRange[0] - (yRange[1] - yRange[0]), Math.min(yRange[1] + (yRange[1] - yRange[0]), y))
    const seriesHTML: string[] = []
    initial.series.forEach((s, idx) => {
      const fn = compiled[idx]
      if (s.kind === "fn" && fn) {
        let pen: "M" | "L" = "M"
        let pathD = ""
        for (let i = 0; i <= SAMPLES; i++) {
          const x = xRange[0] + (i / SAMPLES) * (xRange[1] - xRange[0])
          let y: number
          try {
            y = fn(x)
          } catch {
            y = NaN
          }
          if (!Number.isFinite(y)) {
            pen = "M"
            continue
          }
          pathD += `${pen}${xToPx(x).toFixed(2)} ${yToPx(clampY(y)).toFixed(2)} `
          pen = "L"
        }
        const dashAttr = s.dashed ? ` stroke-dasharray="6 4"` : ""
        seriesHTML.push(
          `<path data-slot="plot-series" data-series-kind="fn" data-series-index="${idx}" d="${pathD.trim()}" stroke="${plotEscape(s.color)}" stroke-width="${s.width}"${dashAttr} fill="none" />`,
        )
      } else if (s.kind === "line" && s.data && s.data.length > 0) {
        const pathD = s.data
          .map(([x, y], i) => `${i === 0 ? "M" : "L"}${xToPx(x).toFixed(2)} ${yToPx(y).toFixed(2)}`)
          .join(" ")
        const dashAttr = s.dashed ? ` stroke-dasharray="6 4"` : ""
        seriesHTML.push(
          `<path data-slot="plot-series" data-series-kind="line" data-series-index="${idx}" d="${pathD}" stroke="${plotEscape(s.color)}" stroke-width="${s.width}"${dashAttr} fill="none" />`,
        )
      } else if (s.kind === "points" && s.data && s.data.length > 0) {
        const circles = s.data
          .map(
            ([x, y]) =>
              `<circle cx="${xToPx(x).toFixed(2)}" cy="${yToPx(y).toFixed(2)}" r="3.5" fill="${plotEscape(s.color)}" stroke="var(--surface-base, #fff)" stroke-width="1" />`,
          )
          .join("")
        seriesHTML.push(
          `<g data-slot="plot-series" data-series-kind="points" data-series-index="${idx}">${circles}</g>`,
        )
      }
    })
    seriesLayer.innerHTML = seriesHTML.join("")
  }

  rerender()

  const svgPoint = (clientX: number, clientY: number) => {
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const local = pt.matrixTransform(ctm.inverse())
    return { x: local.x, y: local.y }
  }
  const inBounds = (px: number, py: number) =>
    px >= PAD_L && px <= PAD_L + innerW && py >= PAD_T && py <= PAD_T + innerH

  const showCursorAt = (svgX: number, _svgY: number, dataX: number) => {
    if (!crosshairX || !crosshairY || !cursorDot) return
    crosshairX.setAttribute("x1", String(svgX))
    crosshairX.setAttribute("x2", String(svgX))
    crosshairX.setAttribute("y1", String(PAD_T))
    crosshairX.setAttribute("y2", String(PAD_T + innerH))
    crosshairX.style.visibility = "visible"
    let dotY: number | null = null
    let dotColor: string | null = null
    for (let i = 0; i < initial.series.length; i++) {
      const s = initial.series[i]
      if (s.kind !== "fn") continue
      const fn = compiled[i]
      if (!fn) continue
      const y = fn(dataX)
      if (Number.isFinite(y) && y >= yRange[0] && y <= yRange[1]) {
        dotY = yToPx(y)
        dotColor = s.color
        break
      }
    }
    if (dotY != null && dotColor) {
      cursorDot.setAttribute("cx", String(svgX))
      cursorDot.setAttribute("cy", String(dotY))
      cursorDot.setAttribute("fill", dotColor)
      cursorDot.style.visibility = "visible"
      crosshairY.setAttribute("x1", String(PAD_L))
      crosshairY.setAttribute("x2", String(PAD_L + innerW))
      crosshairY.setAttribute("y1", String(dotY))
      crosshairY.setAttribute("y2", String(dotY))
      crosshairY.style.visibility = "visible"
    } else {
      cursorDot.style.visibility = "hidden"
      crosshairY.style.visibility = "hidden"
    }
    const rows: string[] = [
      `<div data-slot="plot-tooltip-x">x = ${plotFormatTick(dataX)}</div>`,
    ]
    for (let i = 0; i < initial.series.length; i++) {
      const s = initial.series[i]
      if (s.kind !== "fn") continue
      const fn = compiled[i]
      if (!fn) continue
      const y = fn(dataX)
      if (!Number.isFinite(y)) continue
      const label = s.label ?? s.expr ?? "y"
      rows.push(
        `<div data-slot="plot-tooltip-row"><span data-slot="plot-tooltip-dot" style="background:${plotEscape(s.color)}"></span><span>${plotEscape(label)} = ${plotFormatTick(y)}</span></div>`,
      )
    }
    tooltip.innerHTML = rows.join("")
    tooltip.hidden = false
    const blockRect = block.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()
    const ratio = svgRect.width / W
    const offsetX = svgRect.left - blockRect.left + svgX * ratio + 12
    const offsetY = svgRect.top - blockRect.top + (dotY ?? PAD_T + innerH / 2) * ratio - 8
    tooltip.style.left = `${Math.min(offsetX, blockRect.width - 180)}px`
    tooltip.style.top = `${Math.max(8, offsetY)}px`
  }

  const hideCursor = () => {
    if (crosshairX) crosshairX.style.visibility = "hidden"
    if (crosshairY) crosshairY.style.visibility = "hidden"
    if (cursorDot) cursorDot.style.visibility = "hidden"
    tooltip.hidden = true
  }

  let dragging:
    | {
        startClientX: number
        startClientY: number
        startXRange: [number, number]
        startYRange: [number, number]
      }
    | null = null

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    const { x, y } = svgPoint(event.clientX, event.clientY)
    if (!inBounds(x, y)) return
    dragging = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      startXRange: [...xRange],
      startYRange: [...yRange],
    }
    try {
      svg.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    svg.style.cursor = "grabbing"
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      const { x, y } = svgPoint(event.clientX, event.clientY)
      if (!inBounds(x, y)) {
        hideCursor()
        return
      }
      showCursorAt(x, y, pxToX(x))
      return
    }
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const ratioX = (xRange[1] - xRange[0]) / innerW
    const ratioY = (yRange[1] - yRange[0]) / innerH
    const dxSvg = (event.clientX - dragging.startClientX) / ctm.a
    const dySvg = (event.clientY - dragging.startClientY) / ctm.d
    const dxData = -dxSvg * ratioX
    const dyData = dySvg * ratioY
    xRange = [dragging.startXRange[0] + dxData, dragging.startXRange[1] + dxData]
    yRange = [dragging.startYRange[0] + dyData, dragging.startYRange[1] + dyData]
    rerender()
  }

  const onPointerUp = (event: PointerEvent) => {
    if (dragging) {
      try {
        svg.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      dragging = null
      svg.style.cursor = "crosshair"
    }
  }

  // Wheel zoom — modifier-gated and dampened.
  //
  // Two ergonomic problems we used to have:
  //   1. plain wheel-over-plot trapped page scroll: hovering the chart
  //      and trying to scroll the message thread did nothing because we
  //      were eating the wheel event for zoom.
  //   2. when zoom did fire, `factor = 0.85` per tick was way too
  //      aggressive — three notches of a Magic Mouse zoomed by 2×.
  //
  // Now the user has to opt in (Cmd/Ctrl + wheel, or pinch-zoom which
  // browsers report as ctrlKey) to zoom. A bare wheel scroll lets the
  // page scroll normally. The zoom factor is also tuned per device:
  // pixel-based events from trackpads are scaled by their actual delta
  // (so a small scroll = small zoom), with a hard cap to keep one
  // gesture from snapping the chart to a tiny window.
  const onWheel = (event: WheelEvent) => {
    // Only zoom when the user explicitly asks for it: pinch (browsers
    // dispatch it as wheel + ctrlKey) or Cmd/Ctrl + wheel. Otherwise
    // pass through so the message thread keeps scrolling.
    if (!event.ctrlKey && !event.metaKey) return
    const { x, y } = svgPoint(event.clientX, event.clientY)
    if (!inBounds(x, y)) return
    event.preventDefault()
    // Dampened, delta-aware factor:
    //   * line-mode (deltaMode 1) = mouse wheel detents, ~3 lines/tick
    //     → ~1.05 per tick
    //   * pixel-mode (deltaMode 0) = trackpad pixels, fine increments
    //     → ~0.5% per pixel, clamped so any single dispatch stays gentle
    let factor: number
    if (event.deltaMode === 1) {
      factor = Math.pow(1.05, Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 4))
    } else {
      const pxFactor = Math.exp(event.deltaY * 0.0035)
      factor = Math.max(0.85, Math.min(1.18, pxFactor))
    }
    const cx = pxToX(x)
    const cy = yRange[0] + (1 - (y - PAD_T) / innerH) * (yRange[1] - yRange[0])
    xRange = [cx - (cx - xRange[0]) * factor, cx + (xRange[1] - cx) * factor]
    yRange = [cy - (cy - yRange[0]) * factor, cy + (yRange[1] - cy) * factor]
    rerender()
    showCursorAt(x, y, pxToX(x))
  }

  const onLeave = () => {
    hideCursor()
  }

  const onReset = () => {
    xRange = [...initial.xRange]
    yRange = [...initial.yRange]
    rerender()
  }

  svg.addEventListener("pointerdown", onPointerDown)
  svg.addEventListener("pointermove", onPointerMove)
  svg.addEventListener("pointerup", onPointerUp)
  svg.addEventListener("pointerleave", onLeave)
  svg.addEventListener("wheel", onWheel, { passive: false })
  if (resetBtn) resetBtn.addEventListener("click", onReset)

  return () => {
    svg.removeEventListener("pointerdown", onPointerDown)
    svg.removeEventListener("pointermove", onPointerMove)
    svg.removeEventListener("pointerup", onPointerUp)
    svg.removeEventListener("pointerleave", onLeave)
    svg.removeEventListener("wheel", onWheel)
    if (resetBtn) resetBtn.removeEventListener("click", onReset)
  }
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
  let richBlockCleanup: (() => void) | undefined
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
            fromEl.getAttribute("data-component") === "markdown-block" &&
            toEl.getAttribute("data-component") === "markdown-block" &&
            fromEl.dataset.blockHash &&
            fromEl.dataset.blockHash === toEl.dataset.blockHash
          ) {
            // Block source unchanged — keep current DOM (and any interactive
            // state inside it) instead of re-rendering.
            return false
          }
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
    if (!richBlockCleanup) richBlockCleanup = setupRichBlocks(container)
  })

  onCleanup(() => {
    if (copyCleanup) copyCleanup()
    if (fileReferenceCleanup) fileReferenceCleanup()
    if (richBlockCleanup) richBlockCleanup()
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
