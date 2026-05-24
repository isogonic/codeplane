import { describe, test } from "bun:test"
import { withHarness } from "../harness"
import { For, Show } from "solid-js"
import { splitMarkdownBlocks, _internalsForTesting } from "@/tui/component/rich-block"

const { sparklineString, formatCurrency, stripInline } = _internalsForTesting()

function tryParse<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}

// Compact one-block-per-screen renderer used to capture readable terminal
// frames for visual inspection in CI logs.

function ChartFx(p: { code: string }) {
  const cfg = tryParse<{ title?: string; data?: number[]; series?: Array<{ data?: number[]; name?: string }> }>(p.code)
  const series = cfg?.series ?? (cfg?.data ? [{ name: "value", data: cfg.data }] : [])
  return (
    <box flexDirection="column">
      <text>┌─ {cfg?.title ?? "chart"} ─────────────────────────────</text>
      <For each={series}>
        {(s) => (
          <box flexDirection="column">
            <text>│ {s.name ?? "value"}</text>
            <text>│ {sparklineString(s.data ?? [], 60)}</text>
          </box>
        )}
      </For>
      <text>└──────────────────────────────────────────────────────</text>
    </box>
  )
}

function StockFx(p: { code: string }) {
  const cfg = tryParse<{ ticker?: string; name?: string; price?: number; change?: number; changePercent?: number; history?: number[]; asOf?: string }>(p.code)
  if (!cfg) return null
  const arrow = (cfg.change ?? 0) >= 0 ? "▲" : "▼"
  const sign = (cfg.change ?? 0) >= 0 ? "+" : ""
  return (
    <box flexDirection="column">
      <text>┌─ {cfg.ticker?.toUpperCase()} {cfg.name ? `· ${cfg.name}` : ""} ─</text>
      <text>│ {formatCurrency(Number(cfg.price ?? 0))}  {arrow} {sign}{(cfg.change ?? 0).toFixed(2)} ({sign}{(cfg.changePercent ?? 0).toFixed(2)}%)</text>
      <Show when={(cfg.history ?? []).length >= 2}>
        <text>│ {sparklineString(cfg.history!, 60)}</text>
      </Show>
      <Show when={cfg.asOf}>
        <text>│ As of {cfg.asOf}</text>
      </Show>
      <text>└──────────────────────────────────────────────────────</text>
    </box>
  )
}

function CalloutFx(p: { code: string; variant: string }) {
  const icons: Record<string, string> = { info: "ℹ", tip: "✦", warning: "⚠", danger: "✕", success: "✓" }
  return (
    <box flexDirection="column">
      <text>┌─ {icons[p.variant] ?? "•"} {p.variant.toUpperCase()} ─</text>
      <text>│ {stripInline(p.code.trim())}</text>
      <text>└──────────────────────────────────────────────────────</text>
    </box>
  )
}

function KpiFx(p: { code: string }) {
  const tiles = tryParse<Array<{ label?: string; value?: number; deltaPercent?: number; history?: number[] }>>(p.code) ?? []
  return (
    <box flexDirection="row" gap={2}>
      <For each={tiles}>
        {(t) => (
          <box flexDirection="column" minWidth={20}>
            <text>┌──────────────────</text>
            <text>│ {(t.label ?? "").toUpperCase()}</text>
            <text>│ {t.value} {t.deltaPercent !== undefined ? `${t.deltaPercent > 0 ? "+" : ""}${t.deltaPercent}%` : ""}</text>
            <Show when={(t.history ?? []).length >= 2}>
              <text>│ {sparklineString(t.history!, 16)}</text>
            </Show>
            <text>└──────────────────</text>
          </box>
        )}
      </For>
    </box>
  )
}

