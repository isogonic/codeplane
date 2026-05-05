import { describe, expect, test } from "bun:test"
import { withHarness } from "../harness"
import { For, Show } from "solid-js"
import { splitMarkdownBlocks, _internalsForTesting } from "@/tui/component/rich-block"

const { sparklineString, formatNumber, formatCurrency, stripInline } = _internalsForTesting()

// Lightweight rendering harness that mirrors RichBlockText structure but
// uses static colour strings instead of pulling from useTheme(). Lets us
// confirm the segment splitter + child layouts render real frames in the
// opentui test renderer without booting the full TUI provider chain.

function StaticBox(props: { lang: string; code: string }) {
  switch (props.lang) {
    case "chart":
      return <ChartFixture code={props.code} />
    case "stock":
      return <StockFixture code={props.code} />
    case "kpi":
      return <KpiFixture code={props.code} />
    case "callout":
    case "info":
    case "tip":
    case "warning":
    case "danger":
    case "success":
      return <CalloutFixture code={props.code} variant={props.lang} />
    case "tabs":
      return <TabsFixture code={props.code} />
    case "choice":
      return <ChoiceFixture code={props.code} multi={false} />
    case "select":
      return <ChoiceFixture code={props.code} multi={true} />
    case "badge":
      return <BadgeFixture code={props.code} />
    case "progress":
      return <ProgressFixture code={props.code} />
    case "timeline":
      return <TimelineFixture code={props.code} />
    case "quote":
      return <QuoteFixture code={props.code} />
    case "table":
      return <TableFixture code={props.code} />
    case "file-tree":
    case "tree":
      return <FileTreeFixture code={props.code} />
    case "comparison":
      return <ComparisonFixture code={props.code} />
    case "diff":
      return <DiffFixture code={props.code} />
    case "preview":
      return <PreviewFixture code={props.code} />
    default:
      return <text>UNKNOWN: {props.lang}</text>
  }
}

function tryParse<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function ChartFixture(props: { code: string }) {
  const cfg = tryParse<{ title?: string; data?: number[]; series?: Array<{ data?: number[] }> }>(props.code)
  if (!cfg) return <text>chart parse error</text>
  const data = cfg.data ?? cfg.series?.[0]?.data ?? []
  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={cfg.title}>
        <text>{cfg.title}</text>
      </Show>
      <text>{sparklineString(data, 60)}</text>
    </box>
  )
}

function StockFixture(props: { code: string }) {
  const cfg = tryParse<{ ticker?: string; name?: string; price?: number; change?: number; history?: number[] }>(
    props.code,
  )
  if (!cfg) return <text>stock parse error</text>
  const arrow = (cfg.change ?? 0) >= 0 ? "▲" : "▼"
  return (
    <box flexDirection="column" marginTop={1}>
      <text>{cfg.ticker?.toUpperCase()} {cfg.name}</text>
      <text>
        {formatCurrency(Number(cfg.price ?? 0))} {arrow} {(cfg.change ?? 0).toFixed(2)}
      </text>
      <Show when={(cfg.history ?? []).length >= 2}>
        <text>{sparklineString(cfg.history!, 60)}</text>
      </Show>
    </box>
  )
}

function KpiFixture(props: { code: string }) {
  const tiles = tryParse<Array<{ label?: string; value?: number; deltaPercent?: number }>>(props.code) ?? []
  return (
    <box flexDirection="row" marginTop={1} gap={2}>
      <For each={tiles}>
        {(t) => (
          <box flexDirection="column">
            <text>{t.label?.toUpperCase()}</text>
            <text>{typeof t.value === "number" ? formatNumber(t.value) : ""} {t.deltaPercent !== undefined ? `${t.deltaPercent > 0 ? "+" : ""}${t.deltaPercent}%` : ""}</text>
          </box>
        )}
      </For>
    </box>
  )
}

function CalloutFixture(props: { code: string; variant: string }) {
  const icons: Record<string, string> = {
    info: "ℹ",
    callout: "ℹ",
    tip: "✦",
    warning: "⚠",
    danger: "✕",
    success: "✓",
  }
  return (
    <box flexDirection="column" marginTop={1}>
      <text>
        {icons[props.variant] ?? "•"} {props.variant.toUpperCase()}
      </text>
      <text>{stripInline(props.code.trim())}</text>
    </box>
  )
}

