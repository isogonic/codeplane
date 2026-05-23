import type { AssistantMessage, Message, Part } from "@codeplane-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
}

export type TurnSpeed = {
  id: string
  index: number
  tokens: number
  ms: number
  tps: number
}

export type SpeedMetrics = {
  // Median per-turn TPS — robust to outlier turns (a single 0.2-second
  // 800-token turn used to drag the mean way up). The display label is still
  // "Lifetime" for compatibility with the existing meter UI.
  lifetime: number | null
  // Token-weighted average over the last RECENT_WINDOW turns. Weighting by
  // tokens means a long fast turn counts more than a short slow one.
  recent: number | null
  peak: number | null
  current: number | null
  turns: TurnSpeed[]
}

type Metrics = {
  totalCost: number
  speed: SpeedMetrics
  context: Context | undefined
}

type CompletedAssistantMessage = AssistantMessage & {
  time: AssistantMessage["time"] & {
    completed: number
  }
}

const RECENT_WINDOW = 5
const MIN_TURN_MS = 250
const MIN_TURN_TOKENS = 4
const OUTLIER_MIN_TURNS = 8
const OUTLIER_MIN_TPS = 300
const OUTLIER_RATIO = 8
const OUTLIER_MAD_MULTIPLIER = 12

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

// Synthetic assistant turns (compaction summary, title generation, the
// auto-compaction "summary" pass) inflate the speed stats with model output
// the user didn't actually request. Skip them.
const isSyntheticAssistant = (msg: AssistantMessage): boolean => {
  if (msg.summary === true) return true
  // The auto-compaction agent runs as a regular assistant turn but with a
  // dedicated agent name. Filter it out so it doesn't show up in the meter.
  return msg.agent === "compactor" || msg.agent === "summarizer" || msg.agent === "summary"
}

const completedAssistantWithDuration = (msg: Message): msg is CompletedAssistantMessage => {
  if (msg.role !== "assistant") return false
  if (typeof msg.time.completed !== "number") return false
  if (msg.time.completed <= msg.time.created) return false
  return !isSyntheticAssistant(msg as AssistantMessage)
}

// One generation step inside an assistant turn. The AI SDK splits a turn into
// one or more "steps" — each step is a single round-trip to the model that
// streams text/reasoning and may end with tool calls. Tokens come from
// `step-finish.tokens`; duration comes from `step-finish.time.created -
// step-start.time.created` whenever available (this matches AI SDK's
// `msToFinish - msToFirstChunk` and so the provider's reported throughput).
type StepSlice = {
  tokens: number
  ms: number
}

// Sum the wall-clock time the model was actively emitting during a step,
// using ONLY text/reasoning per-part timestamps. Fallback path for sessions
// recorded before step-start/step-finish gained their `time.created` stamps.
// Excludes tool execution / queue / TTFT — same as the streaming-only
// duration providers report.
const sumPartGenerationMs = (parts: Part[]): number => {
  let sum = 0
  for (const part of parts) {
    if (part.type !== "text" && part.type !== "reasoning") continue
    const time = part.time
    if (!time) continue
    const start = typeof time.start === "number" ? time.start : undefined
    const end = typeof time.end === "number" ? time.end : undefined
    if (start === undefined || end === undefined) continue
    if (end <= start) continue
    sum += end - start
  }
  return sum
}

// Walk a turn's parts in arrival order and bucket them into steps. Each
// `step-start` opens a bucket and stamps the step start time; each
// `step-finish` closes the bucket, stamps the step end time, and carries the
// per-step usage tokens. Anything before the first `step-start` (older event
// shapes) goes into an implicit leading step so we don't drop those turns.
const sliceBySteps = (parts: Part[] | undefined): StepSlice[] => {
  if (!parts || parts.length === 0) return []
  const slices: StepSlice[] = []
  let current: {
    parts: Part[]
    tokens: number | null
    startedAt: number | undefined
    endedAt: number | undefined
  } = { parts: [], tokens: null, startedAt: undefined, endedAt: undefined }

  const flush = () => {
    // Prefer step-boundary timestamps (start-step → finish-step). They cover
    // text + reasoning + tool-input decode time inside the step — i.e. the
    // exact window the AI SDK clocks for `msToFinish - msToFirstChunk`. Fall
    // back to summing per-part text/reasoning durations only when one of the
    // boundary timestamps is missing (older sessions).
    const boundaryMs =
      current.startedAt !== undefined && current.endedAt !== undefined && current.endedAt > current.startedAt
        ? current.endedAt - current.startedAt
        : 0
    const ms = boundaryMs > 0 ? boundaryMs : sumPartGenerationMs(current.parts)
    const tokens = current.tokens ?? 0
    if (ms > 0 || tokens > 0) slices.push({ ms, tokens })
    current = { parts: [], tokens: null, startedAt: undefined, endedAt: undefined }
  }

  for (const part of parts) {
    if (part.type === "step-start") {
      // A new step-start closes whatever was in flight (rare — most providers
      // only emit step-start when a step actually begins, so the previous
      // step-finish has usually already flushed). Guard anyway.
      if (current.parts.length > 0 || current.tokens !== null || current.startedAt !== undefined) flush()
      current.startedAt = typeof part.time?.created === "number" ? part.time.created : undefined
      continue
    }
    if (part.type === "step-finish") {
      const t = part.tokens
      // step.usage in the AI SDK reports the OUTPUT tokens for THAT step
      // (text + reasoning combined) — not cumulative across the turn. The
      // upstream `assistantMessage.tokens = usage.tokens` overwrite means the
      // message-level totals only reflect the last step, so we MUST go to
      // step-finish parts to recover the real per-turn output count and to
      // keep TPS aligned with what the provider dashboards report.
      const stepTokens = (t?.output ?? 0) + (t?.reasoning ?? 0)
      current.tokens = (current.tokens ?? 0) + stepTokens
      current.endedAt = typeof part.time?.created === "number" ? part.time.created : current.endedAt
      flush()
      continue
    }
    if (part.type === "text" || part.type === "reasoning") {
      current.parts.push(part)
    }
  }
  // A streaming or interrupted turn may have text/reasoning without a closing
  // step-finish — preserve the duration so live readings still update.
  if (current.parts.length > 0 || current.tokens !== null || current.startedAt !== undefined) flush()
  return slices
}

