/**
 * Chat — a ChatGPT-style multi-session chat surface, built to feel native to
 * codeplane.
 *
 * Layout: a single-column main pane (no inner sidebar — the layout already
 * provides one), with a slim header strip exposing Sessions, Files, Memory,
 * and a "New chat" action; the composer is docked at the bottom inside the
 * shared `DockShellForm` so it has the same visual treatment as the
 * in-session prompt input, with a model selector pill on the bottom-left.
 *
 * Each session has its own per-session "filesystem" (virtual files scoped to
 * that conversation) and shares a list of MEMORY entries that every session's
 * system prompt sees. Memory is split into individually-editable entries
 * (rather than one free-form blob) so the user can keep, prune, or rewrite
 * pieces of long-term context independently. State persists client-side via
 * localStorage so it survives reloads, and the loader migrates the previous
 * `memory: string` schema into the entry list on first read.
 *
 * History note: an earlier version rendered its own left sidebar with
 * sessions and a memory drawer, which sat next to the layout's outer
 * workspace sidebar — two sidebars in one viewport. The chat surface now
 * collapses everything to a single column and exposes session navigation
 * via a header popover; the inline files strip and memory drawer are
 * promoted to dialogs so the thread doesn't have to give up vertical
 * space when those panels open.
 */
import { type Component, createEffect, createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { Button } from "@codeplane-ai/ui/button"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Mark } from "@codeplane-ai/ui/logo"
import { Markdown } from "@codeplane-ai/ui/markdown"
import { Popover } from "@codeplane-ai/ui/popover"
import { ProviderIcon } from "@codeplane-ai/ui/provider-icon"
import { Spinner } from "@codeplane-ai/ui/spinner"
import { TextField } from "@codeplane-ai/ui/text-field"
import { Tooltip } from "@codeplane-ai/ui/tooltip"
import { showToast } from "@codeplane-ai/ui/toast"
import { DockShellForm, DockTray } from "@codeplane-ai/ui/dock-surface"
import {
  useChat,
  type ChatFile as CtxChatFile,
  type ChatMessage as CtxChatMessage,
  type ChatSession as CtxChatSession,
  type MemoryEntry as CtxMemoryEntry,
} from "@/context/chat"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLiveActivity } from "@/context/live-activity"
import { useProviders } from "@/hooks/use-providers"
import { marked } from "marked"

// Re-exports of the context types — keeps the rest of the file readable.
type ChatFile = CtxChatFile
type ChatMessage = CtxChatMessage
type ChatSession = CtxChatSession
type MemoryEntry = CtxMemoryEntry

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function deriveTitle(text: string): string {
  const trimmed = text.trim().split("\n")[0] ?? ""
  if (trimmed.length <= 60) return trimmed || "New chat"
  return `${trimmed.slice(0, 57)}…`
}

/**
 * The chat surface deliberately disables:
 *  - project-oriented tools that read the user's CODEBASE (`grep`, `glob`,
 *    `codesearch`, `git`, `forge`, `project`) — chat is not a coding session
 *  - SHELL access (`bash`, `bash_interactive`, `ssh`, `apply_patch`) — chat
 *    runs against an isolated scratch directory; arbitrary shell would
 *    break that isolation and is rarely needed for casual answers
 *  - INTERACTIVE tools that pop their own UI (`question`, `task`,
 *    `file-tree`) — in chat mode the agent should ask inline in plain text
 *    like ChatGPT, not open a separate dialog
 *
 * What's ENABLED on top of the codeplane defaults:
 *  - `read`, `write`, `edit`, `list` — the agent can create artefacts
 *    (Markdown notes, HTML reports, CSVs) inside the session's scratch
 *    directory. Those are what surface as file cards in the thread + the
 *    Files dialog, and the user can preview / download them.
 *  - Visual tools (chart, kpi, table, callout, timeline, …) and web tools
 *    (webfetch, browse, websearch, skill) — for rich answers and research.
 *
 * The `tools` field on `session.promptAsync` is `{ toolID: enabled }`;
 * anything not listed inherits the default. We explicitly deny the tools
 * we don't want even if the model decides to reach for them, and we
 * explicitly enable the file-write group (some defaults disable them).
 */
const CHAT_DISABLED_TOOLS: Record<string, boolean> = {
  // Shell / process — too dangerous for a chat scratch dir, rarely useful
  // for the conversational scenarios this surface is built for.
  bash: false,
  bash_interactive: false,
  ssh: false,
  // Codebase exploration — chat is not a coding session.
  glob: false,
  grep: false,
  git: false,
  forge: false,
  apply_patch: false,
  codesearch: false,
  project: false,
  todowrite: false,
  // Interactive — chat mode handles these inline as text.
  question: false,
  task: false,
  // Codeplane file-tree popup; we have our own files dialog.
  "file-tree": false,
  // File I/O — explicitly ENABLED so the agent can produce artefacts the
  // user can download / preview from the chat thread.
  read: true,
  write: true,
  edit: true,
  list: true,
}

/**
 * Build the chat-specific system prompt. Includes:
 *  - the role + tone
 *  - markdown / mermaid / table rendering directives
 *  - shared memory + per-session files context
 *  - the `<memory title="…">…</memory>` save directive so the model can
 *    persist things the user asks it to remember
 */
function buildChatSystemPrompt(input: {
  memory: { title: string; content: string }[]
  files: { name: string; content: string }[]
  fallbackMemoryTitle: string
}): string {
  const memoryContext = input.memory
    .filter((m) => m.content.trim())
    .map((m) => `[${(m.title.trim() || input.fallbackMemoryTitle)}]\n${m.content.trim()}`)
    .join("\n\n")
  const filesContext = input.files
    .map((f) => `--- file: ${f.name} ---\n${f.content}`)
    .join("\n\n")

  const sections: string[] = []
  sections.push(
    [
      "You are Codeplane Chat — a focused conversational assistant. This is NOT a coding session: you don't have access to the user's codebase, shell, or filesystem. Treat this as a friendly, capable chat that excels at thinking, writing, planning, summarising, and rich visual answers.",
      "",
      "Style:",
      "- Be warm, direct, and concise. Skip filler like \"Sure!\" / \"Of course!\".",
      "- Match the user's language (reply in German if they write German, etc.).",
      "- When useful, structure with headings, bullet lists, and tables.",
      "",
      "Rich rendering — use these freely when they help:",
      "- **Mermaid diagrams** for flowcharts, sequence, state, ER, gantt, mindmap, pie, timeline, journey, sankey, etc. ALWAYS tag the fence as `mermaid` and put the diagram type on the FIRST line of the body. Example for a mindmap:",
      "  ```mermaid",
      "  mindmap",
      "    root((Topic))",
      "      Branch A",
      "      Branch B",
      "  ```",
      "  Never tag the fence as `mindmap`/`flowchart`/`gantt`/etc. — only `mermaid`.",
      "- **Interactive coordinate systems** for math / physics / data: use a `plot` (or `graph`) fenced block with JSON. The user can pan, zoom, and hover for exact (x, y) values — so this is the right tool whenever they ask about a function, an inequality, a curve family, the intersection of curves, geometry sketches, or labelled data points.",
      "  Schema:",
      "  ```plot",
      "  {",
      "    \"title\": \"Sin and cosine\",",
      "    \"xRange\": [-6.28, 6.28],",
      "    \"yRange\": [-1.2, 1.2],",
      "    \"axisLabels\": [\"x\", \"y\"],",
      "    \"series\": [",
      "      { \"kind\": \"fn\",     \"expr\": \"sin(x)\",  \"color\": \"#5b8def\", \"label\": \"sin(x)\" },",
      "      { \"kind\": \"fn\",     \"expr\": \"cos(x)\",  \"color\": \"#ef6b56\", \"label\": \"cos(x)\", \"dashed\": true },",
      "      { \"kind\": \"points\", \"data\": [[0, 0], [3.14, 0]], \"color\": \"#5cc4a3\", \"label\": \"Roots\" },",
      "      { \"kind\": \"line\",   \"data\": [[-1,-1],[2,3]],     \"color\": \"#f5a35a\", \"label\": \"Tangent\" }",
      "    ]",
      "  }",
      "  ```",
      "  Series kinds: `fn` (math expression in `x`), `points` (scatter), `line` (polyline through data).",
      "  Expressions can use `+ - * / ^` and `sin cos tan asin acos atan sinh cosh tanh exp log log2 log10 sqrt cbrt abs sign floor ceil round pow min max hypot PI E pi e`. The variable is `x`. Examples: `x^2`, `sin(x)/x`, `2*sqrt(x)+1`, `exp(-x^2)`. NO summation symbols, no implicit multiplication — write everything as standard JS-like expressions.",
      "  `xRange` is REQUIRED. `yRange` is OPTIONAL — if you OMIT it, the renderer auto-fits to the data with a 10% margin (this is usually what you want). Only set `yRange` explicitly if you need a specific zoom (e.g. \"clip y to [-2, 2] so the asymptote near 0 doesn't dominate\"). NEVER guess huge `yRange` values like `[-1e23, 1e24]`.",
      "- **GitHub-flavored Markdown tables** for comparisons.",
      "- **Code blocks** with the right language tag for syntax highlighting.",
      "- **Math** with `$inline$` and `$$display$$` (KaTeX).",
      "- **Maps** by linking to OpenStreetMap or Google Maps with the place name.",
      "- **Images** when you have a real URL — never invent broken image links.",
      "- **PDFs / files**: see the Tools section below — write a Markdown or HTML file with the `write` tool and the user can hit 'Download as PDF' on the file card.",
      "",
      "Memory tool (`save_to_memory`) — your decision, not a reflex:",
      "You have a `save_to_memory` tool that adds an entry to the user's long-term memory store. The current store is shown at the top of every chat in the `# Long-term memory` section. Calling the tool is your decision — DO NOT save things just because the user mentioned them; SAVE only what's genuinely worth remembering across future chats.",
      "",
      "How to call the tool: at the END of your reply, on its own line, emit",
      '  <memory title="Short descriptive title">Full content, third person about the user.</memory>',
      "Each `<memory …>` block is one tool call. The user sees an inline tool-call card with a Forget button — they can undo it. Multiple blocks = multiple saves.",
      "",
      "DECISION CHECKLIST — only call `save_to_memory` when ALL are true:",
      "  1. The fact is about the USER (preferences, identity, ongoing context, name, relationships, recurring projects, dietary restrictions, accessibility needs, communication style).",
      "  2. It is likely to be USEFUL ACROSS MULTIPLE FUTURE CHATS, not just this one.",
      "  3. The user EXPLICITLY asked to save/remember it (\"remember\", \"don't forget\", \"merk dir\", \"speichere\", etc.) OR the user clearly stated a stable preference about themselves that future-you would want to know.",
      "",
      "Do NOT save when:",
      "  - The user is just having a conversation and happens to share a fact (\"I'm visiting Paris next week\" → no save unless they ask).",
      "  - The information is transient (\"running late today\", \"can't sleep\").",
      "  - The fact is already in the long-term memory section — don't duplicate.",
      "  - It's a request for action this turn (\"summarise this article\") rather than a fact.",
      "  - You're unsure — when in doubt, ASK the user \"Want me to remember that?\" instead of saving.",
      "",
      "Format examples:",
      'User: "remember my favorite color is teal"',
      'You: "Got it — I\'ll keep that in mind.\\n<memory title=\"Favorite color\">The user\'s favorite color is teal.</memory>"',
      "",
      'User: "merk dir bitte dass ich Vegetarier bin"',
      'You: "Klar — merke ich mir.\\n<memory title=\"Diet\">The user is vegetarian.</memory>"',
      "",
      'User: "I\'m flying to Tokyo on Friday"',
      'You: "Have a great trip! Want me to remember anything specific (e.g. that you visit Tokyo regularly)?"  // NO save — transient + not asked',
      "",
      'User: "I always prefer concise replies"',
      'You: "Noted — I\'ll keep my replies concise from now on.\\n<memory title=\"Communication style\">The user prefers concise replies.</memory>"  // YES save — stable preference',
      "",
      "Tools:",
      "- You have an isolated SCRATCH DIRECTORY for THIS chat session. Use `write` to produce artefacts (Markdown notes, HTML reports, CSVs, JSON, simple SVGs) the user can download. Filenames should be descriptive and end with the right extension (`itinerary.md`, `report.html`, `expenses.csv`).",
      "- Use `read`/`edit`/`list` to revise files you've created in the same chat. NEVER try to read paths outside the scratch dir — the codebase is not available here.",
      "- After writing a file, mention it briefly in plain text (e.g. \"I've saved the itinerary as `paris.md` — you can preview it from the file card.\"). Don't paste the full content back if it's already in the file.",
      "",
      "PDFs — you CAN produce them, and they should look genuinely good:",
      "- Every text-based artefact has a 'Download as PDF' button. Workflow: WRITE the file (`.md` or `.html`), then tell the user one line about the PDF button. NEVER refuse, NEVER say PDFs aren't possible. NEVER try to write `.pdf` directly — you can't emit binary.",
      "- Pick the format by the design ambition:",
      "  - **`.md` → PDF**: best for long-form content (essays, study notes, recipes, basic reports). Use `#` headings, lists, tables, code fences. Print stylesheet handles typography automatically.",
      "  - **`.html` → PDF**: best when you want LAYOUT and DESIGN — cover pages, sidebars, KPI tiles, two-column reports, certificates, invoices, posters, résumés. The print stylesheet ships a design system you can opt into.",
      "",
      "PDF design system (for `.html` files) — these utility classes are PRE-STYLED in the print pipeline. Just use them; do not redefine them.",
      "  Typography: standard semantic tags (`h1`/`h2`/`h3`/`p`/`ul`/`ol`/`blockquote`) all look polished out of the box.",
      "  Layout: `<div class=\"pdf-grid pdf-grid-2\">` (two equal cols) / `pdf-grid-3` / `pdf-grid-4`. Span with `pdf-col-span-2` or `pdf-col-span-3`.",
      "  Cards: `<div class=\"pdf-card\">…</div>` (bordered) — add `pdf-card-accent` for a coloured left strip. Use `<div class=\"pdf-card-title\">…</div>` and `pdf-card-subtitle` inside.",
      "  Cover page: `<section class=\"pdf-cover\"><div class=\"pdf-eyebrow\">REPORT</div><h1>Title</h1><div class=\"pdf-subtitle\">…</div><div class=\"pdf-meta\">Date · Author · Confidential</div></section>` — followed by `<div class=\"pdf-page-break\"></div>` to start chapter 1 on a fresh page.",
      "  Section header: `<header class=\"pdf-section-header\"><div class=\"pdf-eyebrow\">Chapter 02</div><h2>Findings</h2></header>` — accent strip + eyebrow.",
      "  KPI tiles: `<div class=\"pdf-kpi\"><div class=\"pdf-kpi-value\">€42.1M</div><div class=\"pdf-kpi-label\">Revenue Q3</div></div>`. Combine with `pdf-grid pdf-grid-3` for a row.",
      "  Callouts: `<div class=\"pdf-callout pdf-callout-info\"><div class=\"pdf-callout-title\">Note</div>Body…</div>` — variants: `-info`, `-success`, `-warning`, `-danger`, `-note`.",
      "  Badges: `<span class=\"pdf-badge\">DRAFT</span>` — small pill of metadata.",
      "  Signatures: `<div class=\"pdf-signature\"><div class=\"pdf-signature-line\">Signed</div><div class=\"pdf-signature-line\">Date</div></div>` — two side-by-side signature slots.",
      "  Page control: `pdf-page-break` (force new page before), `pdf-page-break-after`, `pdf-keep-together` (don't split inside), `pdf-no-print` (omit on print).",
      "  Theming: set `:root { --pdf-accent: #...; --pdf-accent-soft: #...; }` inside a `<style>` tag at the top of the HTML to retheme the document. Other variables: `--pdf-text`, `--pdf-text-muted`, `--pdf-border`, `--pdf-surface`, `--pdf-surface-soft`.",
      "  Page size / orientation: override `@page { size: A4 landscape; margin: 12mm; }` at the top in a `<style>` tag if you want a different layout. Defaults to A4 portrait, 18mm margins.",
      "",
      "Example: a small but polished one-page report (`.html`):",
      '  <section class="pdf-cover">',
      '    <div class="pdf-eyebrow">QUARTERLY UPDATE</div>',
      '    <h1>2025 in review</h1>',
      '    <div class="pdf-subtitle">A short, honest look at how the year went.</div>',
      '    <div class="pdf-meta">January 2026 · Prepared by the team</div>',
      '  </section>',
      '  <div class="pdf-page-break"></div>',
      '  <header class="pdf-section-header"><div class="pdf-eyebrow">Highlights</div><h2>What worked</h2></header>',
      '  <div class="pdf-grid pdf-grid-3">',
      '    <div class="pdf-kpi"><div class="pdf-kpi-value">+18%</div><div class="pdf-kpi-label">Revenue</div></div>',
      '    <div class="pdf-kpi"><div class="pdf-kpi-value">93</div><div class="pdf-kpi-label">NPS</div></div>',
      '    <div class="pdf-kpi"><div class="pdf-kpi-value">7</div><div class="pdf-kpi-label">Markets</div></div>',
      '  </div>',
      '  <div class="pdf-callout pdf-callout-success"><div class="pdf-callout-title">Wins</div>Three product launches shipped on schedule.</div>',
      "",
      "After writing, give the user one line: \"Saved as `report.html` — click the PDF button on the file card to export.\"",
      "",
      "- The shell, codebase exploration, git tools are disabled.",
      "- Web search and browsing are available if you genuinely need them; otherwise answer from your own knowledge.",
      "",
      "Asking the user questions:",
      "- This is a CHAT surface — when you need clarification or more info, just ASK in plain text like a normal conversation. Don't call any `question` / form / dialog tool — those are disabled here and would feel jarring like a popup.",
      "- The user replies in the next message, just like ChatGPT.",
      "- Same for confirmations: ask in plain English (\"Want me to go ahead with X?\") and wait for their next message.",
    ].join("\n"),
  )
  if (memoryContext) {
    sections.push(`# Long-term memory (the user has saved these across all chats)\n${memoryContext}`)
  }
  if (filesContext) {
    sections.push(`# Files attached to this chat\n${filesContext}`)
  }
  return sections.join("\n\n")
}

