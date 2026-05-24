import type { AssistantMessage, Message, Part, ToolPart } from "@codeplane-ai/sdk/v2/client"
import { DAY_MS, startOfDay, type DayBucket, type ModelStat, type Range, type Totals } from "./stats"

/** Bump whenever the cached aggregate shape changes. */
export const SESSION_AGGREGATE_VERSION = 4

export type DailyMetrics = {
  /** Total messages on this day. */
  count: number
  /** Sum of assistant-message tokens on this day. */
  tokens: number
  /** 24-bucket histogram of hour-of-day for messages on this day. */
  hours: number[]
  /** Per-model breakdown of messages and tokens on this day. */
  models: Record<string, { count: number; tokens: number; providerID?: string }>
  /** Git activity detected from completed tool calls on this day. */
  git: {
    commits: number
  }
}

export type SessionStatsEntry = Message | { info: Message; parts?: Part[] }

export type SessionAggregate = {
  sessionID: string
  /** Session.time.updated at the moment we built this aggregate. */
  updatedAt: number
  /** Newest message time observed; tiebreaker when session.time.updated is missing. */
  newestMessageAt: number
  /** dayStartMs → metrics for that day. Compact: only days with activity. */
  days: Record<number, DailyMetrics>
}

const isAssistant = (message: Message): message is AssistantMessage => message.role === "assistant"

const messageTokens = (message: AssistantMessage) => {
  const t = message.tokens
  if (!t) return 0
  if (typeof t.total === "number" && t.total > 0) return t.total
  return (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
}

function blankDay(): DailyMetrics {
  return { count: 0, tokens: 0, hours: new Array<number>(24).fill(0), models: {}, git: { commits: 0 } }
}

const asEntry = (entry: SessionStatsEntry) => ("info" in entry ? entry : { info: entry, parts: [] })

const isCompletedTool = (part: Part): part is ToolPart & { state: Extract<ToolPart["state"], { status: "completed" }> } =>
  part.type === "tool" && part.state.status === "completed"

const stringInput = (input: Record<string, unknown>, key: string) => {
  const value = input[key]
  if (typeof value !== "string") return ""
  return value
}

const gitToolCommitCount = (part: ToolPart & { state: Extract<ToolPart["state"], { status: "completed" }> }) => {
  if (part.tool !== "git") return 0
  const input = part.state.input
  const operation = stringInput(input, "operation")
  if (operation === "commit") return 1
  if (operation !== "run") return 0
  const args = input.args
  if (!Array.isArray(args)) return 0
  return args[0] === "commit" ? 1 : 0
}

const bashCommitCount = (part: ToolPart & { state: Extract<ToolPart["state"], { status: "completed" }> }) => {
  if (part.tool !== "bash") return 0
  const command = stringInput(part.state.input, "command")
  return command.match(/(?:^|[;&|]\s*)git\s+commit(?:\s|$)/g)?.length ?? 0
}

const gitStats = (parts: Part[] | undefined) => ({
  commits: (parts ?? []).reduce((total, part) => {
    if (!isCompletedTool(part)) return total
    return total + gitToolCommitCount(part) + bashCommitCount(part)
  }, 0),
})

/**
 * Roll a session's full message list into a compact per-day aggregate that
 * preserves enough information to recompute every home-page metric for any
 * range filter without re-reading the original messages.
 */
export function aggregateSessionMessages(
  sessionID: string,
  sessionUpdatedAt: number,
  entries: SessionStatsEntry[],
): SessionAggregate {
  const days: Record<number, DailyMetrics> = {}
  let newestMessageAt = 0
  for (const raw of entries) {
    const entry = asEntry(raw)
    const message = entry.info
    const created = message.time.created
    if (created > newestMessageAt) newestMessageAt = created
    const dayKey = startOfDay(created)
    let day = days[dayKey]
    if (!day) {
      day = blankDay()
      days[dayKey] = day
    }
    day.count += 1
    const git = gitStats(entry.parts)
    day.git.commits += git.commits
    const hour = new Date(created).getHours()
    day.hours[hour] = (day.hours[hour] ?? 0) + 1
    if (!isAssistant(message)) continue
    const t = messageTokens(message)
    day.tokens += t
    const modelID = message.modelID
    if (!modelID) continue
    const modelEntry = day.models[modelID] ?? { count: 0, tokens: 0, providerID: message.providerID }
    modelEntry.count += 1
    modelEntry.tokens += t
    day.models[modelID] = modelEntry
  }
  return { sessionID, updatedAt: sessionUpdatedAt, newestMessageAt, days }
}

const RANGE_DAYS: Record<Range, number | undefined> = {
  all: undefined,
  "30d": 30,
  "7d": 7,
}

const rangeStart = (now: number, range: Range): number | undefined => {
  const days = RANGE_DAYS[range]
  if (days === undefined) return undefined
  return startOfDay(now) - (days - 1) * DAY_MS
}

const inRange = (time: number, start?: number) => start === undefined || time >= start

export function streaks(activeDays: Set<number>, now: number) {
  if (activeDays.size === 0) return { current: 0, longest: 0 }
  const sorted = [...activeDays].sort((a, b) => a - b)
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! === DAY_MS) {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 1
    }
  }
  let current = 0
  let day = startOfDay(now)
  if (!activeDays.has(day)) day -= DAY_MS
  while (activeDays.has(day)) {
    current += 1
    day -= DAY_MS
  }
  return { current, longest }
}

