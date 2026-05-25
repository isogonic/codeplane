import type { AssistantMessage, Message, Part, ToolPart } from "@codeplane-ai/sdk/v2/client"
import { calendarDayStarts, DAY_MS, startOfDay, type DayBucket, type ModelStat, type Range, type Totals } from "./stats"

/** Bump whenever the cached aggregate shape changes. */
export const SESSION_AGGREGATE_VERSION = 5

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

export type MaterializedModelMetrics = {
  count: number
  tokens: number
  providerID?: string
  /** sessionID -> model-message count for this day. */
  sessions: Record<string, number>
}

export type MaterializedDailyMetrics = {
  /** Total messages on this day across every cached session. */
  count: number
  /** Sum of assistant-message tokens on this day across every cached session. */
  tokens: number
  /** 24-bucket histogram of hour-of-day for messages on this day. */
  hours: number[]
  /** Per-model breakdown with enough session presence data for range reads. */
  models: Record<string, MaterializedModelMetrics>
  /** Git activity detected from completed tool calls on this day. */
  git: {
    commits: number
  }
}

export type MaterializedHomeStats = {
  /** dayStartMs -> live accumulated metrics. */
  days: Record<number, MaterializedDailyMetrics>
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
  return { count: 0, tokens: 0, hours: Array.from({ length: 24 }, () => 0), models: {}, git: { commits: 0 } }
}

const asEntry = (entry: SessionStatsEntry) => ("info" in entry ? entry : { info: entry, parts: [] })

const isCompletedTool = (
  part: Part,
): part is ToolPart & { state: Extract<ToolPart["state"], { status: "completed" }> } =>
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

function applyEntries(aggregate: SessionAggregate, entries: Iterable<SessionStatsEntry>) {
  const days = aggregate.days
  for (const raw of entries) {
    const entry = asEntry(raw)
    const message = entry.info
    const created = message.time.created
    if (created > aggregate.newestMessageAt) aggregate.newestMessageAt = created
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
}

export function createSessionAggregateBuilder(sessionID: string, sessionUpdatedAt: number) {
  const aggregate: SessionAggregate = {
    sessionID,
    updatedAt: sessionUpdatedAt,
    newestMessageAt: 0,
    days: {},
  }

  return {
    add(entries: Iterable<SessionStatsEntry>) {
      applyEntries(aggregate, entries)
    },
    finish() {
      return aggregate
    },
  }
}

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
  const builder = createSessionAggregateBuilder(sessionID, sessionUpdatedAt)
  builder.add(entries)
  return builder.finish()
}

export const emptyMaterializedHomeStats = (): MaterializedHomeStats => ({ days: {} })

export const isMaterializedHomeStats = (value: unknown): value is MaterializedHomeStats => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const days = (value as { days?: unknown }).days
  return !!days && typeof days === "object" && !Array.isArray(days)
}

function blankMaterializedDay(): MaterializedDailyMetrics {
  return { count: 0, tokens: 0, hours: Array.from({ length: 24 }, () => 0), models: {}, git: { commits: 0 } }
}

function cloneMaterializedStats(stats: MaterializedHomeStats): MaterializedHomeStats {
  const days: Record<number, MaterializedDailyMetrics> = {}
  for (const [dayKeyRaw, daily] of Object.entries(stats.days ?? {})) {
    if (!daily) continue
    const models: Record<string, MaterializedModelMetrics> = {}
    for (const [modelID, info] of Object.entries(daily.models ?? {})) {
      if (!info) continue
      models[modelID] = {
        count: info.count ?? 0,
        tokens: info.tokens ?? 0,
        providerID: info.providerID,
        sessions: { ...info.sessions },
      }
    }
    days[Number(dayKeyRaw)] = {
      count: daily.count ?? 0,
      tokens: daily.tokens ?? 0,
      hours: Array.from({ length: 24 }, (_, h) => daily.hours?.[h] ?? 0),
      models,
      git: { commits: daily.git?.commits ?? 0 },
    }
  }
  return { days }
}

const addMetric = (current: number | undefined, delta: number | undefined) => {
  const next = (current ?? 0) + (delta ?? 0)
  return next <= 0 ? 0 : next
}

const hasDailyActivity = (daily: MaterializedDailyMetrics) =>
  daily.count > 0 ||
  daily.tokens > 0 ||
  daily.git.commits > 0 ||
  daily.hours.some((count) => count > 0) ||
  Object.keys(daily.models).length > 0

function applyDailyMetrics(
  target: MaterializedDailyMetrics,
  sessionID: string,
  source: DailyMetrics,
  direction: 1 | -1,
) {
  target.count = addMetric(target.count, direction * (source.count ?? 0))
  target.tokens = addMetric(target.tokens, direction * (source.tokens ?? 0))
  target.git.commits = addMetric(target.git.commits, direction * (source.git?.commits ?? 0))

  for (let h = 0; h < 24; h++) target.hours[h] = addMetric(target.hours[h], direction * (source.hours?.[h] ?? 0))

  for (const [modelID, info] of Object.entries(source.models ?? {})) {
    if (!info) continue
    const model = target.models[modelID] ?? {
      count: 0,
      tokens: 0,
      providerID: info.providerID,
      sessions: {},
    }
    model.count = addMetric(model.count, direction * (info.count ?? 0))
    model.tokens = addMetric(model.tokens, direction * (info.tokens ?? 0))
    if (!model.providerID) model.providerID = info.providerID

    if ((info.count ?? 0) > 0) {
      const sessionCount = (model.sessions[sessionID] ?? 0) + direction * (info.count ?? 0)
      if (sessionCount > 0) {
        model.sessions[sessionID] = sessionCount
      } else {
        delete model.sessions[sessionID]
      }
    }

    if (model.count > 0 || model.tokens > 0 || Object.keys(model.sessions).length > 0) {
      target.models[modelID] = model
    } else {
      delete target.models[modelID]
    }
  }
}

