// First-class tools for every rich-block kind the chat renderer
// supports. Why this file exists: v27.4.62 made `chart` a tool because
// prompt-level instructions ("use the chart fenced block") didn't
// reliably override training defaults. The same logic applies to every
// other rich block — kpi, callout, table, tabs, etc. Models reach for
// tools that are in their toolbox; they ignore prose suggestions.
//
// Each tool here:
//   1. Takes the block's payload as schema-validated parameters.
//   2. Wraps the payload as a fenced `\`\`\`<lang>` block in `output`.
//   3. The chat's existing markdown renderer (packages/ui/src/components/
//      markdown-blocks.ts for web, packages/codeplane/src/tui/component/
//      rich-block.tsx for TUI) picks up the fenced block and renders
//      the native widget.
//
// Adding a new block type: add a `defineBlock(...)` call below + import
// + register in registry.ts. The payload format must match what the
// markdown renderer expects (it parses the JSON inside the fenced
// block, not anything tool-specific).

import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// ---------------------------------------------------------------------------
// Helper — collapses 17 near-identical Tool.define() calls into one factory.
// ---------------------------------------------------------------------------

type AnyParams = Schema.Decoder<unknown>

interface BlockOptions<P extends AnyParams, R> {
  /** Tool id AND fenced-block lang (one symbol everywhere). */
  id: string
  /** Schema for the model-facing tool parameters. */
  parameters: P
  /** Tool description shown in the model's tool list. */
  description: string
  /**
   * Build the JSON payload that gets serialised into the fenced block.
   * Default: pass the validated params straight through. Override when
   * the model-friendly tool shape differs from the renderer's expected
   * payload (e.g. tools take `{ tiles: [...] }` but the renderer wants
   * the bare array).
   */
  payload?: (params: Schema.Schema.Type<P>) => R
  /** Title shown in the tool-call list. Defaults to just `id`. */
  title?: (params: Schema.Schema.Type<P>) => string
  /**
   * Override the default JSON payload format. Used by `diff` which
   * renders RAW text, not JSON. Returns the FULL fenced block text
   * (including the triple-backticks).
   */
  rawOutput?: (params: Schema.Schema.Type<P>) => string
}

function defineBlock<P extends AnyParams, R = Schema.Schema.Type<P>>(opts: BlockOptions<P, R>) {
  return Tool.define<P, Record<string, unknown>, never>(
    opts.id,
    Effect.gen(function* () {
      return {
        description: opts.description,
        parameters: opts.parameters,
        execute: (params: Schema.Schema.Type<P>, _ctx: Tool.Context<Record<string, unknown>>) =>
          Effect.gen(function* () {
            let output: string
            if (opts.rawOutput) {
              output = opts.rawOutput(params)
            } else {
              const payloadFn = opts.payload ?? ((p: Schema.Schema.Type<P>) => p as unknown as R)
              const payload = payloadFn(params)
              output = "```" + opts.id + "\n" + JSON.stringify(payload, null, 2) + "\n```"
            }
            const title = opts.title ? opts.title(params) : opts.id
            // Metadata mirrors the payload so any custom tool renderer
            // can read it without re-parsing the fenced block.
            const metadata: Record<string, unknown> =
              opts.rawOutput
                ? { raw: opts.rawOutput(params) }
                : ((opts.payload ? opts.payload(params) : (params as unknown)) as Record<string, unknown>)
            return { title, output, metadata }
          }),
      } satisfies Tool.DefWithoutID<P, Record<string, unknown>>
    }),
  )
}

// ---------------------------------------------------------------------------
// kpi — grid of 2-6 metric tiles
// ---------------------------------------------------------------------------

const KpiTile = Schema.Struct({
  label: Schema.String.annotate({ description: "Short tile label (e.g. 'Errors / hr', 'Uptime')." }),
  value: Schema.Union([Schema.String, Schema.Number]).annotate({
    description: "The headline value. String allowed for pre-formatted ('99.94%') or numeric raw.",
  }),
  unit: Schema.optional(Schema.String).annotate({ description: "Unit suffix shown after the value (e.g. 'ms', 'req/s')." }),
  delta: Schema.optional(Schema.Number).annotate({ description: "Absolute change since previous period (signed)." }),
  deltaPercent: Schema.optional(Schema.Number).annotate({ description: "Percent change since previous period (signed)." }),
  trend: Schema.optional(Schema.Literals(["up", "down", "flat"])).annotate({
    description: "Direction arrow: up/down/flat. Optional.",
  }),
  history: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))).annotate({
    description: "Optional sparkline history (8-30 points typical).",
  }),
  hint: Schema.optional(Schema.String).annotate({ description: "Tooltip / context shown on hover." }),
})