/**
 * Mermaid-diagram type names that some models emit as the FENCE LANGUAGE
 * (` ```mindmap `) instead of wrapping the body inside a `mermaid` block.
 * The shared `<Markdown>` component only treats `mermaid` (case-insensitive)
 * as a diagram; anything else is rendered as a plain code block. To make
 * the chat surface forgiving of model variation, retag those fences as
 * `mermaid` before handing the text to the renderer.
 *
 * The list mirrors the diagram-type kinds documented in mermaid 11. We
 * also match camelCase and dash-case variants. Order doesn't matter — we
 * only check membership.
 */
const MERMAID_DIAGRAM_LANGS = new Set(
  [
    "mindmap",
    "flowchart",
    "graph",
    "sequencediagram",
    "sequence-diagram",
    "classdiagram",
    "class-diagram",
    "statediagram",
    "state-diagram",
    "statediagram-v2",
    "erdiagram",
    "er-diagram",
    "journey",
    "userjourney",
    "user-journey",
    "gantt",
    "pie",
    "quadrantchart",
    "quadrant-chart",
    "requirementdiagram",
    "requirement-diagram",
    "gitgraph",
    "git-graph",
    "c4context",
    "c4-context",
    "c4container",
    "c4-container",
    "c4component",
    "c4-component",
    "c4dynamic",
    "c4-dynamic",
    "c4deployment",
    "c4-deployment",
    "timeline",
    "sankey",
    "sankey-beta",
    "xychart",
    "xychart-beta",
    "block",
    "block-beta",
    "packet",
    "packet-beta",
    "kanban",
    "architecture",
    "architecture-beta",
  ].map((name) => name.toLowerCase()),
)

/**
 * Retag fenced code blocks whose language is a Mermaid diagram type with
 * `mermaid`. Idempotent — won't re-tag a block that's already `mermaid`.
 *
 * Matches both ``` ``` ``` and ``` ~~~ ``` fences. Uses non-greedy
 * `[\s\S]*?` so multiple blocks in a row are handled independently.
 */
function coerceMermaidLanguage(text: string): string {
  if (!text.includes("```") && !text.includes("~~~")) return text
  return text.replace(
    /(^|\n)([ \t]*)(```|~~~)([^\s`~]+)(\s*)\n([\s\S]*?)\n[ \t]*\3([ \t]*(?=\n|$))/g,
    (full, lead: string, indent: string, fence: string, lang: string, langTail: string, body: string, fenceTail: string) => {
      const key = lang.trim().toLowerCase()
      if (!MERMAID_DIAGRAM_LANGS.has(key)) return full
      // Leave any meta tokens alone — `langTail` may contain `{ ... }`.
      const meta = langTail
      // Inject the original language as the FIRST line of the body so the
      // mermaid parser sees `mindmap` (or whichever) at the top.
      const newBody = `${lang.trim()}\n${body}`
      return `${lead}${indent}${fence}mermaid${meta}\n${newBody}\n${indent}${fence}${fenceTail}`
    },
  )
}

/**
 * Parse `<memory title="…">…</memory>` blocks out of an assistant response.
 * Returns the entries we should add and the cleaned text (with the blocks
 * removed) so the response itself doesn't show the raw directive.
 */
function extractMemoryDirectives(text: string): {
  entries: Array<{ title: string; content: string }>
  cleaned: string
} {
  const re = /<memory(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/memory>/gi
  const entries: Array<{ title: string; content: string }> = []
  let cleaned = text
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const title = (match[1] ?? "").trim()
    const content = (match[2] ?? "").trim()
    if (content) entries.push({ title, content })
  }
  if (entries.length > 0) cleaned = text.replace(re, "").trim()
  return { entries, cleaned }
}

/**
 * Split an assistant reply into ordered segments for rendering. Text runs
 * become regular Markdown blocks; each `<memory>` block becomes a "saved
 * to memory" card so the user sees what was persisted inline (instead of
 * a transient toast).
 */
type AssistantSegment =
  | { kind: "text"; text: string }
  | { kind: "memory"; title: string; content: string }

function parseAssistantSegments(raw: string): AssistantSegment[] {
  const re = /<memory(?:\s+title="([^"]*)")?\s*>([\s\S]*?)<\/memory>/gi
  const segments: AssistantSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    const before = raw.slice(cursor, match.index).trim()
    if (before) segments.push({ kind: "text", text: before })
    const title = (match[1] ?? "").trim()
    const content = (match[2] ?? "").trim()
    if (content) segments.push({ kind: "memory", title, content })
    cursor = match.index + match[0].length
  }
  const tail = raw.slice(cursor).trim()
  if (tail) segments.push({ kind: "text", text: tail })
  if (segments.length === 0 && raw.trim()) {
    segments.push({ kind: "text", text: raw })
  }
  return segments
}