function applyAggregateInto(stats: MaterializedHomeStats, aggregate: SessionAggregate, direction: 1 | -1) {
  if (!aggregate || !aggregate.days) return
  for (const [dayKeyRaw, daily] of Object.entries(aggregate.days)) {
    if (!daily) continue
    const dayKey = Number(dayKeyRaw)
    const target = stats.days[dayKey] ?? blankMaterializedDay()
    applyDailyMetrics(target, aggregate.sessionID, daily, direction)
    if (hasDailyActivity(target)) {
      stats.days[dayKey] = target
    } else {
      delete stats.days[dayKey]
    }
  }
}

export function materializeAggregates(aggregates: SessionAggregate[]): MaterializedHomeStats {
  const stats = emptyMaterializedHomeStats()
  for (const aggregate of aggregates) {
    if (!aggregate) continue
    applyAggregateInto(stats, aggregate, 1)
  }
  return stats
}

export function applySessionAggregateToMaterializedStats(
  stats: MaterializedHomeStats,
  previous: SessionAggregate | undefined,
  next: SessionAggregate,
): MaterializedHomeStats {
  const materialized = cloneMaterializedStats(stats)
  if (previous) applyAggregateInto(materialized, previous, -1)
  applyAggregateInto(materialized, next, 1)
  return materialized
}

export function removeSessionAggregateFromMaterializedStats(
  stats: MaterializedHomeStats,
  aggregate: SessionAggregate,
): MaterializedHomeStats {
  const materialized = cloneMaterializedStats(stats)
  applyAggregateInto(materialized, aggregate, -1)
  return materialized
}

export function removeSessionAggregatesFromMaterializedStats(
  stats: MaterializedHomeStats,
  aggregates: SessionAggregate[],
): MaterializedHomeStats {
  const materialized = cloneMaterializedStats(stats)
  for (const aggregate of aggregates) applyAggregateInto(materialized, aggregate, -1)
  return materialized
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
 * Read the live materialized per-day metrics within the range. Exact — no
 * scaling, no approximation — because each per-day record is self-contained.
 */
export function combineMaterializedStats(stats: MaterializedHomeStats, now: number, range: Range): CombinedTotals {
  const start = rangeStart(now, range)
  const hourCounts = Array.from({ length: 24 }, () => 0)
  const activeDaySet = new Set<number>()
  let messages = 0
  let tokens = 0
  let gitCommits = 0

  for (const [dayKeyRaw, daily] of Object.entries(stats.days ?? {})) {
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

/**
 * Back-compat wrapper for tests and one-off callers. Home reads the
 * materialized store directly.
 */
export function combineAggregates(aggregates: SessionAggregate[], now: number, range: Range): CombinedTotals {
  return combineMaterializedStats(materializeAggregates(aggregates), now, range)
}

export function preferredModelFromMaterializedStats(
  stats: MaterializedHomeStats,
  range: Range,
  now: number,
): Totals["preferredModel"] | undefined {
  const start = rangeStart(now, range)
  const totals = new Map<string, { count: number; providerID?: string }>()
  for (const [dayKeyRaw, daily] of Object.entries(stats.days ?? {})) {
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
  let preferred: Totals["preferredModel"] | undefined
  for (const [modelID, info] of totals) {
    if (!preferred || info.count > preferred.messages) {
      preferred = { modelID, providerID: info.providerID, messages: info.count }
    }
  }
  return preferred
}

export function preferredModel(
  aggregates: SessionAggregate[],
  range: Range,
  now: number,
): Totals["preferredModel"] | undefined {
  return preferredModelFromMaterializedStats(materializeAggregates(aggregates), range, now)
}

export function modelBreakdownFromMaterializedStats(
  stats: MaterializedHomeStats,
  range: Range,
  now: number,
): ModelStat[] {
  const start = rangeStart(now, range)
  const byModel = new Map<string, { providerID?: string; messages: number; tokens: number; sessions: Set<string> }>()
  for (const [dayKeyRaw, daily] of Object.entries(stats.days ?? {})) {
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
      for (const [sessionID, count] of Object.entries(info.sessions ?? {})) {
        if (count > 0) entry.sessions.add(sessionID)
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

export function modelBreakdown(aggregates: SessionAggregate[], range: Range, now: number): ModelStat[] {
  return modelBreakdownFromMaterializedStats(materializeAggregates(aggregates), range, now)
}

export const HEATMAP_DAYS_REFERENCE = 364

export function heatmapBucketsFromMaterializedStats(stats: MaterializedHomeStats, now: number): DayBucket[] {
  const today = startOfDay(now)
  return calendarDayStarts(today, HEATMAP_DAYS_REFERENCE).map((start) => ({
    start,
    count: stats.days[start]?.count ?? 0,
  }))
}

export function heatmapBuckets(aggregates: SessionAggregate[], now: number): DayBucket[] {
  return heatmapBucketsFromMaterializedStats(materializeAggregates(aggregates), now)
}