const KpiParameters = Schema.Struct({
  tiles: Schema.mutable(Schema.Array(KpiTile)).annotate({
    description: "2-6 metric tiles. A single tile is overkill — write that number inline instead.",
  }),
})

export const KpiTool = defineBlock<typeof KpiParameters, ReadonlyArray<Schema.Schema.Type<typeof KpiTile>>>({
  id: "kpi",
  parameters: KpiParameters,
  payload: (p) => p.tiles,
  title: (p) => `kpi · ${p.tiles.length} tiles`,
  description:
    "Render a grid of 2-6 metric tiles inline in the chat. Use for headline numbers the user should see at a glance (e.g. summary of key stats, end-of-investigation recap). Each tile takes label + value, plus optional unit, delta, trend, history sparkline, and hint. A single number is overkill — write it inline instead. Do NOT use for explanatory paragraphs that happen to include numbers.",
})

// ---------------------------------------------------------------------------
// callout — admonition / note / warning / etc
// ---------------------------------------------------------------------------

const CalloutKind = Schema.Literals([
  "note",
  "info",
  "tip",
  "warning",
  "danger",
  "error",
  "success",
  "important",
  "callout",
])

const CalloutParameters = Schema.Struct({
  kind: CalloutKind.annotate({
    description:
      "Visual style: note/info/tip/success for positive context, warning/danger/error for risk, important for emphasis. `callout` is the neutral generic.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional bold title shown at the top of the box." }),
  body: Schema.String.annotate({ description: "Markdown body of the callout. One concise paragraph; long callouts read as walls of color." }),
})

export const CalloutTool = defineBlock<typeof CalloutParameters, Record<string, unknown>>({
  id: "callout",
  parameters: CalloutParameters,
  payload: (p) => ({
    type: p.kind,
    body: p.body,
    ...(p.title !== undefined ? { title: p.title } : {}),
  }),
  title: (p) => `${p.kind}${p.title ? " · " + p.title : ""}`,
  description:
    "Render a callout / admonition box (note, info, tip, warning, danger, error, success, important) inline in the chat. Use sparingly for genuine warnings, version-specific gotchas, or single important caveats that should stand out from surrounding prose. Do NOT use for normal explanation, multi-paragraph content, or every section of a response — overuse turns the chat into a wall of colored boxes.",
})

// ---------------------------------------------------------------------------
// timeline — chronological event list
// ---------------------------------------------------------------------------

const TimelineEntry = Schema.Struct({
  time: Schema.optional(Schema.String).annotate({ description: "Timestamp / date / relative time (e.g. '2024-03-15', '2h ago')." }),
  title: Schema.optional(Schema.String).annotate({ description: "Short event title." }),
  description: Schema.optional(Schema.String).annotate({ description: "Optional one-line description." }),
  status: Schema.optional(Schema.Literals(["done", "current", "pending", "failed"])).annotate({
    description: "Visual state — done = check, current = highlight, pending = muted, failed = warning.",
  }),
})

const TimelineParameters = Schema.Struct({
  entries: Schema.mutable(Schema.Array(TimelineEntry)).annotate({
    description: "Vertical list of events in chronological order (most-recent first or oldest first — your call, but be consistent).",
  }),
})

export const TimelineTool = defineBlock<typeof TimelineParameters, ReadonlyArray<Schema.Schema.Type<typeof TimelineEntry>>>({
  id: "timeline",
  parameters: TimelineParameters,
  payload: (p) => p.entries,
  title: (p) => `timeline · ${p.entries.length}`,
  description:
    "Render a vertical timeline of chronological events inline in the chat. Use for project milestones, release history, deployment log, incident timeline, or any sequence with timestamps. Each entry takes time, title, description, status. For 'todo list' style sequences without timestamps, prefer a numbered list.",
})