// Sum tokens across step-finish parts. Falls back to msg.tokens when no
// step-finish part is present (older data, or single-step legacy turns).
const turnGeneratedTokens = (msg: AssistantMessage, slices: StepSlice[]): number => {
  let sum = 0
  let any = false
  for (const slice of slices) {
    if (slice.tokens > 0) {
      sum += slice.tokens
      any = true
    }
  }
  if (any) return sum
  return msg.tokens.output + msg.tokens.reasoning
}

const turnGenerationMs = (msg: CompletedAssistantMessage, slices: StepSlice[]): number => {
  let sum = 0
  for (const slice of slices) sum += slice.ms
  if (sum > 0) return sum
  // Fallback for legacy turns without per-part timestamps. This includes tool
  // exec time and over-reports duration (so under-reports TPS), but it's
  // strictly better than skipping the turn entirely.
  return msg.time.completed - msg.time.created
}

const collectTurnSpeeds = (
  messages: Message[],
  partsByMessage: Record<string, Part[] | undefined> | undefined,
): TurnSpeed[] => {
  const result: TurnSpeed[] = []
  let index = 0
  for (const msg of messages) {
    if (!completedAssistantWithDuration(msg)) {
      continue
    }
    const parts = partsByMessage?.[msg.id]
    const slices = sliceBySteps(parts)
    const tokens = turnGeneratedTokens(msg, slices)
    const ms = turnGenerationMs(msg, slices)
    if (tokens < MIN_TURN_TOKENS || ms < MIN_TURN_MS) {
      index++
      continue
    }
    result.push({
      id: msg.id,
      index: index++,
      tokens,
      ms,
      tps: (tokens / ms) * 1000,
    })
  }
  return result
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

// Token-weighted average — a fast 1000-token turn counts ~10x as much as a
// slow 100-token turn. Better than per-turn mean which over-weights tiny
// turns.
const weightedAverage = (turns: TurnSpeed[]): number | null => {
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

// Peak is a display metric, not a billing/trace metric. A single locally tiny
// step window can pair with a large provider usage block and produce nonsense
// rates like 1k+ tok/s while the rest of the session sits around 50 tok/s.
// Drop those isolated spikes before calculating the meter and sparkline.
const removeSpeedOutliers = (turns: TurnSpeed[]): TurnSpeed[] => {
  if (turns.length < OUTLIER_MIN_TURNS) return turns
  const center = median(turns.map((turn) => turn.tps))
  if (!center || center <= 0) return turns
  const deviations = turns.map((turn) => Math.abs(turn.tps - center))
  const mad = median(deviations) ?? 0
  const spread = Math.max(mad, center * 0.15)
  const threshold = Math.max(OUTLIER_MIN_TPS, center * OUTLIER_RATIO, center + spread * OUTLIER_MAD_MULTIPLIER)
  return turns.filter((turn) => turn.tps <= threshold)
}

const buildSpeed = (
  messages: Message[],
  partsByMessage: Record<string, Part[] | undefined> | undefined,
): SpeedMetrics => {
  const turns = removeSpeedOutliers(collectTurnSpeeds(messages, partsByMessage))
  if (turns.length === 0) {
    return { lifetime: null, recent: null, peak: null, current: null, turns }
  }
  // Median per-turn TPS — robust to a single anomalously fast or slow turn.
  // Using the mean here let one 0.3-second cache-warm turn anchor the whole
  // session at an unrealistic value, which is the kind of "deviates from the
  // server" complaint that sparked this rewrite.
  const lifetime = median(turns.map((t) => t.tps))
  const recent = weightedAverage(turns.slice(-RECENT_WINDOW))
  const peak = turns.reduce((max, turn) => (turn.tps > max ? turn.tps : max), 0)
  const current = turns[turns.length - 1]?.tps ?? null
  return { lifetime, recent, peak, current, turns }
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (
  messages: Message[] = [],
  providers: Provider[] = [],
  partsByMessage?: Record<string, Part[] | undefined>,
): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const speed = buildSpeed(messages, partsByMessage)
  const message = lastAssistantWithTokens(messages)
  if (!message) return { totalCost, speed, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    speed,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
    },
  }
}

export function getSessionContextMetrics(
  messages: Message[] = [],
  providers: Provider[] = [],
  partsByMessage?: Record<string, Part[] | undefined>,
) {
  return build(messages, providers, partsByMessage)
}