const ChatPage: Component = () => {
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  // The chat data store now lives in `ChatProvider` (so the layout's
  // sidebar panel sees the same state). We pull `store` and the mutation
  // helpers from the context.
  const chat = useChat()
  const store = chat.store
  // Live Activity bridge — only renders the toggle when the host is a
  // mobile shell that can actually surface activities (iOS 16.2+).
  const liveActivity = useLiveActivity()

  const activeID = createMemo(() => params.id)
  const active = createMemo(() => store.sessions.find((s) => s.id === activeID()))
  const sortedSessions = chat.sortedSessions

  /**
   * Root directory for ALL chat-session scratch dirs. Each session lives
   * in `<chatRoot>/<localID>/` so that:
   *  - File writes by the agent are SCOPED to that one chat (no leakage
   *    between sessions sharing a parent dir).
   *  - The hidden `.codeplane-chats` segment keeps these out of the user's
   *    project sidebar — `isChatSurfaceSession` in `helpers.ts` matches
   *    that segment to filter them out, even if `~` is open as a project.
   */
  const chatRoot = createMemo(() => {
    const home = globalSync.data.path.home
    if (!home) return ""
    return `${home.replace(/\/+$/, "")}/.codeplane-chats`
  })

  /**
   * Per-session scratch directory. We slice the local UUID to keep paths
   * tidy on disk; collisions are astronomically unlikely (8 hex chars =
   * 32 bits, and the file isolation only needs to be safe within a single
   * user's chat history).
   */
  const sessionDirectory = (localID: string) => {
    const root = chatRoot()
    if (!root) return ""
    const slug = localID.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || localID
    return `${root}/${slug}`
  }

  /**
   * We surface `globalSync.child(directory).message[backendID]` directly so
   * streaming events (`message.part.delta`, `message.part.updated`) update
   * the UI letter-by-letter — no polling. The `loadBackendMessages` helper
   * seeds the child store on initial navigation; everything after streams.
   *
   * The chat session lives in `~/.codeplane-chats`, which IS a registered
   * directory in globalSync (because we call `globalSync.child(directory)`
   * after creating the backend session), so the global event listener
   * applies events for it just like for a project.
   */
  type RenderToolPart = {
    type: "tool"
    id: string
    tool: string
    state?: {
      status?: string
      input?: unknown
      output?: unknown
      error?: string
      title?: string
    }
  }
  type RenderTextPart = {
    type: "text"
    id: string
    text: string
  }
  type RenderPart = RenderTextPart | RenderToolPart
  type RenderMessage = {
    id: string
    role: "user" | "assistant"
    /** Concatenated text (used for memory parsing + clipboard). */
    text: string
    /** Raw text before `<memory>` blocks were stripped. */
    raw?: string
    /**
     * The full ordered part list (text + tool calls) so the assistant turn
     * can render tool invocations inline (chart, table, kpi, …) instead of
     * dropping them.
     */
    parts: RenderPart[]
  }

  /**
   * Track which assistant message IDs we've already parsed memory from.
   * Initialised from the persisted memory's `sourceMessageID` so a fresh
   * page load doesn't re-save existing entries. This is a *non-reactive*
   * mutable Set: it's the synchronous source of truth that prevents two
   * parallel `loadBackendMessages` calls from both saving the same memory
   * (which used to happen because reading the reactive store didn't see
   * the other call's pending `setStore`).
   */
  const seenMemoryMessages = new Set<string>(
    store.memory.map((m) => m.sourceMessageID).filter((id): id is string => !!id),
  )

  const backendMessages = createMemo<RenderMessage[]>(() => {
    const session = active()
    if (!session?.backendID || !session?.directory) return []
    const [child] = globalSync.child(session.directory)
    const messages = child.message[session.backendID] ?? []
    return messages.map((m) => {
      const raw = (child.part[m.id] ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { text?: string }).text ?? "")
        .join("")
      // Build the ordered part list — keep text + tool, drop the
      // codeplane-internal ones (`step-start` / `step-finish`).
      const renderParts: RenderPart[] = []
      for (const p of child.part[m.id] ?? []) {
        if (p.type === "text") {
          renderParts.push({
            type: "text",
            id: p.id ?? "",
            text: (p as { text?: string }).text ?? "",
          })
        } else if (p.type === "tool") {
          const tp = p as {
            id?: string
            tool?: string
            state?: {
              status?: string
              input?: unknown
              output?: unknown
              error?: string
              title?: string
            }
          }
          if (!tp.tool) continue
          renderParts.push({
            type: "tool",
            id: tp.id ?? "",
            tool: tp.tool,
            state: tp.state,
          })
        }
      }
      return {
        id: m.id,
        role: m.role,
        text: raw,
        raw,
        parts: renderParts,
      }
    })
  })

  /**
   * Seed `globalSync.child(directory)` with the session's existing
   * messages via a SDK fetch. Live updates AFTER this come over WebSocket
   * events and update the same reactive store — that's how text streams
   * letter-by-letter without polling.
   */
  const loadBackendMessages = async (directory: string, sessionID: string) => {
    try {
      const res = await globalSDK.client.session.messages({
        directory,
        sessionID,
        limit: 200,
      })
      const items = ((res as { data?: unknown[] }).data ?? []) as Array<{
        info?: { id: string; role: "user" | "assistant" }
        parts?: Array<unknown>
      }>
      const valid = items.filter((x) => !!x?.info?.id)
      // Sort chronologically by ULID id (codeplane uses ascending ULIDs).
      const sorted = valid.slice().sort((a, b) => a.info!.id.localeCompare(b.info!.id))

      // Apply to globalSync's child store. Type-erased writes — the event
      // reducer is what validates the schema when streaming events arrive.
      const [, setStoreUntyped] = globalSync.child(directory)
      const setStore = setStoreUntyped as unknown as (...args: unknown[]) => void
      setStore("message", sessionID, sorted.map((x) => x.info as unknown))
      for (const item of sorted) {
        setStore("part", item.info!.id, (item.parts ?? []) as unknown[])
      }

      // Reconstruct a `RenderMessage[]` here only for memory parsing; the
      // UI reads directly from globalSync now.
      const rendered = sorted.map((x) => {
        const allParts = (x.parts ?? []) as Array<{ type: string; text?: string }>
        const text = allParts
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("")
        return {
          id: x.info!.id,
          role: x.info!.role,
          raw: text,
        }
      })

      // Persist any memory directives the assistant emitted that we
      // haven't already saved. Three-layer dedup:
      //  1. `seenMemoryMessages` — synchronous Set, the primary check.
      //  2. `alreadySaved` (sourceMessageID) — survives reloads.
      //  3. content+title hash — fallback for legacy entries without IDs.
      // The directive is also rendered INLINE in the assistant message
      // (see `renderAssistantText`), so we don't show a toast.
      const alreadySaved = new Set(
        store.memory.map((m) => m.sourceMessageID).filter((id): id is string => !!id),
      )
      const dupKey = (title: string, content: string) =>
        `${title.trim().toLowerCase()} ${content.trim()}`
      const existingContent = new Set(
        store.memory.map((m) => dupKey(m.title, m.content)),
      )
      const newEntries: Array<{ title: string; content: string; sourceMessageID: string }> = []
      for (const m of rendered) {
        if (m.role !== "assistant" || !m.raw) continue
        if (alreadySaved.has(m.id)) continue
        if (seenMemoryMessages.has(m.id)) continue
        // Mark synchronously so a parallel loadBackendMessages call skips it.
        seenMemoryMessages.add(m.id)
        const { entries } = extractMemoryDirectives(m.raw)
        for (const entry of entries) {
          const titleSafe = (entry.title || language.t("chat.memory.entryUntitled")).trim()
          const k = dupKey(titleSafe, entry.content)
          if (existingContent.has(k)) continue
          existingContent.add(k)
          newEntries.push({
            title: titleSafe,
            content: entry.content,
            sourceMessageID: m.id,
          })
        }
      }
      if (newEntries.length > 0) {
        const now = Date.now()
        for (const entry of newEntries) {
          chat.addMemoryEntry({
            title: entry.title,
            content: entry.content,
            sourceMessageID: entry.sourceMessageID,
          })
        }
        // The variable `now` was used for batch timestamping; addMemoryEntry
        // sets its own. Reference it to keep the loop signature stable.
        void now
      }
    } catch {
      // best-effort
    }
  }

  /**
   * Whenever the active session has a backendID, fetch its messages.
   * Whenever the active session has a backendID, register the directory
   * with globalSync (so WebSocket events for it are NOT dropped) and seed
   * the messages once. After this, streaming deltas update the same
   * reactive store letter-by-letter.
   */
  createEffect(() => {
    const session = active()
    if (!session?.backendID || !session?.directory) return
    globalSync.child(session.directory)
    void loadBackendMessages(session.directory, session.backendID)
  })

  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)
  /**
   * Optimistic copy of the most recently sent user message — rendered as
   * a "pending" bubble inside the thread until the real user message
   * echoes back from the codeplane backend via globalSync.
   *
   * `pendingPosition` is the index where the bubble is INSERTED into the
   * rendered message list. We snapshot it at send time as
   * `backendMessages().length` so new messages (especially the assistant
   * reply, which often streams in BEFORE the user message echoes back
   * over WS) land AFTER the bubble — i.e. below it visually. Without
   * this, the order is `[assistant_streaming, optimistic_user]` and the
   * answer appears above the user's own prompt.
   *
   * The bubble is cleared by a reconciling effect that watches
   * `backendMessages()` for a user-role message whose text matches.
   */
  const [pendingUserText, setPendingUserText] = createSignal<string | undefined>()
  const [pendingPosition, setPendingPosition] = createSignal(0)
  /**
   * Model the user picked from the composer pill while there's no active
   * session yet (e.g. on the empty `/chat` route). Used as the model for
   * the lazy-created session on first send.
   */
  const [draftModel, setDraftModel] = createSignal<
    { providerID: string; modelID: string } | undefined
  >()
  let composerRef: HTMLTextAreaElement | undefined
  /**
   * Scrollable thread container — used to auto-stick to the bottom while
   * the assistant is streaming, similar to ChatGPT. We only stick if the
   * user is already close to the bottom (within 64px); if they scrolled
   * up to read history, we DON'T yank them back down on every delta.
   */
  let threadScrollRef: HTMLDivElement | undefined
  /** Whether the thread is currently pinned to the bottom. */
  const [stuckToBottom, setStuckToBottom] = createSignal(true)
  const STICK_THRESHOLD_PX = 64

  const computeStuck = () => {
    const el = threadScrollRef
    if (!el) return true
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight)
    return distance <= STICK_THRESHOLD_PX
  }
  const onThreadScroll = () => {
    setStuckToBottom(computeStuck())
  }
  const scrollThreadToBottom = (smooth = false) => {
    const el = threadScrollRef
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" })
  }
  /**
   * Total characters across all rendered parts of the active session — when
   * this changes (every streaming delta), we re-stick to the bottom IF the
   * user was already near it. We watch a SCALAR so SolidJS sees a clean
   * dependency and the effect runs on every delta.
   */
  const threadLengthSignature = createMemo(() => {
    let total = 0
    for (const m of backendMessages()) total += m.text.length
    return `${backendMessages().length}:${total}`
  })
  createEffect(() => {
    threadLengthSignature() // track
    if (!stuckToBottom()) return
    // Use rAF so the scroll happens after the new DOM has been laid out.
    requestAnimationFrame(() => scrollThreadToBottom())
  })
  // When the active session changes, jump to the bottom unconditionally so
  // opening a chat starts at the latest message. Also drop any pending
  // user bubble that belonged to a different session.
  createEffect(() => {
    activeID()
    setPendingUserText(undefined)
    requestAnimationFrame(() => {
      setStuckToBottom(true)
      scrollThreadToBottom()
    })
  })

  // Reconcile the pending user bubble: as soon as the real backend
  // message echoes back with matching text, drop the optimistic copy so
  // we don't render the same prompt twice. We compare on trimmed
  // contents because the backend can rewrap whitespace.
  createEffect(() => {
    const pending = pendingUserText()
    if (pending === undefined) return
    const real = backendMessages().find(
      (m) => m.role === "user" && m.text.trim() === pending.trim(),
    )
    if (real) setPendingUserText(undefined)
  })

  /**
   * Sync the composer's height with its content. Empty value clears the inline
   * style so the `min-h-[3.5rem]` Tailwind class takes over; otherwise grows
   * to fit the content up to a 240px cap (then it scrolls inside).
   */
  const syncComposerHeight = () => {
    const el = composerRef
    if (!el) return
    if (el.value === "") {
      el.style.height = ""
      return
    }
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  /* ---------------------------------------------------------------- *
   * Labels                                                            *
   * ---------------------------------------------------------------- */
  const messageCountLabel = (count: number) => {
    if (count === 0) return language.t("chat.session.messageCount.zero")
    if (count === 1) return language.t("chat.session.messageCount.one")
    return language.t("chat.session.messageCount.other", { count })
  }
  const charCountLabel = (count: number) => {
    if (count === 0) return language.t("chat.files.charCount.zero")
    if (count === 1) return language.t("chat.files.charCount.one")
    return language.t("chat.files.charCount.other", { count })
  }
  const memoryCountLabel = (count: number) => {
    if (count === 0) return language.t("chat.memory.count.zero")
    if (count === 1) return language.t("chat.memory.count.one")
    return language.t("chat.memory.count.other", { count })
  }

  // Pick a default model from the user's connected providers.
  const defaultModel = createMemo(() => {
    const list = providers.connected()
    for (const p of list) {
      const modelEntries = Object.entries(p.models ?? {})
      if (modelEntries.length === 0) continue
      const [id] = modelEntries[0]
      return { providerID: p.id, modelID: id }
    }
    return undefined
  })

  // Friendly model display: `Model name`. The provider is conveyed by the
  // ProviderIcon in the pill, so we don't repeat the prefix.
  const modelLabel = (session: ChatSession | undefined): string | undefined => {
    if (!session?.providerID || !session?.modelID) return undefined
    const provider = providers.all().find((p) => p.id === session.providerID)
    const model = provider?.models?.[session.modelID]
    return model?.name ?? session.modelID
  }

  /* ---------------------------------------------------------------- *
   * Session mutations                                                *
   * ---------------------------------------------------------------- */
  /**
   * "+ New chat" no longer creates a local session up-front — that produced
   * a list full of empty placeholders when the user clicked it repeatedly.
   * Instead we navigate to a clean `/chat` (which deselects the active
   * session and shows the empty state) and focus the composer so the user
   * can immediately start typing. The session (both local + backend) is
   * created on the FIRST send.
   */
  const newSession = () => {
    navigate("/chat")
    setInput("")
    queueMicrotask(() => {
      composerRef?.focus()
      syncComposerHeight()
    })
  }

  onMount(() => {
    // Drop empty placeholder sessions left over by the old "+ New chat"
    // behaviour and warm the messages cache so the sidebar shows counts.
    chat.pruneEmpty()
    for (const s of store.sessions) {
      if (s.backendID && s.directory) {
        void loadBackendMessages(s.directory, s.backendID)
      }
    }
    // No auto-redirect to a recent session — landing on "/chat" should
    // give the user the empty state with a composer ready to type into.
  })

  const updateSession = (id: string, fn: (s: ChatSession) => void) => {
    chat.updateSession(id, fn)
  }

  const deleteSession = (id: string) => {
    chat.deleteSession(id)
    if (activeID() === id) {
      const next = sortedSessions()[0]
      navigate(next ? `/chat/${next.id}` : "/chat", { replace: true })
    }
  }

  const renameSession = (id: string) => {
    const current = store.sessions.find((s) => s.id === id)
    if (!current) return
    const value = window.prompt(language.t("chat.session.renamePrompt"), current.title)
    if (value === null) return
    updateSession(id, (s) => {
      s.title = value.trim() || language.t("chat.session.untitled")
    })
  }

  const setSessionModel = (id: string, providerID: string, modelID: string) => {
    updateSession(id, (s) => {
      s.providerID = providerID
      s.modelID = modelID
    })
  }

  /* ---------------------------------------------------------------- *
   * Memory mutations — thin shims over the context.                   *
   * ---------------------------------------------------------------- */
  const addMemoryEntry = (): MemoryEntry => chat.addMemoryEntry()
  const updateMemoryEntry = (id: string, patch: Partial<Pick<MemoryEntry, "title" | "content">>) =>
    chat.updateMemoryEntry(id, patch)
  const removeMemoryEntry = (id: string) => chat.removeMemoryEntry(id)

  /* ---------------------------------------------------------------- *
   * Files mutations                                                   *
   * ---------------------------------------------------------------- */
  const saveFile = (name: string, content: string) => {
    const session = active()
    if (!session) return
    updateSession(session.id, (s) => {
      const idx = s.files.findIndex((f) => f.name === name)
      const entry: ChatFile = { name, content, updated: Date.now() }
      if (idx >= 0) s.files[idx] = entry
      else s.files.push(entry)
    })
  }

  const removeFile = (name: string) => {
    const session = active()
    if (!session) return
    updateSession(session.id, (s) => {
      s.files = s.files.filter((f) => f.name !== name)
    })
  }

  /* ---------------------------------------------------------------- *
   * Send                                                              *
   * ---------------------------------------------------------------- *
   * Routes through the real codeplane session API:
   *  1. If no active local session, create one (lazy — clicking "+ New
   *     chat" no longer creates a placeholder; only sending does).
   *  2. If the session has no `backendID`, ask the codeplane backend to
   *     create a session in our chat directory and remember the ID.
   *  3. Build a system prompt from the user's memory + per-session files
   *     and call `session.promptAsync` with it. The reply streams back via
   *     globalSync events into `child.message[backendID]` / `child.part`.
   */
  const sendMessage = async () => {
    const text = input().trim()
    if (!text) return

    // 1. Ensure there's a local session pointer.
    let session = active()
    if (!session) {
      const m = draftModel() ?? defaultModel()
      const fresh = chat.newSession({
        title: deriveTitle(text),
        modelID: m?.modelID,
        providerID: m?.providerID,
      })
      navigate(`/chat/${fresh.id}`)
      session = fresh
      setDraftModel(undefined)
    }

    // 2. Need a connected model to send.
    const providerID = session.providerID
    const modelID = session.modelID
    if (!providerID || !modelID) {
      showToast({
        title: language.t("chat.error.sendFailed"),
        description: language.t("chat.model.notConnected"),
      })
      return
    }

    // 3. Lazy-create the codeplane backend session on the first send.
    if (!session.backendID || !session.directory) {
      // Per-session scratch dir so file writes by the agent are isolated
      // to THIS chat — see `sessionDirectory()` for the slug strategy.
      const directory = sessionDirectory(session.id)
      if (!directory) {
        showToast({
          title: language.t("chat.error.sendFailed"),
          description: language.t("chat.error.noDirectory"),
        })
        return
      }
      try {
        const result = await globalSDK.client.session.create({
          directory,
          title: deriveTitle(text),
        })
        // Generated SDK returns `{ data, ... }`; normalize.
        const created =
          (result as { data?: { id?: string } }).data ??
          (result as unknown as { id?: string })
        const backendID = created?.id
        if (!backendID) throw new Error("session.create returned no id")
        updateSession(session.id, (s) => {
          s.backendID = backendID
          s.directory = directory
        })
        // Bootstrap the global-sync child store so streaming events land here.
        globalSync.child(directory)
        session = store.sessions.find((s) => s.id === session!.id) ?? session
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        showToast({
          title: language.t("chat.error.sendFailed"),
          description: message,
        })
        return
      }
    }

    setInput("")
    queueMicrotask(syncComposerHeight)
    setSending(true)
    // Pressing Send is intentional — re-pin to the bottom so the user
    // always sees their new message and the streaming reply, even if
    // they had previously scrolled up to read history.
    setStuckToBottom(true)
    requestAnimationFrame(() => scrollThreadToBottom(true))
    // Show the user's prompt INSTANTLY as a pending bubble. Without this
    // the user can see the assistant start streaming before their own
    // message lands (the backend creates the user msg + emits its WS
    // event AFTER the prompt is accepted, which can race with the first
    // assistant delta). The pending bubble is removed by an effect once
    // the real user-role message lands in `backendMessages`.
    setPendingPosition(backendMessages().length)
    setPendingUserText(text)

    // 4. Build the chat-specific system prompt from memory + files.
    const systemPrompt = buildChatSystemPrompt({
      memory: store.memory,
      files: session.files,
      fallbackMemoryTitle: language.t("chat.memory.entryUntitled"),
    })

    // Refresh title from first message if it's still the default.
    if (
      !session.title ||
      session.title === language.t("chat.session.untitled") ||
      session.title === "New chat"
    ) {
      updateSession(session.id, (s) => {
        s.title = deriveTitle(text)
      })
    }

    // 5. Send via the SDK; poll for the response since we're not on the
    //    globalSync event stream for this directory.
    //
    //    `promptAsync` returns as soon as the backend accepts the prompt,
    //    not when the assistant finishes streaming. So we kick off polling
    //    BEFORE awaiting it and keep polling until the last assistant
    //    message stops growing for ~1.2s (a reasonable "stream completed"
    //    heuristic) or we hit a 60s ceiling.
    const directory = session.directory!
    const backendID = session.backendID!
    try {
      // Seed globalSync so the WS event reducer has the directory + the
      // current message list to mutate as deltas arrive.
      void loadBackendMessages(directory, backendID)
      await globalSDK.client.session.promptAsync({
        sessionID: backendID,
        directory,
        model: { providerID, modelID },
        system: systemPrompt,
        // Disable coding/shell tools — chat surface stays focused on chat.
        // Web search, browse, skill, and the visual tools (chart, kpi, …)
        // remain on so the assistant can still produce rich answers.
        tools: CHAT_DISABLED_TOOLS,
        parts: [{ type: "text", text }],
      })
      // Wait for streaming to finish by observing globalSync — the WS
      // events fill in `child.message[backendID]` and `child.part[…]`.
      // We watch the last message's part text length and bail when it
      // stops growing for ~1.2s.
      const [child] = globalSync.child(directory)
      const start = Date.now()
      let lastLength = -1
      let stableSince = Date.now()
      while (Date.now() - start < 60_000) {
        await new Promise((r) => setTimeout(r, 200))
        const list = child.message[backendID] ?? []
        const last = list[list.length - 1] as { id?: string; role?: string } | undefined
        if (!last?.id || last.role !== "assistant") {
          stableSince = Date.now()
          lastLength = -1
          continue
        }
        const parts = child.part[last.id] ?? []
        const text = parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { text?: string }).text ?? "")
          .join("")
        if (text.length !== lastLength) {
          lastLength = text.length
          stableSince = Date.now()
          continue
        }
        if (Date.now() - stableSince > 1200 && text.length > 0) break
      }
      updateSession(session.id, () => {})
      // Memory directives — re-run loadBackendMessages once so the parser
      // sees the final assistant text and persists the directive.
      void loadBackendMessages(directory, backendID)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({
        title: language.t("chat.error.sendFailed"),
        description: message,
      })
      // Send failed — drop the optimistic bubble (the prompt never landed).
      setPendingUserText(undefined)
    } finally {
      setSending(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  const onComposerSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    void sendMessage()
  }

  /* ---------------------------------------------------------------- *
   * Dialog/popover openers                                            *
   * ---------------------------------------------------------------- */
  const openMemoryDialog = () => {
    dialog.show(() => (
      <ChatMemoryDialog
        entries={() => store.memory}
        onAdd={addMemoryEntry}
        onUpdate={updateMemoryEntry}
        onRemove={removeMemoryEntry}
      />
    ))
  }

  const openFilesDialog = () => {
    const session = active()
    if (!session) return
    dialog.show(() => (
      <ChatFilesDialog
        files={() => store.sessions.find((s) => s.id === session.id)?.files ?? []}
        onRemove={removeFile}
        charCountLabel={charCountLabel}
      />
    ))
  }

  const getSessionMessageCount = (s: ChatSession) => {
    if (!s.backendID || !s.directory) return s.messages?.length ?? 0
    const [child] = globalSync.child(s.directory, { bootstrap: false })
    return child.message[s.backendID]?.length ?? s.messages?.length ?? 0
  }

  return (
    // Sessions sidebar lives in the layout (see `ChatSidebarPanel` in
    // `pages/layout/sidebar-chat.tsx`) so the chat surface inherits the
    // native collapse/expand toggle in the titlebar. This file owns the
    // main pane only — header, thread, composer.
    <div class="size-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      {/* File preview drawer — overlay; only visible when a file artefact
          card opened it. Module-scope state, single instance. */}
      <FilePreviewDrawer />
      <Show when={false satisfies boolean}>
       <div data-removed="legacy-inline-sidebar">
        <div class="shrink-0 h-12 px-3 flex items-center justify-between gap-2 border-b border-border-weak-base">
          <span class="text-12-medium text-text-base uppercase tracking-wider">
            {language.t("chat.sessions.title")}
          </span>
          <Tooltip placement="bottom" value={language.t("chat.session.new")}>
            <Button
              variant="ghost"
              class="titlebar-icon w-8 h-6 p-0 box-border"
              onClick={newSession}
              aria-label={language.t("chat.session.new")}
            >
              <Icon size="small" name="new-session" class="text-icon-weak" />
            </Button>
          </Tooltip>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-1.5">
          <Show
            when={sortedSessions().length > 0}
            fallback={
              <div class="px-3 py-8 flex flex-col items-center text-center gap-2">
                <Icon name="speech-bubble" size="small" class="text-icon-weak" />
                <p class="text-12-regular text-text-weak max-w-[200px] leading-relaxed">
                  {language.t("chat.sessions.empty")}
                </p>
              </div>
            }
          >
            <ul class="flex flex-col gap-0.5">
              <For each={sortedSessions()}>
                {(session) => {
                  const selected = () => activeID() === session.id
                  const indicatorActive = () => sending() && selected()
                  return (
                    <li>
                      <div
                        class="group/session w-full min-w-0 rounded-md cursor-default transition-colors hover:bg-surface-raised-base-hover flex items-center"
                        classList={{ "bg-surface-base-active": selected() }}
                      >
                        <button
                          type="button"
                          class="flex items-center gap-2 min-w-0 flex-1 px-2 py-1.5 text-left focus:outline-none"
                          onClick={() => navigate(`/chat/${session.id}`)}
                        >
                          <div
                            class="shrink-0 size-5 flex items-center justify-center"
                            aria-hidden="true"
                          >
                            <Show
                              when={indicatorActive()}
                              fallback={
                                <Show
                                  when={getSessionMessageCount(session) > 0 || !!session.backendID}
                                  fallback={<div class="size-1.5" />}
                                >
                                  <div
                                    class="size-1.5 rounded-full"
                                    classList={{
                                      "bg-text-interactive-base": selected(),
                                      "bg-icon-weak": !selected(),
                                    }}
                                  />
                                </Show>
                              }
                            >
                              <Spinner class="size-[15px]" />
                            </Show>
                          </div>
                          <div class="min-w-0 flex-1">
                            <div class="text-13-medium text-text-strong truncate">
                              {session.title}
                            </div>
                            <div class="text-11-regular text-text-weak truncate">
                              {messageCountLabel(getSessionMessageCount(session))}
                            </div>
                          </div>
                        </button>
                        {/* Action icons — flex items, not absolute, so they
                            don't overlap the title. They smoothly transition
                            from 0 width to ~52px on hover. */}
                        <div class="shrink-0 overflow-hidden flex items-center gap-0.5 transition-[width] duration-100 w-0 group-hover/session:w-[52px] group-focus-within/session:w-[52px] pr-1">
                          <Tooltip placement="top" value={language.t("chat.session.rename")}>
                            <IconButton
                              icon="pencil-line"
                              variant="ghost"
                              class="size-6 rounded-md"
                              aria-label={language.t("chat.session.rename")}
                              onClick={(event) => {
                                event.stopPropagation()
                                renameSession(session.id)
                              }}
                            />
                          </Tooltip>
                          <Tooltip placement="top" value={language.t("chat.session.delete")}>
                            <IconButton
                              icon="archive"
                              variant="ghost"
                              class="size-6 rounded-md"
                              aria-label={language.t("chat.session.delete")}
                              onClick={(event) => {
                                event.stopPropagation()
                                if (window.confirm(language.t("chat.session.deleteConfirm")))
                                  deleteSession(session.id)
                              }}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </li>
                  )
                }}
              </For>
            </ul>
          </Show>
        </div>
        <div class="shrink-0 border-t border-border-weak-base">
          <button
            type="button"
            class="flex items-center gap-2 w-full h-10 px-3 cursor-default hover:bg-surface-raised-base-hover focus:outline-none"
            onClick={openMemoryDialog}
          >
            <Icon
              name="brain"
              size="small"
              classList={{
                "text-icon-strong": store.memory.length > 0,
                "text-icon-base": store.memory.length === 0,
              }}
            />
            <span class="text-13-medium text-text-strong flex-1 text-left">
              {language.t("chat.memory.title")}
            </span>
            <Show when={store.memory.length > 0}>
              <span class="text-11-regular text-text-weak">{store.memory.length}</span>
            </Show>
          </button>
        </div>
       </div>
      </Show>
      {/* DELETED-END: legacy in-page sidebar */}

      {/* Main pane */}
      <section class="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Header — title + Files / Memory / New chat (mobile gets the
            sessions popover in the leftmost slot). */}
      <header class="chat-header shrink-0 flex items-center border-b border-border-weak-base">
        {/* Mobile-only sessions popover — desktop has the sidebar above. */}
        <div class="md:hidden">
          <SessionsPopover
            sessions={sortedSessions()}
            activeID={activeID()}
            messageCountLabel={messageCountLabel}
            getMessageCount={getSessionMessageCount}
            onPick={(id) => navigate(`/chat/${id}`)}
            onRename={renameSession}
            onDelete={(id) => {
              if (window.confirm(language.t("chat.session.deleteConfirm"))) deleteSession(id)
            }}
            onNew={newSession}
            sending={sending()}
          />
        </div>
        <div class="flex-1 min-w-0">
          <Show when={active()} keyed>
            {(session) => (
              <div class="text-14-medium text-text-strong truncate" title={session.title}>
                {session.title}
              </div>
            )}
          </Show>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={active()}>
            {(session) => (
              <Tooltip placement="bottom" value={language.t("chat.files.toggle")}>
                <Button
                  variant="ghost"
                  class="titlebar-icon chat-icon-btn"
                  onClick={openFilesDialog}
                  aria-label={language.t("chat.files.toggle")}
                  aria-expanded={false}
                >
                  <div class="relative flex items-center justify-center size-4">
                    <Icon
                      size="small"
                      name={session().files.length > 0 ? "file-tree-active" : "file-tree"}
                      classList={{
                        "text-icon-strong": session().files.length > 0,
                        "text-icon-weak": session().files.length === 0,
                      }}
                    />
                  </div>
                </Button>
              </Tooltip>
            )}
          </Show>
          {/* Live Activity opt-in — only rendered when the host is a
              mobile-shell webview that supports iOS Live Activities and
              there's an active session to opt in. The toggle posts a
              `codeplane:la-toggle` to the shell, which persists the
              choice and broadcasts back. */}
          <Show when={liveActivity.supported() && active()}>
            {(session) => {
              const enabled = createMemo(() => liveActivity.enabled(session().id))
              const disabled = createMemo(() => !enabled() && liveActivity.atLimit())
              const tooltip = createMemo(() => {
                if (enabled()) return language.t("chat.liveActivity.tooltip.on")
                if (disabled()) {
                  return language.t("chat.liveActivity.tooltip.limit", {
                    max: String(liveActivity.maxAllowed()),
                  })
                }
                return language.t("chat.liveActivity.tooltip.off")
              })
              return (
                <Tooltip placement="bottom" value={tooltip()}>
                  <Button
                    variant="ghost"
                    class="titlebar-icon chat-icon-btn"
                    onClick={() => {
                      if (disabled()) return
                      liveActivity.toggle(session().id, !enabled(), session().title)
                    }}
                    aria-label={tooltip()}
                    aria-pressed={enabled()}
                    aria-disabled={disabled()}
                    classList={{ "opacity-40 cursor-default": disabled() }}
                  >
                    <Icon
                      size="small"
                      name="bell"
                      classList={{
                        "text-icon-interactive": enabled(),
                        "text-icon-weak": !enabled(),
                      }}
                    />
                  </Button>
                </Tooltip>
              )
            }}
          </Show>
          {/* Memory + New chat — visible only on mobile (desktop has them
              in the sidebar footer / sidebar header respectively). */}
          <Tooltip placement="bottom" value={language.t("chat.memory.toggle")}>
            <Button
              variant="ghost"
              class="titlebar-icon chat-icon-btn md:hidden"
              onClick={openMemoryDialog}
              aria-label={language.t("chat.memory.toggle")}
            >
              <Icon
                size="small"
                name="brain"
                classList={{
                  "text-icon-strong": store.memory.length > 0,
                  "text-icon-weak": store.memory.length === 0,
                }}
              />
            </Button>
          </Tooltip>
          <Tooltip placement="bottom" value={language.t("chat.session.new")}>
            <Button
              variant="ghost"
              class="titlebar-icon chat-icon-btn md:hidden"
              onClick={newSession}
              aria-label={language.t("chat.session.new")}
            >
              <Icon size="small" name="new-session" class="text-icon-weak" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {/* Thread (or hint) — composer is always present so the user can
          type to start a brand-new chat from the empty route. */}
      <div class="flex-1 min-w-0 min-h-0 flex flex-col">
        <div
          ref={(el) => (threadScrollRef = el)}
          onScroll={onThreadScroll}
          class="flex-1 min-h-0 overflow-y-auto"
        >
          <div class="w-full px-3 md:max-w-200 md:mx-auto 2xl:max-w-[1000px] py-8">
            <Show
              when={
                !!active() &&
                (backendMessages().length > 0 ||
                  (active()!.messages?.length ?? 0) > 0 ||
                  // If a send just fired but the backend hasn't echoed
                  // the user message yet, show the thread (with our
                  // optimistic bubble) instead of the empty placeholder.
                  pendingUserText() !== undefined)
              }
              fallback={
                <Show
                  when={active()}
                  fallback={
                    <div class="flex flex-col items-center justify-center text-center gap-4 py-12">
                      <Mark class="w-10" />
                      <div class="flex flex-col gap-2 max-w-md">
                        <div class="text-20-medium text-text-strong">
                          {language.t("chat.empty.title")}
                        </div>
                        <div class="text-13-regular text-text-base leading-relaxed">
                          {language.t("chat.empty.description")}
                        </div>
                      </div>
                    </div>
                  }
                >
                  <div class="flex flex-col items-center justify-center text-center gap-3 py-16">
                    <Mark class="w-8 opacity-50" />
                    <div class="text-13-regular text-text-weak max-w-md leading-relaxed">
                      {language.t("chat.message.startHint")}
                    </div>
                  </div>
                </Show>
              }
            >
              <div class="flex flex-col gap-6">
                {(() => {
                  // Build the flat render plan. We splice the optimistic
                  // user bubble into the message stream at the index we
                  // snapshot'd at send time, so the assistant's reply
                  // (which often arrives over WS BEFORE the user message
                  // echoes back) lands BELOW the prompt that triggered
                  // it instead of above it.
                  type Item =
                    | { kind: "msg"; message: RenderMessage; isLast: boolean }
                    | { kind: "legacy"; message: ChatMessage }
                    | { kind: "pending" }
                  const items: Item[] = []
                  const insertPending = () => {
                    if (pendingUserText() !== undefined) items.push({ kind: "pending" })
                  }
                  const backend = backendMessages()
                  if (backend.length > 0) {
                    if (pendingPosition() === 0) insertPending()
                    backend.forEach((m, i) => {
                      items.push({ kind: "msg", message: m, isLast: i === backend.length - 1 })
                      if (pendingPosition() === i + 1) insertPending()
                    })
                  } else if ((active()!.messages?.length ?? 0) > 0) {
                    if (pendingPosition() === 0) insertPending()
                    for (const m of active()!.messages ?? []) {
                      items.push({ kind: "legacy", message: m })
                    }
                  } else {
                    // Brand-new chat: only the optimistic bubble (if any).
                    insertPending()
                  }
                  return (
                    <For each={items}>
                      {(item) => (
                        <Switch>
                          <Match when={item.kind === "msg"}>
                            {(() => {
                              const i = item as Extract<Item, { kind: "msg" }>
                              return (
                                <Switch>
                                  <Match when={i.message.role === "user"}>
                                    <UserMessage content={i.message.text} />
                                  </Match>
                                  <Match when={i.message.role === "assistant"}>
                                    <AssistantMessage
                                      parts={i.message.parts}
                                      raw={i.message.raw ?? i.message.text}
                                      pending={
                                        i.message.parts.length === 0 && sending() && i.isLast
                                      }
                                      pendingLabel={language.t("chat.message.thinking")}
                                    />
                                  </Match>
                                </Switch>
                              )
                            })()}
                          </Match>
                          <Match when={item.kind === "legacy"}>
                            {(() => {
                              const i = item as Extract<Item, { kind: "legacy" }>
                              return (
                                <Switch>
                                  <Match when={i.message.role === "user"}>
                                    <UserMessage content={i.message.content} />
                                  </Match>
                                  <Match when={i.message.role === "assistant"}>
                                    <AssistantMessage
                                      parts={[{ type: "text", id: i.message.id, text: i.message.content }]}
                                      raw={i.message.content}
                                      pending={!i.message.content && sending()}
                                      pendingLabel={language.t("chat.message.thinking")}
                                    />
                                  </Match>
                                </Switch>
                              )
                            })()}
                          </Match>
                          <Match when={item.kind === "pending"}>
                            <UserMessage content={pendingUserText()!} />
                            <div class="flex items-center gap-2 text-13-regular text-text-weak">
                              <Spinner class="size-3.5" />
                              <span>{language.t("chat.message.thinking")}</span>
                            </div>
                          </Match>
                        </Switch>
                      )}
                    </For>
                  )
                })()}
              </div>
            </Show>
          </div>
        </div>

        {/* Composer — always visible. We deliberately don't tint the
            composer area (no `bg-background-stronger`) so the page reads
            as one continuous surface; the DockShell + DockTray together
            already provide enough visual lift.
            On mobile we add `safe-area-inset-bottom` padding so the
            composer doesn't sit flush with iOS's home indicator, and a
            bit more breathing room above the dock since the on-screen
            keyboard sits right below. Desktop keeps the tighter pb-3. */}
        <div
          data-component="chat-prompt-dock"
          class="chat-prompt-dock shrink-0 w-full flex flex-col justify-center items-center pointer-events-none"
        >
          <div class="w-full px-3 md:max-w-200 md:mx-auto 2xl:max-w-[1000px] pointer-events-auto">
            <DockShellForm
              class="group/prompt-input focus-within:shadow-xs-border"
              onSubmit={onComposerSubmit}
            >
              <div class="relative">
                <textarea
                  ref={(el) => {
                    composerRef = el
                    queueMicrotask(syncComposerHeight)
                  }}
                  class="w-full min-h-[3.5rem] max-h-60 px-3 pt-3 pb-12 text-14-regular text-text-strong bg-transparent focus:outline-none resize-none placeholder:text-text-weak overflow-y-auto"
                  placeholder={language.t("chat.input.placeholder")}
                  value={input()}
                  onInput={(event) => {
                    setInput(event.currentTarget.value)
                    syncComposerHeight()
                  }}
                  onKeyDown={onComposerKeyDown}
                  disabled={sending()}
                  aria-label={language.t("chat.input.label")}
                />
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-x-0 bottom-0"
                  style={{
                    height: "44px",
                    background:
                      "linear-gradient(to top, var(--surface-raised-stronger-non-alpha) calc(100% - 20px), transparent)",
                  }}
                />
                <div class="pointer-events-auto absolute bottom-2 right-2">
                  <Tooltip
                    placement="top"
                    value={
                      sending()
                        ? language.t("chat.input.sending")
                        : language.t("chat.input.send")
                    }
                  >
                    <IconButton
                      type="submit"
                      icon={sending() ? "stop" : "arrow-up"}
                      variant="primary"
                      class="chat-send-btn"
                      disabled={sending() || input().trim().length === 0}
                      aria-label={language.t("chat.input.send")}
                    />
                  </Tooltip>
                </div>
              </div>
            </DockShellForm>
            <DockTray attach="top">
              <div class="px-1.75 pt-5.5 pb-2 flex items-center gap-2 min-w-0">
                {(() => {
                  // Resolve the current model: active session > draft > default.
                  const current = () => {
                    const a = active()
                    if (a?.providerID && a?.modelID) {
                      return { providerID: a.providerID, modelID: a.modelID }
                    }
                    return draftModel() ?? defaultModel()
                  }
                  const currentModel = () => {
                    const c = current()
                    if (!c) return undefined
                    return providers.all().find((p) => p.id === c.providerID)?.models?.[c.modelID]
                  }
                  const label = () => {
                    const c = current()
                    if (!c) return language.t("chat.toolbar.modelPick")
                    return currentModel()?.name ?? c.modelID
                  }
                  return (
                    <>
                      <ModelPickerPill
                        currentLabel={label()}
                        currentProviderID={current()?.providerID}
                        currentModelID={current()?.modelID}
                        providers={providers}
                        onPick={(providerID, modelID) => {
                          const a = active()
                          if (a) setSessionModel(a.id, providerID, modelID)
                          else setDraftModel({ providerID, modelID })
                        }}
                      />
                      {/* Model capability badges — vision / tools / reasoning. */}
                      <Show when={currentModel()} keyed>
                        {(model) => {
                          const m = model as {
                            capabilities?: { toolcall?: boolean; reasoning?: boolean }
                            input?: string[]
                          }
                          const vision = (m.input ?? []).includes("image")
                          const tools = !!m.capabilities?.toolcall
                          const reasoning = !!m.capabilities?.reasoning
                          return (
                            <div class="flex items-center gap-0.5">
                              <Show when={vision}>
                                <Tooltip placement="top" value={language.t("chat.model.cap.vision")}>
                                  <span
                                    aria-label={language.t("chat.model.cap.vision")}
                                    class="inline-flex size-5 items-center justify-center text-icon-base"
                                  >
                                    <Icon name="eye" size="small" />
                                  </span>
                                </Tooltip>
                              </Show>
                              <Show when={tools}>
                                <Tooltip placement="top" value={language.t("chat.model.cap.tools")}>
                                  <span
                                    aria-label={language.t("chat.model.cap.tools")}
                                    class="inline-flex size-5 items-center justify-center text-icon-base"
                                  >
                                    <Icon name="mcp" size="small" />
                                  </span>
                                </Tooltip>
                              </Show>
                              <Show when={reasoning}>
                                <Tooltip
                                  placement="top"
                                  value={language.t("chat.model.cap.reasoning")}
                                >
                                  <span
                                    aria-label={language.t("chat.model.cap.reasoning")}
                                    class="inline-flex size-5 items-center justify-center text-icon-base"
                                  >
                                    <Icon name="brain" size="small" />
                                  </span>
                                </Tooltip>
                              </Show>
                            </div>
                          )
                        }}
                      </Show>
                    </>
                  )
                })()}
                <div class="flex-1" />
              </div>
            </DockTray>
          </div>
        </div>
      </div>
      </section>
    </div>
  )
}