// ---------------------------------------------------------------------------
// progress — labeled progress bars
// ---------------------------------------------------------------------------

const ProgressEntry = Schema.Struct({
  label: Schema.String.annotate({ description: "Bar label (e.g. 'Tests passed', 'Storage used')." }),
  value: Schema.Number.annotate({ description: "Current value." }),
  max: Schema.optional(Schema.Number).annotate({ description: "Maximum value (default 100, treats `value` as a percentage)." }),
  hint: Schema.optional(Schema.String).annotate({ description: "Optional small hint shown next to the bar." }),
  variant: Schema.optional(Schema.Literals(["default", "success", "warning", "danger"])).annotate({
    description: "Color variant — default is neutral, success/warning/danger map to status colors.",
  }),
})

const ProgressParameters = Schema.Struct({
  bars: Schema.mutable(Schema.Array(ProgressEntry)).annotate({ description: "One or more progress bars stacked vertically." }),
})

export const ProgressTool = defineBlock<typeof ProgressParameters, ReadonlyArray<Schema.Schema.Type<typeof ProgressEntry>>>({
  id: "progress",
  parameters: ProgressParameters,
  payload: (p) => p.bars,
  title: (p) => `progress · ${p.bars.length}`,
  description:
    "Render labeled progress bars inline in the chat. Use for ratios, completion state, capacity / utilization, test pass rates. For a single value, write it inline. For numeric trends over time, prefer the `chart` tool.",
})

// ---------------------------------------------------------------------------
// badge — pill row (status, tech stack, tags)
// ---------------------------------------------------------------------------

const BadgeEntry = Schema.Struct({
  label: Schema.String.annotate({ description: "Badge text." }),
  variant: Schema.optional(Schema.Literals(["info", "success", "warning", "danger", "neutral"])).annotate({
    description: "Color variant.",
  }),
})

const BadgeParameters = Schema.Struct({
  badges: Schema.mutable(Schema.Array(BadgeEntry)).annotate({ description: "Inline pill-shaped tags." }),
})

export const BadgeTool = defineBlock<typeof BadgeParameters, ReadonlyArray<Schema.Schema.Type<typeof BadgeEntry>>>({
  id: "badge",
  parameters: BadgeParameters,
  payload: (p) => p.badges,
  title: (p) => `badge · ${p.badges.length}`,
  description:
    "Render a row of pill-shaped badges inline in the chat. Use sparingly for tag-like meta — status flags, tech stack list, applied filters. Do NOT use as decoration for ordinary text.",
})

// ---------------------------------------------------------------------------
// quote — pull-quote card
// ---------------------------------------------------------------------------

const QuoteParameters = Schema.Struct({
  text: Schema.String.annotate({ description: "The quoted text." }),
  author: Schema.optional(Schema.String).annotate({ description: "Person being quoted." }),
  role: Schema.optional(Schema.String).annotate({ description: "Role / title of the author." }),
  source: Schema.optional(Schema.String).annotate({ description: "Source publication / talk / book." }),
  url: Schema.optional(Schema.String).annotate({ description: "Optional URL to the source." }),
  avatar: Schema.optional(Schema.String).annotate({ description: "Optional avatar image URL." }),
})

export const QuoteTool = defineBlock<typeof QuoteParameters>({
  id: "quote",
  parameters: QuoteParameters,
  title: (p) => `quote${p.author ? " · " + p.author : ""}`,
  description: "Render a pull-quote card inline in the chat. Use for a single notable quote with attribution. For multi-paragraph excerpts, plain markdown blockquote (`>`) is fine.",
})

// ---------------------------------------------------------------------------
// preview — link preview card
// ---------------------------------------------------------------------------

const PreviewParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to preview." }),
  title: Schema.optional(Schema.String).annotate({ description: "Page title." }),
  description: Schema.optional(Schema.String).annotate({ description: "Page description / og:description." }),
  site: Schema.optional(Schema.String).annotate({ description: "Site name (e.g. 'GitHub', 'Hacker News')." }),
  image: Schema.optional(Schema.String).annotate({ description: "Hero image URL (og:image)." }),
  favicon: Schema.optional(Schema.String).annotate({ description: "Favicon URL." }),
})