function TabsFixture(props: { code: string }) {
  const cfg = tryParse<{ tabs?: Array<{ label?: string; content?: string }> }>(props.code)
  if (!cfg) return <text>tabs parse error</text>
  const tabs = cfg.tabs ?? []
  return (
    <box flexDirection="column" marginTop={1}>
      <text>
        <For each={tabs}>{(t) => <span>[{t.label ?? ""}] </span>}</For>
      </text>
      <text>{stripInline(tabs[0]?.content ?? "")}</text>
    </box>
  )
}

function ChoiceFixture(props: { code: string; multi: boolean }) {
  const cfg = tryParse<{ question?: string; options?: Array<{ label?: string }>; default?: string | string[] }>(
    props.code,
  )
  if (!cfg) return <text>choice parse error</text>
  const defaults = new Set<string>(
    Array.isArray(cfg.default) ? cfg.default : cfg.default !== undefined ? [String(cfg.default)] : [],
  )
  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={cfg.question}>
        <text>{cfg.question}</text>
      </Show>
      <For each={cfg.options ?? []}>
        {(opt) => {
          const checked = defaults.has(opt.label ?? "")
          const marker = props.multi ? (checked ? "[✓]" : "[ ]") : checked ? "●" : "○"
          return <text>{marker} {opt.label}</text>
        }}
      </For>
    </box>
  )
}

function BadgeFixture(props: { code: string }) {
  const items = tryParse<Array<{ label?: string }>>(props.code) ?? []
  return (
    <text>
      <For each={items}>{(b, i) => <span>{i() > 0 ? " " : ""}[{b.label ?? ""}]</span>}</For>
    </text>
  )
}

function ProgressFixture(props: { code: string }) {
  const bars = tryParse<Array<{ label?: string; value?: number; max?: number }>>(props.code) ?? []
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={bars}>
        {(bar) => {
          const max = bar.max ?? 100
          const pct = max > 0 ? ((bar.value ?? 0) / max) * 100 : 0
          const fillCount = Math.round(pct / 5)
          const fill = "█".repeat(fillCount) + "░".repeat(20 - fillCount)
          return <text>{bar.label} {fill} {pct.toFixed(0)}%</text>
        }}
      </For>
    </box>
  )
}

function TimelineFixture(props: { code: string }) {
  const events = tryParse<Array<{ title?: string; status?: string }>>(props.code) ?? []
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={events}>
        {(evt) => {
          const m = evt.status === "current" ? "◉" : evt.status === "failed" ? "✕" : evt.status === "pending" ? "○" : "●"
          return <text>{m} {evt.title}</text>
        }}
      </For>
    </box>
  )
}

function QuoteFixture(props: { code: string }) {
  const cfg = tryParse<{ text?: string; author?: string }>(props.code)
  if (!cfg) return <text>quote parse error</text>
  return (
    <box flexDirection="column" marginTop={1}>
      <text>❝ {stripInline(cfg.text ?? "")}</text>
      <Show when={cfg.author}>
        <text>— {cfg.author}</text>
      </Show>
    </box>
  )
}

function TableFixture(props: { code: string }) {
  const cfg = tryParse<{ caption?: string; columns?: Array<{ key?: string; label?: string }>; rows?: Array<Record<string, unknown>> }>(props.code)
  if (!cfg) return <text>table parse error</text>
  const cols = cfg.columns ?? []
  const rows = cfg.rows ?? []
  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={cfg.caption}>
        <text>{cfg.caption}</text>
      </Show>
      <text>
        <For each={cols}>{(c) => <span>{(c.label ?? c.key ?? "").toUpperCase()}  </span>}</For>
      </text>
      <For each={rows}>
        {(row) => (
          <text>
            <For each={cols}>{(c) => <span>{String((row as Record<string, unknown>)[c.key ?? ""] ?? "")}  </span>}</For>
          </text>
        )}
      </For>
    </box>
  )
}