export default ChatPage

/* -------------------------------------------------------------------- *
 * Sessions popover — replaces the previous inner sidebar.              *
 * -------------------------------------------------------------------- */
function SessionsPopover(props: {
  sessions: ChatSession[]
  activeID?: string
  messageCountLabel: (n: number) => string
  getMessageCount: (s: ChatSession) => number
  onPick: (id: string) => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
  onNew: () => void
  sending: boolean
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      gutter={4}
      class="w-72 p-0! overflow-hidden [&>[data-slot=popover-body]]:p-0!"
      trigger={
        <Tooltip
          placement="bottom"
          value={language.t("chat.toolbar.sessions")}
          inactive={open()}
        >
          <Button
            variant="ghost"
            class="titlebar-icon chat-icon-btn"
            aria-label={language.t("chat.toolbar.sessions")}
          >
            <Icon size="small" name="menu" class="text-icon-weak" />
          </Button>
        </Tooltip>
      }
    >
      {/* Single flex column inside the popover-body so the inner list can
          shrink + scroll. The popover-body itself isn't a flex container, so
          we have to wrap. */}
      <div class="flex flex-col max-h-96 min-h-0">
        <div class="shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-b border-border-weak-base">
          <span class="text-12-medium text-text-weak uppercase tracking-wide">
            {language.t("chat.sessions.title")}
          </span>
          <Tooltip placement="bottom" value={language.t("chat.session.new")}>
            <IconButton
              icon="new-session"
              variant="ghost"
              class="size-7 rounded-md"
              aria-label={language.t("chat.session.new")}
              onClick={() => {
                setOpen(false)
                props.onNew()
              }}
            />
          </Tooltip>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-1.5">
        <Show
          when={props.sessions.length > 0}
          fallback={
            <div class="px-3 py-6 text-center">
              <Icon name="speech-bubble" size="small" class="text-icon-weak mx-auto mb-2" />
              <div class="text-12-regular text-text-weak">
                {language.t("chat.sessions.empty")}
              </div>
            </div>
          }
        >
          <ul class="flex flex-col gap-0.5">
            <For each={props.sessions}>
              {(session) => {
                const selected = () => props.activeID === session.id
                const indicatorActive = () => props.sending && selected()
                return (
                  <li>
                    <div
                      class="group/session relative w-full min-w-0 rounded-md cursor-default transition-colors hover:bg-surface-raised-base-hover"
                      classList={{ "bg-surface-base-active": selected() }}
                    >
                      <button
                        type="button"
                        class="flex items-center gap-2 w-full min-w-0 px-2 py-1.5 text-left focus:outline-none"
                        onClick={() => {
                          setOpen(false)
                          props.onPick(session.id)
                        }}
                      >
                        <div
                          class="shrink-0 size-5 flex items-center justify-center"
                          aria-hidden="true"
                        >
                          <Show
                            when={indicatorActive()}
                            fallback={
                              <Show
                                when={props.getMessageCount(session) > 0 || !!session.backendID}
                                fallback={<div class="size-1.5" />}
                              >
                                <div
                                  class="size-1.5 rounded-full"
                                  classList={{
                                    "bg-text-interactive-base": selected(),
                                    "bg-icon-weak": !selected(),
                                  }}
                                />
                              </Show>
                            }
                          >
                            <Spinner class="size-[15px]" />
                          </Show>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="text-13-medium text-text-strong truncate">
                            {session.title}
                          </div>
                          <div class="text-11-regular text-text-weak truncate">
                            {props.messageCountLabel(props.getMessageCount(session))}
                          </div>
                        </div>
                      </button>
                      <div class="absolute inset-y-0 right-1 flex items-center gap-0.5 opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100">
                        <Tooltip placement="top" value={language.t("chat.session.rename")}>
                          <IconButton
                            icon="pencil-line"
                            variant="ghost"
                            class="size-6 rounded-md"
                            aria-label={language.t("chat.session.rename")}
                            onClick={(event) => {
                              event.stopPropagation()
                              props.onRename(session.id)
                            }}
                          />
                        </Tooltip>
                        <Tooltip placement="top" value={language.t("chat.session.delete")}>
                          <IconButton
                            icon="archive"
                            variant="ghost"
                            class="size-6 rounded-md"
                            aria-label={language.t("chat.session.delete")}
                            onClick={(event) => {
                              event.stopPropagation()
                              props.onDelete(session.id)
                            }}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
        </div>
      </div>
    </Popover>
  )
}

/* -------------------------------------------------------------------- *
 * Model picker pill — bottom-left of the composer.                     *
 * -------------------------------------------------------------------- */
function ModelPickerPill(props: {
  currentLabel: string
  currentProviderID?: string
  currentModelID?: string
  providers: ReturnType<typeof useProviders>
  onPick: (providerID: string, modelID: string) => void
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const flatModels = createMemo(() =>
    props.providers.connected().flatMap((provider) =>
      Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
        providerID: provider.id,
        providerName: provider.name ?? provider.id,
        modelID,
        modelName: (model as { name?: string }).name ?? modelID,
      })),
    ),
  )
  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="top-start"
      gutter={6}
      class="w-72 p-0! overflow-hidden [&>[data-slot=popover-body]]:p-0!"
      trigger={
        <Button
          variant="ghost"
          size="normal"
          class="min-w-0 max-w-[320px] text-13-regular text-text-base group"
          aria-label={language.t("chat.toolbar.modelPick")}
        >
          <Show when={props.currentProviderID} keyed>
            {(id) => (
              <ProviderIcon
                id={id}
                class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
                style={{ "will-change": "opacity", transform: "translateZ(0)" }}
              />
            )}
          </Show>
          <span class="truncate">{props.currentLabel}</span>
          <Icon name="chevron-down" size="small" class="shrink-0" />
        </Button>
      }
    >
      {/* Single flex column inside the popover-body so the model list can
          shrink + scroll. */}
      <div class="flex flex-col max-h-80 min-h-0">
        <div class="shrink-0 px-3 py-2 border-b border-border-weak-base">
          <span class="text-12-medium text-text-weak uppercase tracking-wide">
            {language.t("chat.toolbar.model")}
          </span>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-1.5">
        <Show
          when={flatModels().length > 0}
          fallback={
            <div class="px-3 py-6 text-center">
              <div class="text-12-regular text-text-weak">
                {language.t("chat.model.notConnected")}
              </div>
            </div>
          }
        >
          <ul class="flex flex-col gap-0.5">
            <For each={flatModels()}>
              {(item) => {
                const selected = () =>
                  item.providerID === props.currentProviderID &&
                  item.modelID === props.currentModelID
                return (
                  <li>
                    <button
                      type="button"
                      class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover focus:outline-none"
                      classList={{ "bg-surface-base-active": selected() }}
                      onClick={() => {
                        props.onPick(item.providerID, item.modelID)
                        setOpen(false)
                      }}
                    >
                      <ProviderIcon id={item.providerID} class="size-4 shrink-0" />
                      <div class="min-w-0 flex-1">
                        <div class="text-13-medium text-text-strong truncate">
                          {item.modelName}
                        </div>
                        <div class="text-11-regular text-text-weak truncate">
                          {item.providerName}
                        </div>
                      </div>
                      <Show when={selected()}>
                        <Icon name="check-small" size="small" class="text-icon-base shrink-0" />
                      </Show>
                    </button>
                  </li>
                )
              }}
            </For>
          </ul>
        </Show>
        </div>
      </div>
    </Popover>
  )
}