export const PreviewTool = defineBlock<typeof PreviewParameters>({
  id: "preview",
  parameters: PreviewParameters,
  title: (p) => `preview · ${p.title ?? p.url}`,
  description:
    "Render a link preview card inline in the chat. Use for highlighting a single URL the user should visit. Do NOT use for every link in your response — inline `[text](url)` markdown is fine for ordinary references.",
})

// ---------------------------------------------------------------------------
// stock — quote card with sparkline
// ---------------------------------------------------------------------------

const StockParameters = Schema.Struct({
  ticker: Schema.String.annotate({ description: "Ticker symbol (e.g. 'AAPL', 'BTC-USD')." }),
  name: Schema.optional(Schema.String).annotate({ description: "Full name (e.g. 'Apple Inc.')." }),
  exchange: Schema.optional(Schema.String).annotate({ description: "Exchange (e.g. 'NASDAQ')." }),
  price: Schema.Number.annotate({ description: "Current price." }),
  change: Schema.optional(Schema.Number).annotate({ description: "Absolute change vs previous close." }),
  changePercent: Schema.optional(Schema.Number).annotate({ description: "Percent change vs previous close." }),
  currency: Schema.optional(Schema.String).annotate({ description: "ISO 4217 currency code (default USD)." }),
  history: Schema.optional(Schema.mutable(Schema.Array(Schema.Number))).annotate({
    description: "Sparkline history points.",
  }),
  asOf: Schema.optional(Schema.String).annotate({ description: "As-of timestamp (e.g. '2024-03-15 16:00 UTC')." }),
})

export const StockTool = defineBlock<typeof StockParameters>({
  id: "stock",
  parameters: StockParameters,
  title: (p) => `stock · ${p.ticker}`,
  description: "Render a stock / asset quote card inline in the chat with optional sparkline. Use when the user explicitly asks about a specific ticker / price.",
})

// ---------------------------------------------------------------------------
// tabs — tabbed panels
// ---------------------------------------------------------------------------

const Tab = Schema.Struct({
  label: Schema.String.annotate({ description: "Tab label." }),
  content: Schema.String.annotate({ description: "Tab body. Inline markdown (paragraphs, lists, code spans, code blocks) is supported." }),
})

const TabsParameters = Schema.Struct({
  tabs: Schema.mutable(Schema.Array(Tab)).annotate({
    description: "2-4 tabs showing the same information from different angles (e.g. 'JS', 'Python', 'Go').",
  }),
  default: Schema.optional(Schema.Union([Schema.Number, Schema.String])).annotate({
    description: "Index or label of the initially-active tab. Defaults to 0.",
  }),
})

export const TabsTool = defineBlock<typeof TabsParameters>({
  id: "tabs",
  parameters: TabsParameters,
  title: (p) => `tabs · ${p.tabs.length}`,
  description:
    "Render tabbed panels inline in the chat. Use for showing the same information from 2-4 different angles (JS vs Python vs Go, before vs after vs why). Do NOT use for sequential steps — those are a numbered list.",
})

// ---------------------------------------------------------------------------
// choice / select — interactive question (radio / checkbox group)
// ---------------------------------------------------------------------------

const ChoiceOption = Schema.Struct({
  label: Schema.String.annotate({ description: "Option label shown to the user." }),
  value: Schema.optional(Schema.String).annotate({ description: "Machine value (defaults to label)." }),
  hint: Schema.optional(Schema.String).annotate({ description: "Small grey description under the option." }),
})

const ChoiceParameters = Schema.Struct({
  question: Schema.String.annotate({ description: "The question text shown above the options." }),
  hint: Schema.optional(Schema.String).annotate({ description: "Optional one-line elaboration shown under the question." }),
  options: Schema.mutable(Schema.Array(ChoiceOption)).annotate({ description: "2-8 options the user picks from." }),
  default: Schema.optional(Schema.String).annotate({ description: "Pre-selected option value." }),
})

export const ChoiceTool = defineBlock<typeof ChoiceParameters>({
  id: "choice",
  parameters: ChoiceParameters,
  title: (p) => `choice · ${p.options.length}`,
  description:
    "Render a radio (single-pick) question inline in the chat. Use ONLY when you genuinely need the user to pick between options to proceed (e.g. branching plan: 'A or B before I continue?'). Never as decoration.",
})