function FileTreeFixture(props: { code: string }) {
  type Node = { name?: string; children?: Node[]; status?: string }
  const root = (tryParse<Node[]>(props.code) ?? []) as Node[]
  const lines: string[] = []
  const walk = (nodes: Node[], prefix: string) => {
    nodes.forEach((n, i) => {
      const isLast = i === nodes.length - 1
      lines.push(prefix + (isLast ? "└─ " : "├─ ") + (n.name ?? "") + (n.status ? `  [${n.status[0]?.toUpperCase()}]` : ""))
      if (Array.isArray(n.children)) walk(n.children, prefix + (isLast ? "   " : "│  "))
    })
  }
  walk(root, "")
  return (
    <box flexDirection="column" marginTop={1}>
      <For each={lines}>{(line) => <text>{line}</text>}</For>
    </box>
  )
}

function ComparisonFixture(props: { code: string }) {
  const cfg = tryParse<{ title?: string; before?: { content?: string; label?: string }; after?: { content?: string; label?: string } }>(
    props.code,
  )
  if (!cfg) return <text>comparison parse error</text>
  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={cfg.title}>
        <text>{cfg.title}</text>
      </Show>
      <text>
        {(cfg.before?.label ?? "Before").toUpperCase()}: {stripInline(cfg.before?.content ?? "")}
      </text>
      <text>
        {(cfg.after?.label ?? "After").toUpperCase()}: {stripInline(cfg.after?.content ?? "")}
      </text>
    </box>
  )
}

function DiffFixture(props: { code: string }) {
  const lines = props.code.split("\n")
  let add = 0
  let del = 0
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) add++
    else if (line.startsWith("-")) del++
  }
  return (
    <box flexDirection="column" marginTop={1}>
      <text>+{add} −{del}</text>
      <For each={lines}>{(line) => <text>{line}</text>}</For>
    </box>
  )
}

function PreviewFixture(props: { code: string }) {
  const cfg = tryParse<{ title?: string; description?: string; url?: string }>(props.code)
  if (!cfg) return <text>preview parse error</text>
  return (
    <box flexDirection="column" marginTop={1}>
      <Show when={cfg.title}>
        <text>{cfg.title}</text>
      </Show>
      <Show when={cfg.description}>
        <text>{cfg.description}</text>
      </Show>
      <text>{cfg.url}</text>
    </box>
  )
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
            <StaticBox lang={seg.lang} code={seg.code} />
          )
        }
      </For>
    </box>
  )
}

