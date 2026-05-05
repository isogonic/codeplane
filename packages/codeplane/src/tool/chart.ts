import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./chart.txt"

// First-class chart tool. Why this exists:
// Models default to "user wants chart → install matplotlib → run script"
// from training. In this UI surface that produces an image the user
// CANNOT SEE. v27.4.59-61 added the rendering pipeline + a system
// prompt explaining the `chart` fenced block, but prompt instructions
// don't reliably override training defaults — the model still chose
// pip install matplotlib on the GDP test.
//
// A first-class TOOL appears in the model's tool list as an option
// alongside bash/read/write/etc. Models reach for tools they have in
// the toolbox much more aggressively than they follow prompt-level
// "use this fenced block" instructions. The execute() emits the
// chart as a fenced ```chart block in the tool output, which the
// markdown renderer picks up and renders inline; metadata carries
// the full payload for any custom tool renderer that wants to skip
// the markdown parse step.

const ChartType = Schema.Literals(["line", "bar", "area", "pie", "donut", "sparkline"])

const Series = Schema.Struct({
  name: Schema.optional(Schema.String).annotate({
    description: "Human label for this data series (shown in the legend).",
  }),
  data: Schema.mutable(Schema.Array(Schema.Number)).annotate({
    description: "The numeric data points for this series. Same length as `labels`.",
  }),
  color: Schema.optional(Schema.String).annotate({
    description: "Optional hex color override; otherwise auto-assigned from a curated palette.",
  }),
})

export const Parameters = Schema.Struct({
  type: ChartType.annotate({
    description:
      "The chart shape. line/bar/area for trends + comparisons (multi-series ok), pie/donut for parts-of-a-whole (single series, ≤ 6 slices), sparkline for tiny inline trends.",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Short title shown above the chart. Optional but recommended.",
  }),
  subtitle: Schema.optional(Schema.String).annotate({
    description: "Optional one-line subtitle (data source, time range, units).",
  }),
  labels: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "X-axis labels (e.g. years, categories). Must match the data length of each series.",
  }),
  series: Schema.mutable(Schema.Array(Series)).annotate({
    description: "Data series to render. At least one. Multi-series is allowed for line/bar/area.",
  }),
  format: Schema.optional(Schema.Literals(["number", "currency", "percent"])).annotate({
    description: "How numeric axis labels and tooltips are formatted. Default 'number'.",
  }),
  currency: Schema.optional(Schema.String).annotate({
    description: "ISO 4217 code (USD/EUR/etc) when format='currency'.",
  }),
})

type Metadata = {
  type: string
  title?: string
  subtitle?: string
  labels?: ReadonlyArray<string>
  series: ReadonlyArray<{ name?: string; data: ReadonlyArray<number>; color?: string }>
  format?: string
  currency?: string
}

export const ChartTool = Tool.define<typeof Parameters, Metadata, never>(
  "chart",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // Build the fenced ```chart block from the validated params.
          // The chat surface's markdown renderer already knows how to
          // turn this into a native chart widget (packages/ui/src/
          // components/markdown-blocks.ts:renderChart for web, packages/
          // codeplane/src/tui/component/rich-block.tsx for TUI).
          //
          // Emitting via the tool output (instead of asking the model
          // to write the block in its prose) means: the model just
          // calls chart({ type, labels, series, ... }) and a chart
          // appears. No need for the model to remember exact JSON
          // shape, JSON quoting, or fenced-block syntax — those are
          // failure modes that derailed the prompt-only approach.
          const payload = {
            type: params.type,
            ...(params.title !== undefined ? { title: params.title } : {}),
            ...(params.subtitle !== undefined ? { subtitle: params.subtitle } : {}),
            ...(params.labels !== undefined ? { labels: params.labels } : {}),
            series: params.series,
            ...(params.format !== undefined ? { format: params.format } : {}),
            ...(params.currency !== undefined ? { currency: params.currency } : {}),
          } satisfies Metadata
          const fenced = "```chart\n" + JSON.stringify(payload, null, 2) + "\n```"
          // Title shown in the tool-call list. Compact: "chart · line · 12pts".
          const total = params.series.reduce((sum, s) => sum + s.data.length, 0)
          const title = ["chart", params.type, params.title ?? `${total}pts`].join(" · ")
          return {
            title,
            output: fenced,
            metadata: payload,
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