export const SelectTool = defineBlock<typeof ChoiceParameters>({
  id: "select",
  parameters: ChoiceParameters,
  title: (p) => `select · ${p.options.length}`,
  description:
    "Render a multi-select (checkbox) question inline in the chat. Use ONLY when the user needs to pick MULTIPLE options to proceed (e.g. 'which of these features should I implement?'). For a single pick, use `choice` instead.",
})

// ---------------------------------------------------------------------------
// table — rich table with formatting / totals
// ---------------------------------------------------------------------------

const TableColumn = Schema.Struct({
  key: Schema.String.annotate({ description: "Property key in each row object." }),
  label: Schema.optional(Schema.String).annotate({ description: "Column header (defaults to key)." }),
  align: Schema.optional(Schema.Literals(["left", "center", "right"])).annotate({
    description: "Cell alignment (right is conventional for numbers).",
  }),
  format: Schema.optional(Schema.Literals(["number", "currency", "percent"])).annotate({
    description: "Numeric formatting.",
  }),
  currency: Schema.optional(Schema.String).annotate({ description: "ISO 4217 code when format='currency'." }),
})

const TableParameters = Schema.Struct({
  caption: Schema.optional(Schema.String).annotate({ description: "Table caption shown above the data." }),
  columns: Schema.mutable(Schema.Array(TableColumn)).annotate({ description: "Column definitions." }),
  rows: Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))).annotate({
    description: "Row data — each object's keys match the column `key` fields.",
  }),
  total: Schema.optional(Schema.Boolean).annotate({ description: "Render a totals row at the bottom (sums numeric columns)." }),
})

export const TableTool = defineBlock<typeof TableParameters>({
  id: "table",
  parameters: TableParameters,
  title: (p) => `table · ${p.rows.length}×${p.columns.length}`,
  description:
    "Render a rich table inline in the chat with column alignment, formatting, and optional totals row. Use for tabular numeric data where alignment and totals matter (financial summaries, perf stats, comparisons). For small qualitative tables, plain markdown table syntax (`|...|`) is fine.",
})

// ---------------------------------------------------------------------------
// file-tree — directory tree with status
// ---------------------------------------------------------------------------

// Schema is shallow (children typed as Unknown to avoid recursive
// schema-typing pain in effect/Schema). The renderer accepts arbitrarily
// nested children — the model can still emit deeply-nested folders;
// the schema just doesn't validate the recursive shape, only the top
// level. Acceptable trade-off because file-tree payloads are short and
// the model rarely gets the shape wrong.
const FileNode = Schema.Struct({
  name: Schema.String.annotate({ description: "File or directory name (basename only, not the full path)." }),
  type: Schema.optional(Schema.Literals(["folder", "file"])).annotate({
    description: "Type — defaults to 'file' if no children, 'folder' if children present.",
  }),
  children: Schema.optional(Schema.mutable(Schema.Array(Schema.Unknown))).annotate({
    description:
      "Recursive children for folders. Each child has the same shape as a top-level node ({name, type?, children?, hint?, status?}).",
  }),
  hint: Schema.optional(Schema.String).annotate({ description: "Small grey caption next to the entry." }),
  status: Schema.optional(Schema.Literals(["added", "modified", "deleted", "unchanged"])).annotate({
    description: "Diff status — colors the entry green / yellow / red / muted.",
  }),
})

const FileTreeParameters = Schema.Struct({
  nodes: Schema.mutable(Schema.Array(FileNode)).annotate({
    description: "Top-level entries. Folders contain `children` arrays recursively (shape repeats).",
  }),
})

export const FileTreeTool = defineBlock<typeof FileTreeParameters, ReadonlyArray<unknown>>({
  id: "file-tree",
  parameters: FileTreeParameters,
  payload: (p) => p.nodes as ReadonlyArray<unknown>,
  title: (p) => `file-tree · ${p.nodes.length}`,
  description:
    "Render a directory tree inline in the chat with optional add/modify/delete status colors. Use for showing project structure, scaffolds, or a file-layout-level diff. For showing the contents of one file, use a normal fenced code block.",
})

// ---------------------------------------------------------------------------
// image-grid — grid of images
// ---------------------------------------------------------------------------

