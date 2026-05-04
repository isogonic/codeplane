import type { AssistantMessage, Message, Part } from "@/tui/_compat/sdk-v2"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@codeplane-ai/plugin/tui"
import { createMemo } from "solid-js"

const id = "internal:sidebar-context"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

// TPS calculation — ported from packages/app/src/components/session/session-
// context-metrics.ts so the TUI sidebar reports the same number the web
// dashboard reports. Sum of (text + reasoning) part durations is the
// "model was actively emitting tokens" denominator that matches what
// providers report on their own dashboards (Anthropic, OpenAI, Bedrock
// usage telemetry). Falls back to whole-turn duration only when no part
// has both start + end timestamps (older sessions / cut-short turns).
const RECENT_WINDOW = 5
const MIN_TURN_MS = 250
const MIN_TURN_TOKENS = 4

const generatedTokenTotal = (msg: AssistantMessage) => msg.tokens.output + msg.tokens.reasoning

const generationMs = (parts: ReadonlyArray<Part> | undefined): number | undefined => {
  if (!parts || parts.length === 0) return undefined
  let sum = 0
  let counted = 0
  for (const part of parts) {
    if (part.type !== "text" && part.type !== "reasoning") continue
    const time = part.time
    if (!time) continue
    const start = typeof time.start === "number" ? time.start : undefined
    const end = typeof time.end === "number" ? time.end : undefined
    if (start === undefined || end === undefined) continue
    if (end <= start) continue
    sum += end - start
    counted++
  }
  if (counted === 0) return undefined
  return sum
}

type TurnSpeed = { tokens: number; ms: number; tps: number }

const collectTurnSpeeds = (
  messages: ReadonlyArray<Message>,
  partsFor: (messageID: string) => ReadonlyArray<Part>,
): TurnSpeed[] => {
  const result: TurnSpeed[] = []
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const completed = typeof msg.time.completed === "number" ? msg.time.completed : undefined
    if (completed === undefined || completed <= msg.time.created) continue
    const tokens = generatedTokenTotal(msg)
    const preciseMs = generationMs(partsFor(msg.id))
    const ms = preciseMs ?? completed - msg.time.created
    if (tokens < MIN_TURN_TOKENS || ms < MIN_TURN_MS) continue
    result.push({ tokens, ms, tps: (tokens / ms) * 1000 })
  }
  return result
}

const weightedAverage = (turns: ReadonlyArray<TurnSpeed>): number | null => {
  if (turns.length === 0) return null
  let tokens = 0
  let ms = 0
  for (const turn of turns) {
    tokens += turn.tokens
    ms += turn.ms
  }
  if (ms <= 0) return null
  return (tokens / ms) * 1000
}

const formatTps = (value: number | null): string | undefined => {
  if (value === null || !Number.isFinite(value) || value <= 0) return undefined
  if (value >= 100) return `${Math.round(value)} t/s`
  if (value >= 10) return `${value.toFixed(1)} t/s`
  return `${value.toFixed(2)} t/s`
}

// Optional per-session spending budget. Read once at module load — env
// vars don't change for the lifetime of the TUI process. CODEPLANE_BUDGET_SESSION
// takes a USD float ("5", "5.00", "0.25") and triggers the budget badge
// + a colour escalation in the sidebar Context indicator. Setting the
// env var to "0", anything non-numeric, or leaving it unset disables the
// feature entirely (no badge rendered, behaviour identical to <v27.4.44).
function readBudgetSession(): number | undefined {
  const raw = process.env["CODEPLANE_BUDGET_SESSION"]
  if (!raw) return undefined
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}
const BUDGET_SESSION = readBudgetSession()

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const state = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null as number | null,
      }
    }

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  // Compute TPS off the same message stream. `state.part(msg.id)` is the
  // TUI plugin API's accessor for parts (declared in
  // packages/plugin/src/tui.ts:283). Recompute reactively whenever the
  // message list changes — new turns land, TPS updates immediately.
  const speed = createMemo(() => {
    const turns = collectTurnSpeeds(msg(), (id) => props.api.state.part(id))
    if (turns.length === 0) return { current: null, recent: null }
    const current = turns[turns.length - 1]?.tps ?? null
    const recent = weightedAverage(turns.slice(-RECENT_WINDOW))
    return { current, recent }
  })

  // Budget badge — only rendered when CODEPLANE_BUDGET_SESSION is set
  // and parses as a positive USD float. Colour escalates with usage so
  // the user sees the warning peripherally without a modal interrupt:
  //   <50%   muted   "spent / budget"
  //   50-79% text    "spent / budget (X%)"
  //   80-99% warning "spent / budget (X%) — over budget soon"
  //   ≥100%  warning "OVER budget — spent / budget (X%)"
  const budget = createMemo(() => {
    if (!BUDGET_SESSION) return null
    const spent = cost()
    const pct = Math.round((spent / BUDGET_SESSION) * 100)
    const colour =
      pct >= 100 ? theme().warning : pct >= 80 ? theme().warning : pct >= 50 ? theme().text : theme().textMuted
    const label =
      pct >= 100
        ? `OVER ${money.format(spent)} / ${money.format(BUDGET_SESSION)} (${pct}%)`
        : pct >= 80
          ? `${money.format(spent)} / ${money.format(BUDGET_SESSION)} (${pct}%) — over soon`
          : pct >= 50
            ? `${money.format(spent)} / ${money.format(BUDGET_SESSION)} (${pct}%)`
            : `${money.format(spent)} / ${money.format(BUDGET_SESSION)}`
    return { colour, label }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <text fg={theme().textMuted}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={theme().textMuted}>{state().percent ?? 0}% used</text>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
      {(() => {
        const b = budget()
        if (!b) return null
        return <text fg={b.colour}>{b.label}</text>
      })()}
      {(() => {
        const { current, recent } = speed()
        const cur = formatTps(current)
        const rec = formatTps(recent)
        if (!cur && !rec) return null
        if (cur && rec && cur !== rec) {
          return (
            <text fg={theme().textMuted}>
              {cur} · avg {rec}
            </text>
          )
        }
        return <text fg={theme().textMuted}>{cur ?? rec}</text>
      })()}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