describe("tui rich-block render fixtures", () => {
  test("chart renders sparkline characters", async () => {
    const md = ['```chart', JSON.stringify({ title: "Revenue", data: [10, 20, 15, 30, 28, 35] }), "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/Revenue/)
      expect(/[▁▂▃▄▅▆▇█]/.test(text)).toBe(true)
    })
  })

  test("stock renders ticker, price, sparkline", async () => {
    const md = [
      "```stock",
      JSON.stringify({ ticker: "AAPL", name: "Apple Inc.", price: 184.92, change: 2.34, history: [180, 182, 184, 185] }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/AAPL/)
      expect(text).toMatch(/Apple Inc/)
      expect(text).toMatch(/▲/)
    })
  })

  test("kpi tiles render labels and values", async () => {
    const md = [
      "```kpi",
      JSON.stringify([
        { label: "Users", value: 12840, deltaPercent: 11.1 },
        { label: "Errors", value: 4, deltaPercent: -50 },
      ]),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/USERS/)
      expect(text).toMatch(/12.8k/)
      expect(text).toMatch(/ERRORS/)
    })
  })

  test("callout renders icon and body", async () => {
    const md = ["```warning", "Heads up.", "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/⚠/)
      expect(text).toMatch(/WARNING/)
      expect(text).toMatch(/Heads up/)
    })
  })

  test("choice renders radio markers", async () => {
    const md = [
      "```choice",
      JSON.stringify({ question: "Pick one", options: [{ label: "Yes" }, { label: "No" }], default: "Yes" }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/Pick one/)
      expect(text).toMatch(/●/)
      expect(text).toMatch(/○/)
    })
  })

  test("select renders checkbox markers", async () => {
    const md = [
      "```select",
      JSON.stringify({ options: [{ label: "A" }, { label: "B" }], default: ["A"] }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/\[✓\]/)
      expect(text).toMatch(/\[ \]/)
    })
  })

  test("progress bar renders block characters and percent", async () => {
    const md = ["```progress", JSON.stringify([{ label: "Build", value: 75 }]), "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/Build/)
      expect(text).toMatch(/75%/)
      expect(/[█░]/.test(text)).toBe(true)
    })
  })

  test("timeline shows status markers", async () => {
    const md = [
      "```timeline",
      JSON.stringify([
        { title: "Done step", status: "done" },
        { title: "Running step", status: "current" },
        { title: "Failed step", status: "failed" },
      ]),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/●/)
      expect(text).toMatch(/◉/)
      expect(text).toMatch(/✕/)
    })
  })

  test("quote shows quote mark + author", async () => {
    const md = ['```quote', JSON.stringify({ text: "Hello world.", author: "Author" }), "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/❝/)
      expect(text).toMatch(/Hello world/)
      expect(text).toMatch(/Author/)
    })
  })

  test("table renders headers and rows", async () => {
    const md = [
      "```table",
      JSON.stringify({
        caption: "Sales",
        columns: [
          { key: "region", label: "Region" },
          { key: "amount", label: "Amount" },
        ],
        rows: [
          { region: "EMEA", amount: 100 },
          { region: "APAC", amount: 200 },
        ],
      }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/Sales/)
      expect(text).toMatch(/REGION/)
      expect(text).toMatch(/AMOUNT/)
      expect(text).toMatch(/EMEA/)
    })
  })

  test("file-tree renders branch chars and status", async () => {
    const md = [
      "```file-tree",
      JSON.stringify([
        { name: "src", children: [{ name: "main.ts", status: "modified" }, { name: "new.ts", status: "added" }] },
      ]),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/src/)
      expect(text).toMatch(/main\.ts/)
      expect(/[├└─]/.test(text)).toBe(true)
    })
  })

  test("comparison renders both sides", async () => {
    const md = [
      "```comparison",
      JSON.stringify({ title: "T", before: { content: "Old" }, after: { content: "New" } }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/BEFORE/)
      expect(text).toMatch(/AFTER/)
      expect(text).toMatch(/Old/)
      expect(text).toMatch(/New/)
    })
  })

  test("diff renders +/- stat header and lines", async () => {
    const md = ["```diff", "+ added", "- removed", "  context", "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/\+1/)
      expect(text).toMatch(/[−-]1/)
    })
  })

  test("badges render bracketed pills", async () => {
    const md = ["```badge", JSON.stringify([{ label: "v1" }, { label: "stable" }]), "```"].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/\[v1\]/)
      expect(text).toMatch(/\[stable\]/)
    })
  })

  test("preview renders title, description, url", async () => {
    const md = [
      "```preview",
      JSON.stringify({ title: "Docs", description: "Read me.", url: "https://example.com" }),
      "```",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      expect(text).toMatch(/Docs/)
      expect(text).toMatch(/Read me/)
      expect(text).toMatch(/example\.com/)
    })
  })

  test("multiple blocks + markdown render in correct order", async () => {
    const md = [
      "First paragraph.",
      "",
      "```callout success",
      "All good.",
      "```",
      "",
      "Middle paragraph.",
      "",
      "```badge",
      JSON.stringify([{ label: "ok" }]),
      "```",
      "",
      "Last paragraph.",
    ].join("\n")
    await withHarness(() => <RenderFixture md={md} />, async (h) => {
      const text = h.frame().text
      const a = text.indexOf("First paragraph")
      const b = text.indexOf("All good")
      const c = text.indexOf("Middle paragraph")
      const d = text.indexOf("[ok]")
      const e = text.indexOf("Last paragraph")
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeGreaterThan(a)
      expect(c).toBeGreaterThan(b)
      expect(d).toBeGreaterThan(c)
      expect(e).toBeGreaterThan(d)
    })
  })
})