const ImageEntry = Schema.Struct({
  src: Schema.String.annotate({ description: "Image URL (https only)." }),
  alt: Schema.optional(Schema.String).annotate({ description: "Alt text for accessibility." }),
  caption: Schema.optional(Schema.String).annotate({ description: "Optional caption shown below the image." }),
})

const ImageGridParameters = Schema.Struct({
  images: Schema.mutable(Schema.Array(ImageEntry)).annotate({ description: "1-12 images laid out as a responsive grid." }),
})

export const ImageGridTool = defineBlock<typeof ImageGridParameters, ReadonlyArray<Schema.Schema.Type<typeof ImageEntry>>>({
  id: "image-grid",
  parameters: ImageGridParameters,
  payload: (p) => p.images,
  title: (p) => `image-grid · ${p.images.length}`,
  description:
    "Render a grid of images inline in the chat. Use when showing multiple images that should be visible at once (search results, gallery, screenshot tour). For a single hero image, plain markdown image syntax is fine.",
})

// ---------------------------------------------------------------------------
// comparison — two-column before / after
// ---------------------------------------------------------------------------

const ComparisonSide = Schema.Struct({
  label: Schema.String.annotate({ description: "Column header (e.g. 'Before', 'After', 'JS', 'Python')." }),
  content: Schema.String.annotate({ description: "Markdown content for this column." }),
})

const ComparisonParameters = Schema.Struct({
  title: Schema.optional(Schema.String).annotate({ description: "Optional comparison title shown above the two columns." }),
  left: ComparisonSide.annotate({ description: "Left column." }),
  right: ComparisonSide.annotate({ description: "Right column." }),
})

export const ComparisonTool = defineBlock<typeof ComparisonParameters>({
  id: "comparison",
  parameters: ComparisonParameters,
  title: (p) => `comparison · ${p.left.label} vs ${p.right.label}`,
  description:
    "Render a two-column before/after (or A vs B) comparison inline in the chat. Use for side-by-side comparisons where visually aligning the two helps comprehension. For 3+ alternatives, use `tabs` instead.",
})

// ---------------------------------------------------------------------------
// video — embedded player
// ---------------------------------------------------------------------------

const VideoParameters = Schema.Struct({
  src: Schema.String.annotate({ description: "Video URL (https only — http is rejected by the renderer)." }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional title shown above the player." }),
  caption: Schema.optional(Schema.String).annotate({ description: "Optional caption below the player." }),
  poster: Schema.optional(Schema.String).annotate({ description: "Poster / thumbnail image URL." }),
  autoplay: Schema.optional(Schema.Boolean).annotate({ description: "Auto-start playback (most browsers require muted=true)." }),
  loop: Schema.optional(Schema.Boolean).annotate({ description: "Loop on end." }),
  muted: Schema.optional(Schema.Boolean).annotate({ description: "Start muted." }),
  controls: Schema.optional(Schema.Boolean).annotate({ description: "Show playback controls (default true)." }),
})

export const VideoTool = defineBlock<typeof VideoParameters>({
  id: "video",
  parameters: VideoParameters,
  title: (p) => `video${p.title ? " · " + p.title : ""}`,
  description:
    "Embed a video player inline in the chat. https URLs only. Use when the user asks for a video or when a short clip illustrates the answer. For YouTube / Vimeo links, prefer the `preview` tool unless you have a direct .mp4/.webm URL.",
})

// ---------------------------------------------------------------------------
// diff — raw unified diff text
// ---------------------------------------------------------------------------

const DiffParameters = Schema.Struct({
  diff: Schema.String.annotate({
    description: "Raw unified diff text (e.g. output of `git diff`, `diff -u`). Renderer parses +/- lines and colors them.",
  }),
})

export const DiffTool = defineBlock<typeof DiffParameters>({
  id: "diff",
  parameters: DiffParameters,
  title: (p) => `diff · ${p.diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length}+/${p.diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length}-`,
  rawOutput: (p) => "```diff\n" + p.diff + "\n```",
  description:
    "Render a unified diff with colored +/− stats inline in the chat. Use when showing exact code changes between two versions. For ordinary code samples (no diff context), use a regular fenced code block with a language tag.",
})