export type CombinedTotals = {
  messages: number
  tokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHour?: number
  gitCommits: number
}

/**
 * Sum every aggregate's per-day metrics within the range. Exact — no scaling,
 * no approximation — because each per-day record is self-contained.
 */
export function combineAggregates(aggregates: SessionAggregate[], now: number, range: Range): CombinedTotals {
  const start = rangeStart(now, range)
  const hourCounts = new Array<number>(24).fill(0)
  const activeDaySet = new Set<number>()
  let messages = 0
  let tokens = 0
  let gitCommits = 0

  for (const aggregate of aggregates) {
    if (!aggregate || !aggregate.days) continue
    for (const [dayKeyRaw, daily] of Object.entries(aggregate.days)) {
      if (!daily) continue
      const dayKey = Number(dayKeyRaw)
      if (!inRange(dayKey, start)) continue
      messages += daily.count ?? 0
      tokens += daily.tokens ?? 0
      gitCommits += daily.git?.commits ?? 0
      if ((daily.count ?? 0) > 0) activeDaySet.add(dayKey)
      const hours = daily.hours ?? []
      for (let h = 0; h < 24; h++) hourCounts[h] += hours[h] ?? 0
    }
  }

  const peak = hourCounts.reduce<{ hour: number; count: number }>(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: -1, count: 0 },
  )

  const { current, longest } = streaks(activeDaySet, now)

  return {
    messages,
    tokens,
    activeDays: activeDaySet.size,
    currentStreak: current,
    longestStreak: longest,
    peakHour: peak.count > 0 ? peak.hour : undefined,
    gitCommits,
  }
}

export function preferredModel(
  aggregates: SessionAggregate[],
  range: Range,
  now: number,
): Totals["preferredModel"] | undefined {
  const start = rangeStart(now, range)
  const totals = new Map<string, { count: number; providerID?: string }>()
  for (const aggregate of aggregates) {
    if (!aggregate || !aggregate.days) continue
    for (const [dayKeyRaw, daily] of Object.entries(aggregate.days)) {
      if (!daily) continue
      const dayKey = Number(dayKeyRaw)
      if (!inRange(dayKey, start)) continue
      const models = daily.models ?? {}
      for (const [modelID, info] of Object.entries(models)) {
        if (!info) continue
        const existing = totals.get(modelID)
        totals.set(modelID, {
          count: (existing?.count ?? 0) + (info.count ?? 0),
          providerID: existing?.providerID ?? info.providerID,
        })
      }
    }
  }
  let preferred: Totals["preferredModel"] | undefined
  for (const [modelID, info] of totals) {
    if (!preferred || info.count > preferred.messages) {
      preferred = { modelID, providerID: info.providerID, messages: info.count }
    }
  }
  return preferred
}

export function modelBreakdown(aggregates: SessionAggregate[], range: Range, now: number): ModelStat[] {
  const start = rangeStart(now, range)
  const byModel = new Map<
    string,
    { providerID?: string; messages: number; tokens: number; sessions: Set<string> }
  >()
  for (const aggregate of aggregates) {
    if (!aggregate || !aggregate.days) continue
    for (const [dayKeyRaw, daily] of Object.entries(aggregate.days)) {
      if (!daily) continue
      const dayKey = Number(dayKeyRaw)
      if (!inRange(dayKey, start)) continue
      const models = daily.models ?? {}
      for (const [modelID, info] of Object.entries(models)) {
        if (!info) continue
        let entry = byModel.get(modelID)
        if (!entry) {
          entry = { providerID: info.providerID, messages: 0, tokens: 0, sessions: new Set() }
          byModel.set(modelID, entry)
        }
        entry.messages += info.count ?? 0
        entry.tokens += info.tokens ?? 0
        if ((info.count ?? 0) > 0) entry.sessions.add(aggregate.sessionID)
      }
    }
  }
  return [...byModel.entries()]
    .map(([modelID, info]) => ({
      modelID,
      providerID: info.providerID,
      messages: info.messages,
      tokens: info.tokens,
      sessions: info.sessions.size,
    }))
    .sort((a, b) => b.messages - a.messages)
}

export const HEATMAP_DAYS_REFERENCE = 364

export function heatmapBuckets(aggregates: SessionAggregate[], now: number): DayBucket[] {
  const today = startOfDay(now)
  const start = today - (HEATMAP_DAYS_REFERENCE - 1) * DAY_MS
  const buckets: DayBucket[] = []
  for (let i = HEATMAP_DAYS_REFERENCE - 1; i >= 0; i--) {
    buckets.push({ start: today - i * DAY_MS, count: 0 })
  }
  for (const aggregate of aggregates) {
    if (!aggregate || !aggregate.days) continue
    for (const [dayKeyRaw, daily] of Object.entries(aggregate.days)) {
      if (!daily) continue
      const dayKey = Number(dayKeyRaw)
      if (dayKey < start) continue
      const index = Math.round((dayKey - start) / DAY_MS)
      const bucket = buckets[index]
      if (!bucket) continue
      bucket.count += daily.count ?? 0
    }
  }
  return buckets
}