function ChoiceFx(p: { code: string; multi: boolean }) {
  const cfg = tryParse<{ question?: string; options?: Array<{ label?: string; hint?: string }>; default?: string | string[] }>(p.code)
  if (!cfg) return null
  const defaults = new Set<string>(Array.isArray(cfg.default) ? cfg.default : cfg.default ? [String(cfg.default)] : [])
  return (
    <box flexDirection="column">
      <text>{cfg.question ?? ""}</text>
      <For each={cfg.options ?? []}>
        {(opt) => {
          const checked = defaults.has(opt.label ?? "")
          const m = p.multi ? (checked ? "[✓]" : "[ ]") : checked ? "●" : "○"
          return (
            <box flexDirection="column">
              <text>{m} {opt.label}</text>
              <Show when={opt.hint}>
                <text>    {opt.hint}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function ProgressFx(p: { code: string }) {
  const bars = tryParse<Array<{ label?: string; value?: number; max?: number; hint?: string }>>(p.code) ?? []
  return (
    <box flexDirection="column">
      <For each={bars}>
        {(b) => {
          const max = b.max ?? 100
          const pct = max > 0 ? ((b.value ?? 0) / max) * 100 : 0
          const f = Math.round((pct / 100) * 30)
          return (
            <box flexDirection="column">
              <text>{b.label}  {pct.toFixed(0)}%</text>
              <text>{"█".repeat(f) + "░".repeat(30 - f)}</text>
              <Show when={b.hint}>
                <text>{b.hint}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function TimelineFx(p: { code: string }) {
  const events = tryParse<Array<{ time?: string; title?: string; status?: string; description?: string }>>(p.code) ?? []
  return (
    <box flexDirection="column">
      <For each={events}>
        {(e) => {
          const m = e.status === "current" ? "◉" : e.status === "failed" ? "✕" : e.status === "pending" ? "○" : "●"
          return (
            <box flexDirection="column">
              <text>{m} {e.time ?? ""}  {e.title}</text>
              <Show when={e.description}>
                <text>│  {stripInline(e.description!)}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function FileTreeFx(p: { code: string }) {
  type Node = { name?: string; children?: Node[]; status?: string; hint?: string }
  const root = tryParse<Node[]>(p.code) ?? []
  const lines: string[] = []
  const walk = (nodes: Node[], prefix: string) => {
    nodes.forEach((n, i) => {
      const last = i === nodes.length - 1
      const isFolder = Array.isArray(n.children) && n.children.length > 0
      const sigil = isFolder ? "▾" : "·"
      const status = n.status ? `  [${n.status[0]?.toUpperCase()}]` : ""
      lines.push(prefix + (last ? "└─ " : "├─ ") + sigil + " " + (n.name ?? "") + status)
      if (n.children) walk(n.children, prefix + (last ? "   " : "│  "))
    })
  }
  walk(root, "")
  return (
    <box flexDirection="column">
      <For each={lines}>{(line) => <text>{line}</text>}</For>
    </box>
  )
}

function BadgeFx(p: { code: string }) {
  const items = tryParse<Array<{ label?: string }>>(p.code) ?? []
  return (
    <text>
      <For each={items}>{(b, i) => <span>{i() > 0 ? " " : ""}[{b.label ?? ""}]</span>}</For>
    </text>
  )
}

function QuoteFx(p: { code: string }) {
  const cfg = tryParse<{ text?: string; author?: string; role?: string }>(p.code)
  if (!cfg) return null
  return (
    <box flexDirection="column">
      <text>❝ {stripInline(cfg.text ?? "")}</text>
      <Show when={cfg.author || cfg.role}>
        <text>  — {cfg.author}{cfg.role ? `, ${cfg.role}` : ""}</text>
      </Show>
    </box>
  )
}

function PreviewFx(p: { code: string }) {
  const cfg = tryParse<{ title?: string; description?: string; url?: string; site?: string }>(p.code)
  if (!cfg) return null
  return (
    <box flexDirection="column">
      <Show when={cfg.site}>
        <text>{cfg.site}</text>
      </Show>
      <text>{cfg.title}</text>
      <Show when={cfg.description}>
        <text>{cfg.description}</text>
      </Show>
      <text>→ {cfg.url}</text>
    </box>
  )
}

function ComparisonFx(p: { code: string }) {
  const cfg = tryParse<{ title?: string; before?: { content?: string; label?: string }; after?: { content?: string; label?: string } }>(p.code)
  if (!cfg) return null
  return (
    <box flexDirection="column">
      <Show when={cfg.title}>
        <text>{cfg.title}</text>
      </Show>
      <box flexDirection="row" gap={3}>
        <box flexDirection="column" flexBasis={36}>
          <text>{(cfg.before?.label ?? "Before").toUpperCase()}</text>
          <text>{stripInline(cfg.before?.content ?? "")}</text>
        </box>
        <box flexDirection="column" flexBasis={36}>
          <text>{(cfg.after?.label ?? "After").toUpperCase()}</text>
          <text>{stripInline(cfg.after?.content ?? "")}</text>
        </box>
      </box>
    </box>
  )
}

function DiffFx(p: { code: string }) {
  const lines = p.code.split("\n")
  let add = 0, del = 0
  for (const l of lines) {
    if (l.startsWith("+++") || l.startsWith("---")) continue
    if (l.startsWith("+")) add++
    else if (l.startsWith("-")) del++
  }
  return (
    <box flexDirection="column">
      <text>+{add}  −{del}</text>
      <For each={lines}>{(line) => <text>{line}</text>}</For>
    </box>
  )
}

function TabsFx(p: { code: string }) {
  const cfg = tryParse<{ tabs?: Array<{ label?: string; content?: string }> }>(p.code)
  const tabs = cfg?.tabs ?? []
  return (
    <box flexDirection="column">
      <text>
        <For each={tabs}>
          {(t, i) => <span>{i() === 0 ? `▸ ${t.label}` : `  ${t.label}`}  </span>}
        </For>
      </text>
      <text>{"─".repeat(60)}</text>
      <text>{stripInline(tabs[0]?.content ?? "")}</text>
    </box>
  )
}

function StaticDispatch(props: { lang: string; code: string }) {
  switch (props.lang) {
    case "chart":
      return <ChartFx code={props.code} />
    case "stock":
      return <StockFx code={props.code} />
    case "kpi":
      return <KpiFx code={props.code} />
    case "info":
    case "tip":
    case "warning":
    case "danger":
    case "success":
      return <CalloutFx code={props.code} variant={props.lang} />
    case "choice":
      return <ChoiceFx code={props.code} multi={false} />
    case "select":
      return <ChoiceFx code={props.code} multi={true} />
    case "progress":
      return <ProgressFx code={props.code} />
    case "timeline":
      return <TimelineFx code={props.code} />
    case "file-tree":
      return <FileTreeFx code={props.code} />
    case "badge":
      return <BadgeFx code={props.code} />
    case "quote":
      return <QuoteFx code={props.code} />
    case "preview":
      return <PreviewFx code={props.code} />
    case "comparison":
      return <ComparisonFx code={props.code} />
    case "diff":
      return <DiffFx code={props.code} />
    case "tabs":
      return <TabsFx code={props.code} />
    default:
      return <text>{props.lang}</text>
  }
}

function RenderFixture(props: { md: string }) {
  const segs = splitMarkdownBlocks(props.md)
  return (
    <box flexDirection="column" padding={1}>
      <For each={segs}>
        {(seg) =>
          seg.kind === "markdown" ? (
            <Show when={seg.text.trim()}>
              <text>{seg.text.trim()}</text>
            </Show>
          ) : (
            <StaticDispatch lang={seg.lang} code={seg.code} />
          )
        }
      </For>
    </box>
  )
}

const samples: Array<{ name: string; md: string }> = [
  {
    name: "chart",
    md: ['```chart', JSON.stringify({ title: "Revenue", data: [120, 135, 128, 142, 156, 168, 175, 190, 198, 210] }), "```"].join("\n"),
  },
  {
    name: "stock",
    md: ['```stock', JSON.stringify({
      ticker: "AAPL", name: "Apple Inc.", price: 184.92, change: 2.34, changePercent: 1.28,
      history: [180, 182, 181, 183, 184, 185, 184.92], asOf: "May 5, 2026",
    }), '```'].join("\n"),
  },
  {
    name: "kpi",
    md: ['```kpi', JSON.stringify([
      { label: "Active users", value: 12840, deltaPercent: 11.1, history: [10, 11, 11, 12, 12, 13] },
      { label: "Errors", value: 4, deltaPercent: -50, history: [10, 8, 9, 7, 5, 4] },
      { label: "Latency", value: "84ms", deltaPercent: -6.7 },
    ]), "```"].join("\n"),
  },
  {
    name: "callout warning",
    md: ['```warning', "Be careful with this destructive operation.", "```"].join("\n"),
  },
  {
    name: "choice",
    md: ['```choice', JSON.stringify({
      question: "Pick a deployment target",
      options: [
        { label: "Cloudflare Workers", hint: "Edge runtime, fastest cold start" },
        { label: "AWS Lambda", hint: "Mature ecosystem" },
        { label: "Self-hosted", hint: "Full control" },
      ],
      default: "Cloudflare Workers",
    }), "```"].join("\n"),
  },
  {
    name: "select",
    md: ['```select', JSON.stringify({
      question: "Which integrations do you need?",
      options: [{ label: "GitHub" }, { label: "Slack" }, { label: "Linear" }, { label: "PagerDuty" }],
      default: ["GitHub", "Slack"],
    }), "```"].join("\n"),
  },
  {
    name: "progress",
    md: ['```progress', JSON.stringify([
      { label: "Database migration", value: 86, hint: "Estimated 2 minutes remaining" },
      { label: "Cache warmup", value: 100, hint: "Done" },
      { label: "Disk usage", value: 88, hint: "Approaching capacity" },
    ]), "```"].join("\n"),
  },
  {
    name: "timeline",
    md: ['```timeline', JSON.stringify([
      { time: "09:14", title: "Deployment to production", description: "Release v1.4.2 rolled out to us-east-1.", status: "done" },
      { time: "09:11", title: "Smoke tests", description: "All 248 tests passed in 92s.", status: "done" },
      { time: "09:09", title: "Build artefact", description: "Image app:c0ffee pushed to registry.", status: "current" },
      { time: "09:00", title: "Canary", status: "pending" },
      { time: "08:42", title: "Migration check", status: "failed" },
    ]), "```"].join("\n"),
  },
  {
    name: "file-tree",
    md: ['```file-tree', JSON.stringify([
      { name: "packages/ui", children: [
        { name: "src/components", children: [
          { name: "markdown.tsx", status: "modified" },
          { name: "markdown-blocks.ts", status: "added", hint: "rich blocks" },
        ]},
      ]},
    ]), "```"].join("\n"),
  },
  {
    name: "badge",
    md: ['```badge', JSON.stringify([
      { label: "v1.4.2" }, { label: "stable" }, { label: "beta" }, { label: "deprecated" },
    ]), "```"].join("\n"),
  },
  {
    name: "quote",
    md: ['```quote', JSON.stringify({ text: "Software is a gas — it expands to fill its container.", author: "Nathan Myhrvold", role: "Former CTO, Microsoft" }), "```"].join("\n"),
  },
  {
    name: "preview",
    md: ['```preview', JSON.stringify({
      url: "https://example.com/docs/markdown-blocks",
      title: "Markdown rich-block reference",
      description: "Charts, stocks, tabs, callouts, KPIs and more — all renderable inline.",
      site: "Codeplane Docs",
    }), "```"].join("\n"),
  },
  {
    name: "comparison",
    md: ['```comparison', JSON.stringify({
      title: "Renderer pipeline",
      before: { label: "Before", content: "Plain code blocks, mermaid, math." },
      after: { label: "After", content: "Charts, stocks, KPIs, tabs, choice, callouts, timelines, quotes, file trees, comparisons, diffs." },
    }), "```"].join("\n"),
  },
  {
    name: "diff",
    md: ['```diff',
      "--- a/src/server.ts",
      "+++ b/src/server.ts",
      "@@ -12,7 +12,9 @@",
      " function start(port: number) {",
      "-  app.listen(port)",
      "+  app.listen(port, () => {",
      "+    console.log(`listening on :${port}`)",
      "+  })",
      " }",
      "```",
    ].join("\n"),
  },
  {
    name: "tabs",
    md: ['```tabs', JSON.stringify({
      tabs: [
        { label: "Setup", content: "Install with npm install and create a config." },
        { label: "Run", content: "Start the dev server: npm run dev." },
        { label: "Notes", content: "See the docs for advanced options." },
      ],
    }), "```"].join("\n"),
  },
]

describe("tui rich-block visual snapshots", () => {
  for (const sample of samples) {
    test(`renders ${sample.name}`, async () => {
      await withHarness(() => <RenderFixture md={sample.md} />, async (h) => {
        const text = h.frame().text
        // Print the captured frame so it's visible in test logs for visual review.
        const trimmed = text
          .split("\n")
          .map((l) => l.trimEnd())
          .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1]?.length))
          .slice(0, 18)
          .join("\n")
        console.log(`\n── ${sample.name} ──\n${trimmed}\n`)
      }, { width: 80, height: 24 })
    })
  }
})
