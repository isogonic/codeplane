import type { AssistantMessage, Message } from "@codeplane-ai/sdk/v2/client"
import { DAY_MS, startOfDay, type DayBucket, type ModelStat, type Range, type Totals } from "./stats"

export const SESSION_AGGREGATE_VERSION = 2

export type SessionAggregate = {
  sessionID: string
  /** Session.time.updated at the moment we built this aggregate. */
  updatedAt: number
  /** Newest message time observed; used as a tiebreaker when session.time.updated is missing. */
  newestMessageAt: number
  tokens: number
  messages: number
  /** Per-model message + token counts. */
  models: Record<string, { count: number; tokens: number; providerID?: string }>
  /** 24-bucket histogram of hour-of-day for every message in the session. */
  hourCounts: number[]
  /** dayStartMs → message count. Compact representation; one entry per active day in the session. */
  dayActivity: Record<number, number>
}

const isAssistant = (message: Message): message is AssistantMessage => message.role === "assistant"

const messageTokens = (message: AssistantMessage) => {
  const t = message.tokens
  if (!t) return 0
  if (typeof t.total === "number" && t.total > 0) return t.total
  return (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0)
}

/**
 * Roll a session's full message list into a compact aggregate suitable for
 * caching. Discards raw message bodies, keeps only the numbers we need to
 * regenerate every home-page metric (totals, peak hour, streaks, heatmap,
 * model breakdown).
 */
export function aggregateSessionMessages(
  sessionID: string,
  sessionUpdatedAt: number,
  messages: Message[],
): SessionAggregate {
  const hourCounts = new Array<number>(24).fill(0)
  const dayActivity: Record<number, number> = {}
  const models: SessionAggregate["models"] = {}
  let tokens = 0
  let count = 0
  let newestMessageAt = 0
  for (const message of messages) {
    count += 1
    const created = message.time.created
    if (created > newestMessageAt) newestMessageAt = created
    const hour = new Date(created).getHours()
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1
    const day = startOfDay(created)
    dayActivity[day] = (dayActivity[day] ?? 0) + 1
    if (!isAssistant(message)) continue
    const t = messageTokens(message)
    tokens += t
    const modelID = message.modelID
    if (!modelID) continue
    const entry = models[modelID] ?? { count: 0, tokens: 0, providerID: message.providerID }
    entry.count += 1
    entry.tokens += t
    models[modelID] = entry
  }
  return {
    sessionID,
    updatedAt: sessionUpdatedAt,
    newestMessageAt,
    tokens,
    messages: count,
    models,
    hourCounts,
    dayActivity,
  }
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

/**
 * Aggregate cross-session metrics for the overview tab. Range filters
 * collapse the per-day activity map so totals reflect only the requested
 * window. Heatmap buckets are always 364 days regardless of the filter —
 * that's a separate concern.
 */
export function combineAggregates(
  aggregates: SessionAggregate[],
  now: number,
  range: Range,
): { messages: number; tokens: number; activeDays: number; currentStreak: number; longestStreak: number; peakHour?: number } {
  const start = rangeStart(now, range)
  const hourCounts = new Array<number>(24).fill(0)
  const activeDaySet = new Set<number>()
  let messages = 0
  let tokens = 0

  for (const aggregate of aggregates) {
    // Token + message totals don't have a per-message timestamp inside the
    // aggregate, so we only contribute counts that fall inside the range as
    // determined by the activity map.
    let inRangeMessages = 0
    for (const [dayStartRaw, count] of Object.entries(aggregate.dayActivity)) {
      const dayStart = Number(dayStartRaw)
      if (!inRange(dayStart, start)) continue
      inRangeMessages += count
      activeDaySet.add(dayStart)
    }
    if (inRangeMessages === 0) continue
    messages += inRangeMessages
    // Hour counts and tokens get scaled by the fraction of messages in range.
    // For the all/365-day window every message qualifies so it's exact; for
    // 7d/30d we approximate (still better than dropping the session entirely).
    const scale = aggregate.messages > 0 ? inRangeMessages / aggregate.messages : 0
    tokens += aggregate.tokens * scale
    for (let h = 0; h < 24; h++) hourCounts[h] += (aggregate.hourCounts[h] ?? 0) * scale
  }

  const peak = hourCounts.reduce<{ hour: number; count: number }>(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: -1, count: 0 },
  )

  const { current, longest } = streaks(activeDaySet, now)

  return {
    messages,
    tokens: Math.round(tokens),
    activeDays: activeDaySet.size,
    currentStreak: current,
    longestStreak: longest,
    peakHour: peak.count > 0 ? peak.hour : undefined,
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
    let inRangeFactor = 0
    for (const [dayStartRaw, count] of Object.entries(aggregate.dayActivity)) {
      const dayStart = Number(dayStartRaw)
      if (inRange(dayStart, start)) inRangeFactor += count
    }
    if (inRangeFactor === 0) continue
    const scale = aggregate.messages > 0 ? inRangeFactor / aggregate.messages : 0
    for (const [modelID, info] of Object.entries(aggregate.models)) {
      const existing = totals.get(modelID)
      const next = (existing?.count ?? 0) + info.count * scale
      totals.set(modelID, { count: next, providerID: existing?.providerID ?? info.providerID })
    }
  }
  let preferred: Totals["preferredModel"] | undefined
  for (const [modelID, info] of totals) {
    if (!preferred || info.count > preferred.messages) {
      preferred = { modelID, providerID: info.providerID, messages: Math.round(info.count) }
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
    let inRangeFactor = 0
    for (const [dayStartRaw, count] of Object.entries(aggregate.dayActivity)) {
      const dayStart = Number(dayStartRaw)
      if (inRange(dayStart, start)) inRangeFactor += count
    }
    if (inRangeFactor === 0) continue
    const scale = aggregate.messages > 0 ? inRangeFactor / aggregate.messages : 0
    for (const [modelID, info] of Object.entries(aggregate.models)) {
      let entry = byModel.get(modelID)
      if (!entry) {
        entry = { providerID: info.providerID, messages: 0, tokens: 0, sessions: new Set() }
        byModel.set(modelID, entry)
      }
      entry.messages += info.count * scale
      entry.tokens += info.tokens * scale
      entry.sessions.add(aggregate.sessionID)
    }
  }
  return [...byModel.entries()]
    .map(([modelID, info]) => ({
      modelID,
      providerID: info.providerID,
      messages: Math.round(info.messages),
      tokens: Math.round(info.tokens),
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
    for (const [dayStartRaw, count] of Object.entries(aggregate.dayActivity)) {
      const dayStart = Number(dayStartRaw)
      if (dayStart < start) continue
      const index = Math.round((dayStart - start) / DAY_MS)
      const bucket = buckets[index]
      if (!bucket) continue
      bucket.count += count
    }
  }
  return buckets
}