/* -------------------------------------------------------------------- *
 * Memory dialog — one entry per saved memory, each editable.           *
 * Visual treatment matches `dialog-edit-project.tsx`: `fit` dialog with *
 * a `flex flex-col gap-5 px-6 pt-0 pb-5` body, `TextField` inputs, and *
 * a right-aligned action footer.                                        *
 * -------------------------------------------------------------------- */
function ChatMemoryDialog(props: {
  entries: () => MemoryEntry[]
  onAdd: () => MemoryEntry
  onUpdate: (id: string, patch: Partial<Pick<MemoryEntry, "title" | "content">>) => void
  onRemove: (id: string) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog
      title={language.t("chat.memory.title")}
      description={language.t("chat.memory.subtitle")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <div class="flex flex-col gap-5 px-6 pt-2 pb-5">
        <Show
          when={props.entries().length > 0}
          fallback={
            <div class="flex flex-col items-center text-center gap-2 py-6">
              <Icon name="brain" size="small" class="text-icon-weak" />
              <p class="text-12-regular text-text-weak max-w-sm leading-relaxed">
                {language.t("chat.memory.empty")}
              </p>
            </div>
          }
        >
          <ul class="flex flex-col gap-4">
            <For each={props.entries()}>
              {(entry) => (
                <li class="flex flex-col gap-2">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 min-w-0">
                      <TextField
                        type="text"
                        hideLabel
                        label={language.t("chat.memory.titlePlaceholder")}
                        placeholder={language.t("chat.memory.titlePlaceholder")}
                        value={entry.title}
                        onChange={(value) => props.onUpdate(entry.id, { title: value })}
                      />
                    </div>
                    <Tooltip placement="top" value={language.t("chat.memory.delete")}>
                      <IconButton
                        icon="close-small"
                        variant="ghost"
                        class="size-7 rounded-md shrink-0"
                        aria-label={language.t("chat.memory.delete")}
                        onClick={() => props.onRemove(entry.id)}
                      />
                    </Tooltip>
                  </div>
                  <TextField
                    multiline
                    hideLabel
                    label={language.t("chat.memory.placeholder")}
                    placeholder={language.t("chat.memory.placeholder")}
                    value={entry.content}
                    onChange={(value) => props.onUpdate(entry.id, { content: value })}
                    class="min-h-20"
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            icon="plus"
            onClick={() => {
              props.onAdd()
            }}
          >
            {language.t("chat.memory.add")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* -------------------------------------------------------------------- *
 * Files dialog — list of session-scoped files. Selecting a file loads  *
 * it into the editor on the right; "Save file" upserts by name. Same   *
 * `Dialog` shell + `TextField` inputs as the memory dialog.            *
 * -------------------------------------------------------------------- */
function ChatFilesDialog(props: {
  files: () => ChatFile[]
  onRemove: (name: string) => void
  onSelect?: (file: ChatFile) => void
  charCountLabel: (count: number) => string
}) {
  const language = useLanguage()
  const dialog = useDialog()
  return (
    <Dialog
      title={language.t("chat.files.title")}
      description={language.t("chat.files.help")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <div class="flex flex-col gap-3 px-6 pt-2 pb-5">
        <Show
          when={props.files().length > 0}
          fallback={
            <div class="flex flex-col items-center text-center gap-2 py-8">
              <Icon name="folder" size="small" class="text-icon-weak" />
              <p class="text-12-regular text-text-weak max-w-sm leading-relaxed">
                {language.t("chat.files.empty")}
              </p>
            </div>
          }
        >
          <ul class="flex flex-col gap-1">
            <For each={props.files()}>
              {(file) => (
                <li>
                  <div class="group/file flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors hover:bg-surface-raised-base-hover">
                    <Icon name="file-tree" size="small" class="text-icon-weak shrink-0" />
                    <button
                      type="button"
                      class="text-13-regular text-text-strong truncate flex-1 text-left focus:outline-none"
                      onClick={() => props.onSelect?.(file)}
                    >
                      {file.name}
                    </button>
                    <span class="text-11-regular text-text-weak shrink-0 tabular-nums">
                      {props.charCountLabel(file.content.length)}
                    </span>
                    <Tooltip placement="top" value={language.t("chat.files.delete")}>
                      <IconButton
                        icon="close-small"
                        variant="ghost"
                        class="size-6 rounded-md opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100"
                        aria-label={language.t("chat.files.delete")}
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onRemove(file.name)
                        }}
                      />
                    </Tooltip>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}


/**
 * Right-aligned bubble for the user's turn. Visual treatment matches the
 * shipping `[data-slot="user-message-text"]` style from message-part.css:
 * - body wrapper: `max-w: min(92%, 88ch)` and right-aligned (margin-left: auto)
 * - text bubble: `display: inline-block` so it shrinks to content
 * - bubble: surface-base + border-weak + 8px/12px padding + radius-md, no shadow
 */
function UserMessage(props: { content: string }) {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    void navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div
      data-role="user"
      class="group/message flex flex-col items-end gap-1"
      style={{ "max-width": "min(92%, 88ch)", "margin-left": "auto" }}
    >
      <div
        class="inline-block bg-surface-base border border-border-weak-base rounded-md px-3 py-2 text-14-regular text-text-strong whitespace-pre-wrap break-words max-w-full"
        style={{ "user-select": "text" }}
      >
        {props.content}
      </div>
      <Tooltip placement="top" value={copied() ? language.t("chat.message.copied") : language.t("chat.message.copy")}>
        <IconButton
          icon={copied() ? "check-small" : "copy"}
          variant="ghost"
          class="size-6 rounded-md opacity-0 group-hover/message:opacity-100 transition-opacity"
          aria-label={language.t("chat.message.copy")}
          onClick={copy}
        />
      </Tooltip>
    </div>
  )
}

/**
 * Left-aligned assistant turn. Renders text parts as Markdown (with
 * `<memory>` blocks split out into inline `MemoryCard`s), and tool parts
 * (chart, kpi, table, …) as expandable `ToolCallCard`s — like ChatGPT.
 */
function AssistantMessage(props: {
  parts: Array<
    | { type: "text"; id: string; text: string }
    | {
        type: "tool"
        id: string
        tool: string
        state?: { status?: string; input?: unknown; output?: unknown; error?: string; title?: string }
      }
  >
  /** Raw concatenated text — for the copy button and memory parsing. */
  raw: string
  pending: boolean
  pendingLabel: string
}) {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const copy = () => {
    void navigator.clipboard.writeText(props.raw).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  /**
   * Flatten the parts list into renderable chunks. Each text part is split
   * into its own segments via `parseAssistantSegments` so `<memory>` cards
   * appear inline at the right position relative to the rest of the prose.
   */
  type Chunk =
    | { kind: "text"; text: string }
    | { kind: "memory"; title: string; content: string }
    | {
        kind: "tool"
        tool: string
        state?: { status?: string; input?: unknown; output?: unknown; error?: string; title?: string }
      }
  const chunks = createMemo<Chunk[]>(() => {
    const out: Chunk[] = []
    for (const p of props.parts) {
      if (p.type === "text") {
        for (const seg of parseAssistantSegments(p.text)) {
          if (seg.kind === "text") out.push({ kind: "text", text: seg.text })
          else out.push({ kind: "memory", title: seg.title, content: seg.content })
        }
      } else if (p.type === "tool") {
        out.push({ kind: "tool", tool: p.tool, state: p.state })
      }
    }
    return out
  })

  return (
    <div class="group/message flex flex-col items-start gap-2 max-w-full w-full" data-role="assistant">
      <Show
        when={chunks().length > 0}
        fallback={
          <div class="flex items-center gap-2 text-13-regular text-text-weak">
            <Spinner class="size-3.5" />
            <span>{props.pending ? props.pendingLabel : ""}</span>
          </div>
        }
      >
        <div class="flex flex-col gap-3 max-w-full w-full">
          <For each={chunks()}>
            {(chunk) => (
              <Switch>
                <Match when={chunk.kind === "text"}>
                  <div class="text-14-regular text-text-strong max-w-full">
                    <Markdown text={coerceMermaidLanguage((chunk as { text: string }).text)} />
                  </div>
                </Match>
                <Match when={chunk.kind === "memory"}>
                  <MemoryCard
                    title={(chunk as { title: string; content: string }).title}
                    content={(chunk as { title: string; content: string }).content}
                  />
                </Match>
                <Match when={chunk.kind === "tool"}>
                  {(() => {
                    const c = chunk as {
                      tool: string
                      state?: {
                        status?: string
                        input?: unknown
                        output?: unknown
                        error?: string
                        title?: string
                      }
                    }
                    // Specialised rendering for file tools so writes/edits
                    // show up as proper "artefact" cards (filename + view +
                    // download) rather than a generic JSON dump.
                    if (c.tool === "write" || c.tool === "edit" || c.tool === "read") {
                      return <FileArtifactCard tool={c.tool} state={c.state} />
                    }
                    return <ToolCallCard tool={c.tool} state={c.state} />
                  })()}
                </Match>
              </Switch>
            )}
          </For>
        </div>
        <Show when={props.raw}>
          <Tooltip placement="top" value={copied() ? language.t("chat.message.copied") : language.t("chat.message.copy")}>
            <IconButton
              icon={copied() ? "check-small" : "copy"}
              variant="ghost"
              class="size-6 rounded-md opacity-0 group-hover/message:opacity-100 transition-opacity"
              aria-label={language.t("chat.message.copy")}
              onClick={copy}
            />
          </Tooltip>
        </Show>
      </Show>
    </div>
  )
}

/**
 * Inline card for a tool invocation. We don't have full codeplane MessagePart
 * machinery wired up here, so we render a compact visualisation: tool name,
 * status, optional title from `state.input.title`, and a structured preview
 * of the input/output (JSON-ish, capped). Designed to look distinct from a
 * plain text reply so the user knows the assistant ran a tool.
 */
function ToolCallCard(props: {
  tool: string
  state?: { status?: string; input?: unknown; output?: unknown; error?: string; title?: string }
}) {
  const language = useLanguage()
  const [expanded, setExpanded] = createSignal(false)
  const status = () => props.state?.status ?? "running"
  const title = () => {
    const s = props.state
    const t = (s?.input as { title?: string } | undefined)?.title
    return s?.title ?? t ?? props.tool
  }
  const summary = () => {
    const out = props.state?.output
    if (typeof out === "string") return out.slice(0, 200)
    if (out && typeof out === "object") {
      try {
        return JSON.stringify(out).slice(0, 200)
      } catch {
        return ""
      }
    }
    return ""
  }
  const preview = () => {
    const out = props.state?.output
    if (typeof out === "string") return out
    if (out && typeof out === "object") {
      try {
        return JSON.stringify(out, null, 2)
      } catch {
        return String(out)
      }
    }
    return ""
  }
  return (
    <div class="w-full max-w-full bg-surface-base border border-border-weak-base rounded-md overflow-hidden">
      <button
        type="button"
        class="flex items-center gap-2 w-full px-3 py-2 text-left focus:outline-none hover:bg-surface-raised-base-hover"
        onClick={() => setExpanded((v) => !v)}
      >
        <Show
          when={status() === "running"}
          fallback={
            <Show
              when={status() === "error" || !!props.state?.error}
              fallback={<Icon name="check-small" size="small" class="text-icon-base shrink-0" />}
            >
              <Icon name="circle-x" size="small" class="text-icon-critical-base shrink-0" />
            </Show>
          }
        >
          <Spinner class="size-3.5 shrink-0" />
        </Show>
        <div class="min-w-0 flex-1">
          <div class="text-12-medium text-text-strong">
            {language.t("chat.tool.using", { tool: props.tool })}
          </div>
          <div class="text-12-regular text-text-weak truncate">
            <Show when={title() && title() !== props.tool}>
              {title()}
            </Show>
            <Show when={!title() || title() === props.tool}>
              {summary() || language.t("chat.tool.runningLabel")}
            </Show>
          </div>
        </div>
        <Icon
          name={expanded() ? "chevron-down" : "chevron-right"}
          size="small"
          class="text-icon-weak shrink-0"
        />
      </button>
      <Show when={expanded() && (preview() || props.state?.error)}>
        <div class="px-3 pb-3 pt-0">
          <Show when={props.state?.error}>
            <pre class="text-11-regular text-text-critical-base whitespace-pre-wrap break-words bg-background-base border border-border-weak-base rounded p-2 mb-2">
              {props.state?.error}
            </pre>
          </Show>
          <Show when={preview()}>
            <pre class="text-11-regular text-text-base whitespace-pre-wrap break-words bg-background-base border border-border-weak-base rounded p-2 max-h-80 overflow-y-auto font-mono">
              {preview()}
            </pre>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * File artefacts — `write` / `edit` / `read` calls render as artefact
 * cards instead of generic tool-call dumps. The card shows the
 * filename + a small icon for the file type + Preview + Download
 * actions. Preview opens a drawer with proper rendering (Markdown,
 * code with syntax highlighting via Markdown's fenced rendering, plain
 * text, or an iframe for things browsers can render natively).
 * ------------------------------------------------------------------ */

// Map common file extensions to icons we actually have in the UI kit. Fall
// back to `archive` for anything else — it reads as "an artefact" in this
// context. We deliberately keep this list small; codeplane's icon kit
// doesn't have a generic "file" glyph, so we steer to the closest match.
const FILE_ICON_BY_EXT: Record<string, string> = {
  md: "prompt",
  markdown: "prompt",
  txt: "prompt",
  csv: "prompt",
  tsv: "prompt",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  html: "code",
  htm: "code",
  xml: "code",
  svg: "photo",
  png: "photo",
  jpg: "photo",
  jpeg: "photo",
  gif: "photo",
  webp: "photo",
  pdf: "prompt",
}

function fileExtension(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  const idx = base.lastIndexOf(".")
  if (idx <= 0) return ""
  return base.slice(idx + 1).toLowerCase()
}

function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * File extensions for which it makes sense to offer "Download as PDF".
 * For binary types (images, existing PDFs, archives) the export wouldn't
 * be a meaningful PDF — the print pipeline expects renderable text.
 */
const PDF_EXPORTABLE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "html",
  "htm",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "xml",
  "log",
  "rtf",
  "",
])

function escapeHtmlForPdf(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Render a file's content to HTML appropriate for printing.
 *
 * - Markdown / plain `.md`: parse via `marked` so headings, lists, tables,
 *   code fences, and links all come out styled.
 * - HTML: passed through verbatim — the agent already produced rendering
 *   instructions, the print stylesheet just adds page margins.
 * - CSV / TSV: parsed into a `<table>` so spreadsheet-like data prints as
 *   a real grid instead of one long line.
 * - Anything else: wrapped in `<pre>` with HTML-escape so it prints as a
 *   monospace block.
 */
async function renderFileForPdf(file: { content: string; language?: string }): Promise<string> {
  const lang = (file.language ?? "").toLowerCase()
  const content = file.content
  if (lang === "md" || lang === "markdown") {
    const parsed = await marked.parse(content, { async: true, gfm: true, breaks: true })
    return parsed
  }
  if (lang === "html" || lang === "htm") {
    return content
  }
  if (lang === "csv" || lang === "tsv") {
    const sep = lang === "tsv" ? "\t" : ","
    const rows = content
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .map((line) => line.split(sep))
    if (rows.length === 0) {
      return `<pre>${escapeHtmlForPdf(content)}</pre>`
    }
    const head = rows[0].map((cell) => `<th>${escapeHtmlForPdf(cell)}</th>`).join("")
    const body = rows
      .slice(1)
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${escapeHtmlForPdf(cell)}</td>`).join("")}</tr>`,
      )
      .join("")
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  }
  return `<pre>${escapeHtmlForPdf(content)}</pre>`
}

/**
 * Open a hidden iframe with print-friendly markup of the given file and
 * trigger the browser's "Save as PDF" dialog.
 *
 * Why a hidden iframe + window.print() rather than a JS PDF library:
 *  - **Quality.** Browsers (Chrome, Safari, Firefox) ship a high-quality
 *    HTML→PDF pipeline that handles fonts, page breaks, vector SVG, links,
 *    selectable text, accessibility — for free.
 *  - **No new dependency.** `jspdf` / `pdfmake` would balloon the bundle
 *    by hundreds of kilobytes for output that's strictly worse than the
 *    browser's native one.
 *  - **Privacy.** All conversion is local; nothing is uploaded.
 *
 * The trade-off is one extra click — the system print dialog opens with
 * the destination set, the user picks "Save as PDF" and confirms. We open
 * the dialog automatically and the iframe self-cleans after the browser
 * fires `afterprint`.
 */
/**
 * Comprehensive print stylesheet for PDF export.
 *
 * The agent treats this as a "design system" — utility classes are
 * documented in the system prompt's PDF playbook so the model can opt
 * into rich layouts (cover pages, two-column reports, KPI tiles,
 * callouts, signature blocks, page breaks) without having to invent
 * its own CSS each time.
 *
 * The defaults are tuned for A4 portrait at 11pt body. Everything is
 * overridable: the agent can `<style>@page { size: A4 landscape }</style>`
 * inside its own HTML, or set CSS custom properties on `:root` to retheme
 * the whole document.
 */
const PDF_PRINT_STYLESHEET = `
  /* ---------- Page geometry & defaults ---------- */
  :root {
    --pdf-accent: #4f46e5;
    --pdf-accent-soft: #eef2ff;
    --pdf-text: #111418;
    --pdf-text-muted: #5b6470;
    --pdf-border: #e6e8eb;
    --pdf-surface: #ffffff;
    --pdf-surface-soft: #f7f8fa;
  }
  @page { size: A4; margin: 18mm; }
  @page :first { margin-top: 16mm; }

  html, body {
    background: var(--pdf-surface);
    color: var(--pdf-text);
    margin: 0;
    padding: 0;
  }
  body {
    font: 11pt/1.55 "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  /* ---------- Typography ---------- */
  h1, h2, h3, h4, h5, h6 {
    font-weight: 600;
    color: var(--pdf-text);
    letter-spacing: -0.01em;
    margin: 18pt 0 8pt;
    page-break-after: avoid;
  }
  h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 12pt; letter-spacing: -0.02em; }
  h2 { font-size: 16pt; line-height: 1.25; }
  h3 { font-size: 13pt; line-height: 1.3; }
  h4 { font-size: 11.5pt; line-height: 1.35; }
  h5, h6 { font-size: 10.5pt; text-transform: uppercase; color: var(--pdf-text-muted); letter-spacing: 0.06em; }

  p, li { font-size: 11pt; line-height: 1.55; margin: 0 0 8pt; }
  small { font-size: 9pt; color: var(--pdf-text-muted); }
  strong, b { font-weight: 600; color: var(--pdf-text); }
  em, i { font-style: italic; }
  hr { border: 0; border-top: 1px solid var(--pdf-border); margin: 14pt 0; }

  ul, ol { padding-left: 20pt; margin: 4pt 0 12pt; }
  li { margin: 0 0 4pt; }
  li::marker { color: var(--pdf-text-muted); }

  a { color: var(--pdf-accent); text-decoration: underline; word-break: break-word; }

  blockquote {
    border-left: 3px solid var(--pdf-accent);
    margin: 10pt 0;
    padding: 2pt 12pt;
    color: var(--pdf-text-muted);
    font-style: italic;
    background: var(--pdf-surface-soft);
  }

  /* ---------- Tables ---------- */
  table { border-collapse: collapse; width: 100%; margin: 8pt 0 14pt; font-size: 10pt; }
  thead { background: var(--pdf-surface-soft); }
  th, td { border: 1px solid var(--pdf-border); padding: 6pt 8pt; vertical-align: top; text-align: left; }
  th { font-weight: 600; color: var(--pdf-text); }
  tr { page-break-inside: avoid; }

  /* ---------- Code ---------- */
  pre, code, kbd, samp {
    font-family: ui-monospace, "JetBrains Mono", Menlo, Monaco, "Courier New", monospace;
  }
  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 10pt 12pt;
    border-radius: 4px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 9.5pt;
    line-height: 1.5;
    page-break-inside: avoid;
  }
  code {
    font-size: 10pt;
    background: var(--pdf-surface-soft);
    padding: 1pt 4pt;
    border-radius: 3px;
    color: var(--pdf-accent);
  }
  pre code { background: transparent; color: inherit; padding: 0; }

  /* ---------- Images / SVG ---------- */
  img, svg {
    max-width: 100%;
    height: auto;
    page-break-inside: avoid;
  }
  figure { margin: 10pt 0; }
  figcaption { font-size: 9pt; color: var(--pdf-text-muted); margin-top: 4pt; text-align: center; }

  /* ---------- Utility classes (the design system) ---------- */
  /* Cover page — full-page intro spread (use .pdf-cover then .pdf-page-break). */
  .pdf-cover {
    min-height: calc(100vh - 36mm);
    display: flex;
    flex-direction: column;
    justify-content: center;
    page-break-after: always;
  }
  .pdf-cover .pdf-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 10pt;
    color: var(--pdf-accent);
    font-weight: 600;
    margin-bottom: 16pt;
  }
  .pdf-cover h1 { font-size: 38pt; margin: 0 0 12pt; line-height: 1.1; }
  .pdf-cover .pdf-subtitle {
    font-size: 14pt;
    color: var(--pdf-text-muted);
    max-width: 75%;
    margin: 0 0 24pt;
  }
  .pdf-cover .pdf-meta {
    margin-top: auto;
    color: var(--pdf-text-muted);
    font-size: 10pt;
    border-top: 1px solid var(--pdf-border);
    padding-top: 10pt;
  }

  /* Section header — a stylised banner above big chapters. */
  .pdf-section-header {
    border-top: 4px solid var(--pdf-accent);
    padding-top: 8pt;
    margin: 18pt 0 6pt;
    page-break-after: avoid;
  }
  .pdf-section-header .pdf-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 9pt;
    color: var(--pdf-accent);
    font-weight: 600;
  }
  .pdf-section-header h2 { margin: 4pt 0 0; }

  /* Two-column / three-column responsive grid for the print page. */
  .pdf-grid {
    display: grid;
    gap: 14pt;
    margin: 8pt 0 14pt;
  }
  .pdf-grid-2 { grid-template-columns: 1fr 1fr; }
  .pdf-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
  .pdf-grid-4 { grid-template-columns: repeat(4, 1fr); }
  .pdf-col-span-2 { grid-column: span 2; }
  .pdf-col-span-3 { grid-column: span 3; }

  /* Cards — bordered box with optional accent strip and title. */
  .pdf-card {
    border: 1px solid var(--pdf-border);
    background: var(--pdf-surface);
    border-radius: 6px;
    padding: 12pt 14pt;
    page-break-inside: avoid;
  }
  .pdf-card.pdf-card-accent {
    border-left: 4px solid var(--pdf-accent);
  }
  .pdf-card .pdf-card-title {
    font-size: 11pt;
    font-weight: 600;
    margin: 0 0 6pt;
  }
  .pdf-card .pdf-card-subtitle {
    font-size: 9.5pt;
    color: var(--pdf-text-muted);
    margin: 0 0 8pt;
  }

  /* KPI tile — big number + label, perfect for dashboards. */
  .pdf-kpi {
    border: 1px solid var(--pdf-border);
    border-radius: 6px;
    padding: 12pt 14pt;
    background: var(--pdf-surface-soft);
    page-break-inside: avoid;
  }
  .pdf-kpi .pdf-kpi-value {
    font-size: 24pt;
    font-weight: 700;
    line-height: 1.05;
    color: var(--pdf-text);
    letter-spacing: -0.02em;
  }
  .pdf-kpi .pdf-kpi-label {
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--pdf-text-muted);
    margin-top: 4pt;
  }
  .pdf-kpi .pdf-kpi-delta-up { color: #15803d; font-weight: 600; }
  .pdf-kpi .pdf-kpi-delta-down { color: #b91c1c; font-weight: 600; }

  /* Callouts — info / success / warning / danger / note. */
  .pdf-callout {
    border-radius: 6px;
    padding: 10pt 14pt;
    margin: 10pt 0;
    border-left: 4px solid var(--pdf-accent);
    background: var(--pdf-accent-soft);
    page-break-inside: avoid;
  }
  .pdf-callout .pdf-callout-title { font-weight: 600; margin: 0 0 4pt; }
  .pdf-callout-info    { border-color: #2563eb; background: #eff6ff; }
  .pdf-callout-success { border-color: #16a34a; background: #f0fdf4; }
  .pdf-callout-warning { border-color: #d97706; background: #fffbeb; }
  .pdf-callout-danger  { border-color: #dc2626; background: #fef2f2; }
  .pdf-callout-note    { border-color: #6b7280; background: #f9fafb; }

  /* Signature block — for letters / certificates. */
  .pdf-signature {
    margin-top: 30pt;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30pt;
  }
  .pdf-signature .pdf-signature-line {
    border-top: 1px solid var(--pdf-text);
    padding-top: 4pt;
    font-size: 9pt;
    color: var(--pdf-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  /* Badge — small pill of metadata. */
  .pdf-badge {
    display: inline-block;
    padding: 2pt 8pt;
    border-radius: 999pt;
    font-size: 9pt;
    font-weight: 600;
    background: var(--pdf-surface-soft);
    color: var(--pdf-text-muted);
    border: 1px solid var(--pdf-border);
  }

  /* Page break helpers. */
  .pdf-page-break { page-break-before: always; break-before: page; }
  .pdf-page-break-after { page-break-after: always; break-after: page; }
  .pdf-keep-together { page-break-inside: avoid; break-inside: avoid; }
  .pdf-no-print { display: none !important; }

  /* Header / footer — page-numbered footer via running counter. */
  body { counter-reset: pdfpage; }
  .pdf-page-footer { font-size: 9pt; color: var(--pdf-text-muted); border-top: 1px solid var(--pdf-border); padding-top: 6pt; margin-top: 16pt; }
`

async function downloadAsPdf(file: { path: string; content: string; language?: string }) {
  if (typeof window === "undefined" || typeof document === "undefined") return
  const html = await renderFileForPdf(file)
  const iframe = document.createElement("iframe")
  iframe.setAttribute("aria-hidden", "true")
  iframe.style.cssText =
    "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;"
  document.body.appendChild(iframe)
  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
  }
  const doc = iframe.contentDocument
  if (!doc) {
    cleanup()
    return
  }
  doc.open()
  doc.write(`<!doctype html>
<html><head><meta charset="utf-8" /><title>${escapeHtmlForPdf(fileBasename(file.path) || "document")}</title>
<style>${PDF_PRINT_STYLESHEET}</style>
</head><body>${html}</body></html>`)
  doc.close()
  // Wait for the iframe document to be ready, then print. Chrome/Safari
  // need both `load` and a microtask for embedded `<style>` to apply.
  const win = iframe.contentWindow
  if (!win) {
    cleanup()
    return
  }
  await new Promise<void>((resolve) => {
    if (doc.readyState === "complete") {
      resolve()
    } else {
      iframe.addEventListener("load", () => resolve(), { once: true })
    }
  })
  // Cleanup after print dialog closes (or after a generous timeout).
  win.addEventListener("afterprint", cleanup, { once: true })
  setTimeout(cleanup, 5 * 60 * 1000)
  try {
    win.focus()
    win.print()
  } catch {
    cleanup()
  }
}

/**
 * Module-scope signal for the file the user has opened in the preview
 * drawer. Any `FileArtifactCard` (anywhere in any thread) drives the
 * single drawer instance — exactly one preview open at a time. We keep
 * this OUTSIDE the chat component so the drawer survives re-renders of
 * individual messages.
 */
const [previewFile, setPreviewFile] = createSignal<
  | {
      path: string
      content: string
      language?: string
    }
  | undefined
>()

function FileArtifactCard(props: {
  tool: string
  state?: { status?: string; input?: unknown; output?: unknown; error?: string; title?: string }
}) {
  const language = useLanguage()
  const status = () => props.state?.status ?? "running"
  // Path: codeplane's write/edit/read tools all take `filePath` (or `path`).
  const filePath = () => {
    const input = props.state?.input as { filePath?: string; path?: string } | undefined
    return input?.filePath ?? input?.path ?? ""
  }
  // Content for view/download — for `write`, `state.input.content`; for
  // `read`, `state.output` (string of file contents).
  const fileContent = () => {
    const input = props.state?.input as { content?: string } | undefined
    if (typeof input?.content === "string") return input.content
    const out = props.state?.output
    if (typeof out === "string") return out
    return ""
  }
  const ext = () => fileExtension(filePath())
  const iconName = () => (FILE_ICON_BY_EXT[ext()] ?? "archive") as "archive" | "prompt" | "code" | "photo"
  const verb = () => {
    if (status() === "running") {
      if (props.tool === "write") return language.t("chat.file.tool.writeRunning")
      if (props.tool === "edit") return language.t("chat.file.tool.editRunning")
      return language.t("chat.file.tool.readRunning")
    }
    if (props.tool === "write") return language.t("chat.file.tool.writeDone")
    if (props.tool === "edit") return language.t("chat.file.tool.editDone")
    return language.t("chat.file.tool.readDone")
  }
  const openPreview = () => {
    setPreviewFile({
      path: filePath(),
      content: fileContent(),
      language: ext() || undefined,
    })
  }
  const download = () => {
    const blob = new Blob([fileContent()], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileBasename(filePath()) || "file.txt"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const sizeLabel = () => {
    const c = fileContent()
    if (!c) return ""
    const bytes = new Blob([c]).size
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return (
    <div class="w-full max-w-full bg-surface-base border border-border-weak-base rounded-md overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-2.5">
        <Show
          when={status() === "running"}
          fallback={
            <Show
              when={status() === "error" || !!props.state?.error}
              fallback={
                <div class="size-8 rounded-md bg-surface-raised-base flex items-center justify-center shrink-0">
                  <Icon name={iconName()} size="small" class="text-icon-base" />
                </div>
              }
            >
              <div class="size-8 rounded-md bg-surface-raised-base flex items-center justify-center shrink-0">
                <Icon name="circle-x" size="small" class="text-icon-critical-base" />
              </div>
            </Show>
          }
        >
          <div class="size-8 rounded-md bg-surface-raised-base flex items-center justify-center shrink-0">
            <Spinner class="size-3.5" />
          </div>
        </Show>
        <div class="min-w-0 flex-1">
          <div class="text-13-medium text-text-strong truncate">
            {fileBasename(filePath()) || filePath() || verb()}
          </div>
          <div class="text-12-regular text-text-weak truncate">
            <Show when={status() !== "running"} fallback={verb()}>
              <span>{verb()}</span>
              <Show when={ext()}>
                <span class="text-text-weak"> · </span>
                <span>{ext().toUpperCase()}</span>
              </Show>
              <Show when={sizeLabel()}>
                <span class="text-text-weak"> · </span>
                <span>{sizeLabel()}</span>
              </Show>
            </Show>
          </div>
        </div>
        <Show when={status() !== "running" && !!fileContent()}>
          <Tooltip placement="top" value={language.t("chat.file.preview")}>
            <IconButton
              icon="eye"
              variant="ghost"
              class="size-7 rounded-md shrink-0"
              aria-label={language.t("chat.file.preview")}
              onClick={openPreview}
            />
          </Tooltip>
          <Show when={PDF_EXPORTABLE_EXTENSIONS.has(ext())}>
            <Tooltip placement="top" value={language.t("chat.file.downloadPdf")}>
              <IconButton
                icon="prompt"
                variant="ghost"
                class="size-7 rounded-md shrink-0"
                aria-label={language.t("chat.file.downloadPdf")}
                onClick={() =>
                  void downloadAsPdf({
                    path: filePath(),
                    content: fileContent(),
                    language: ext() || undefined,
                  })
                }
              />
            </Tooltip>
          </Show>
          <Tooltip placement="top" value={language.t("chat.file.download")}>
            <IconButton
              icon="download"
              variant="ghost"
              class="size-7 rounded-md shrink-0"
              aria-label={language.t("chat.file.download")}
              onClick={download}
            />
          </Tooltip>
        </Show>
      </div>
      <Show when={!!props.state?.error}>
        <pre class="mx-3 mb-3 mt-0 text-11-regular text-text-critical-base whitespace-pre-wrap break-words bg-background-base border border-border-weak-base rounded p-2">
          {props.state?.error}
        </pre>
      </Show>
    </div>
  )
}

/**
 * Right-side preview drawer for any file artefact the user has clicked.
 *
 * Lives at module scope (driven by the `previewFile` signal) so the same
 * drawer is reused by every artefact card and only one is open at a time.
 * Renders Markdown via the shared `<Markdown>` so mermaid / KaTeX / chart
 * blocks work inside artefacts too. Other formats fall back to a fenced
 * code block so syntax highlighting still applies (CSV, JSON, HTML
 * source, etc.).
 */
function FilePreviewDrawer() {
  const language = useLanguage()
  const file = previewFile
  const close = () => setPreviewFile(undefined)
  const isMarkdown = () => {
    const lang = file()?.language
    return lang === "md" || lang === "markdown"
  }
  const downloadCurrent = () => {
    const f = file()
    if (!f) return
    const blob = new Blob([f.content], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileBasename(f.path) || "file.txt"
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Show when={file()}>
      {/* Backdrop — clicking dismisses. */}
      <div
        class="fixed inset-0 z-40 bg-background-base/60"
        onClick={close}
        aria-hidden="true"
      />
      {/* Drawer panel — slides in from the right. */}
      <aside
        class="fixed right-0 top-0 bottom-0 z-50 w-full md:w-[640px] bg-background-base border-l border-border-weak-base flex flex-col min-h-0"
        role="dialog"
        aria-label={language.t("chat.file.preview")}
      >
        <header class="shrink-0 h-12 px-3 flex items-center justify-between gap-2 border-b border-border-weak-base">
          <div class="min-w-0 flex items-center gap-2">
            <Icon name="prompt" size="small" class="text-icon-base shrink-0" />
            <div class="min-w-0">
              <div class="text-13-medium text-text-strong truncate">
                {fileBasename(file()!.path)}
              </div>
              <div class="text-11-regular text-text-weak truncate">{file()!.path}</div>
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-0.5">
            <Show when={PDF_EXPORTABLE_EXTENSIONS.has((file()!.language ?? "").toLowerCase())}>
              <Tooltip placement="bottom" value={language.t("chat.file.downloadPdf")}>
                <IconButton
                  icon="prompt"
                  variant="ghost"
                  class="size-7 rounded-md"
                  aria-label={language.t("chat.file.downloadPdf")}
                  onClick={() => {
                    const f = file()
                    if (!f) return
                    void downloadAsPdf(f)
                  }}
                />
              </Tooltip>
            </Show>
            <Tooltip placement="bottom" value={language.t("chat.file.download")}>
              <IconButton
                icon="download"
                variant="ghost"
                class="size-7 rounded-md"
                aria-label={language.t("chat.file.download")}
                onClick={downloadCurrent}
              />
            </Tooltip>
            <Tooltip placement="bottom" value={language.t("chat.file.previewClose")}>
              <IconButton
                icon="close"
                variant="ghost"
                class="size-7 rounded-md"
                aria-label={language.t("chat.file.previewClose")}
                onClick={close}
              />
            </Tooltip>
          </div>
        </header>
        <div class="flex-1 min-h-0 overflow-y-auto p-4">
          <Show
            when={isMarkdown()}
            fallback={
              <Markdown
                text={`\`\`\`${file()!.language ?? ""}\n${file()!.content}\n\`\`\``}
              />
            }
          >
            <div class="text-14-regular text-text-strong">
              <Markdown text={coerceMermaidLanguage(file()!.content)} />
            </div>
          </Show>
        </div>
      </aside>
    </Show>
  )
}

/**
 * Inline tool-call card shown when the assistant emits a `<memory>` block.
 * Mimics the way ChatGPT shows tool invocations: a compact, distinct card
 * with the tool name, the saved title, and a preview of the content.
 */
/**
 * Inline tool-call card for the `save_to_memory` agent tool.
 *
 * The agent emits a `<memory title="…">…</memory>` block at the end of its
 * reply when it decides to persist a long-term fact about the user. We
 * surface that as a tool-call-style card with the same visual language as
 * the codeplane tool cards: an icon, a "ran" status row, a body, and an
 * action button (Forget) so the user can immediately undo a save they
 * disagree with — all without leaving the chat.
 *
 * The card looks up the actual persisted memory entry by `(title, content)`
 * so it can offer the Forget action; if nothing matches (the entry was
 * already removed from the memory dialog), the card hides the button and
 * shows "removed" state instead.
 */
function MemoryCard(props: { title: string; content: string }) {
  const language = useLanguage()
  const chat = useChat()
  const dupKey = (title: string, content: string) =>
    `${title.trim().toLowerCase()} ${content.trim()}`
  const target = createMemo(() => {
    const key = dupKey(props.title, props.content)
    return chat.store.memory.find((m) => dupKey(m.title, m.content) === key)
  })
  const forgotten = () => !target()
  const forget = () => {
    const entry = target()
    if (!entry) return
    chat.removeMemoryEntry(entry.id)
  }
  return (
    <div class="w-full max-w-full bg-surface-base border border-border-weak-base rounded-md overflow-hidden">
      {/* Header row — matches ToolCallCard so memory saves read as a real
          tool call, just with the brain icon. */}
      <div class="flex items-center gap-2 px-3 py-2">
        <Icon
          name={forgotten() ? "circle-x" : "brain"}
          size="small"
          class={forgotten() ? "text-icon-weak shrink-0" : "text-icon-base shrink-0"}
        />
        <div class="min-w-0 flex-1">
          <div class="text-12-medium text-text-strong">
            {forgotten()
              ? language.t("chat.message.memoryForgotten")
              : language.t("chat.message.memoryToolUsed")}
          </div>
          <Show when={props.title}>
            <div class="text-12-regular text-text-weak truncate">{props.title}</div>
          </Show>
        </div>
        <Show when={!forgotten()}>
          <Tooltip placement="top" value={language.t("chat.message.memoryForget")}>
            <IconButton
              icon="archive"
              variant="ghost"
              class="size-6 rounded-md shrink-0"
              aria-label={language.t("chat.message.memoryForget")}
              onClick={forget}
            />
          </Tooltip>
        </Show>
      </div>
      {/* Body — the saved content, dim-strikethrough when forgotten so the
          user can still see what they removed. */}
      <Show when={props.content}>
        <div
          class="px-3 pb-2 text-12-regular text-text-base whitespace-pre-wrap break-words"
          classList={{
            "line-through opacity-60": forgotten(),
          }}
        >
          {props.content}
        </div>
      </Show>
    </div>
  )
}

