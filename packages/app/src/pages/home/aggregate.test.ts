import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Part } from "@codeplane-ai/sdk/v2/client"
import {
  aggregateSessionMessages,
  applySessionAggregateToMaterializedStats,
  combineAggregates,
  combineMaterializedStats,
  createSessionAggregateBuilder,
  emptyMaterializedHomeStats,
  heatmapBuckets,
  heatmapBucketsFromMaterializedStats,
  HEATMAP_DAYS_REFERENCE,
  materializeAggregates,
  modelBreakdown,
  modelBreakdownFromMaterializedStats,
  preferredModel,
  preferredModelFromMaterializedStats,
  removeSessionAggregatesFromMaterializedStats,
  streaks,
} from "./aggregate"
import { DAY_MS, startOfDay } from "./stats"

const now = new Date("2026-05-19T12:00:00Z").getTime()
const dayAgo = (days: number) => now - days * DAY_MS

const assistant = (overrides: {
  id: string
  sessionID: string
  created: number
  modelID?: string
  providerID?: string
  tokens?: number
}): AssistantMessage =>
  ({
    id: overrides.id,
    sessionID: overrides.sessionID,
    role: "assistant",
    time: { created: overrides.created },
    parentID: "p" + overrides.id,
    modelID: overrides.modelID ?? "opus",
    providerID: overrides.providerID ?? "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { total: overrides.tokens ?? 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as AssistantMessage

const user = (overrides: { id: string; sessionID: string; created: number }): Message =>
  ({
    id: overrides.id,
    sessionID: overrides.sessionID,
    role: "user",
    time: { created: overrides.created },
    agent: "default",
    model: { providerID: "anthropic", modelID: "opus" },
  }) as Message

const gitTool = (input: Record<string, unknown>): Part =>
  ({
    id: `tool-${JSON.stringify(input)}`,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: "call",
    tool: "git",
    state: {
      status: "completed",
      input,
      output: "",
      title: "git commit",
      metadata: {},
      time: { start: now, end: now + 1 },
    },
  }) as Part

const bashTool = (command: string): Part =>
  ({
    id: `bash-${command}`,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: "call",
    tool: "bash",
    state: {
      status: "completed",
      input: { command },
      output: "",
      title: command,
      metadata: {},
      time: { start: now, end: now + 1 },
    },
  }) as Part

describe("aggregateSessionMessages", () => {
  test("buckets messages into per-day metrics", () => {
    const agg = aggregateSessionMessages("s", now, [
      assistant({ id: "1", sessionID: "s", created: now, tokens: 100 }),
      user({ id: "2", sessionID: "s", created: now - 1000 }),
      assistant({ id: "3", sessionID: "s", created: dayAgo(1), tokens: 50, modelID: "sonnet" }),
    ])
    const today = startOfDay(now)
    const yesterday = today - DAY_MS
    expect(agg.days[today]?.count).toBe(2)
    expect(agg.days[today]?.tokens).toBe(100)
    expect(agg.days[today]?.models.opus?.count).toBe(1)
    expect(agg.days[today]?.models.opus?.tokens).toBe(100)
    expect(agg.days[yesterday]?.count).toBe(1)
    expect(agg.days[yesterday]?.tokens).toBe(50)
    expect(agg.days[yesterday]?.models.sonnet?.count).toBe(1)
  })

  test("counts completed git commits from tool history", () => {
    const agg = aggregateSessionMessages("s", now, [
      {
        info: assistant({ id: "1", sessionID: "s", created: now, tokens: 100 }),
        parts: [
          gitTool({ operation: "commit", message: "ship" }),
          gitTool({ operation: "run", args: ["commit", "-m", "ship"] }),
          bashTool("git add . && git commit -m ship"),
          gitTool({ operation: "status" }),
        ],
      },
    ])
    const today = startOfDay(now)
    expect(agg.days[today]?.git.commits).toBe(3)
    expect(combineAggregates([agg], now, "all").gitCommits).toBe(3)
  })

  test("builds the same aggregate incrementally across pages", () => {
    const entries = [
      assistant({ id: "1", sessionID: "s", created: now, tokens: 100 }),
      {
        info: assistant({ id: "2", sessionID: "s", created: dayAgo(1), tokens: 50, modelID: "sonnet" }),
        parts: [gitTool({ operation: "commit", message: "ship" })],
      },
      user({ id: "3", sessionID: "s", created: dayAgo(2) }),
    ]
    const builder = createSessionAggregateBuilder("s", now)
    builder.add(entries.slice(0, 1))
    builder.add(entries.slice(1))
    expect(builder.finish()).toEqual(aggregateSessionMessages("s", now, entries))
  })
})

describe("combineAggregates (precision)", () => {
  test("all-time sums everything exactly", () => {
    const agg = aggregateSessionMessages("s", now, [
      assistant({ id: "1", sessionID: "s", created: now, tokens: 1000 }),
      assistant({ id: "2", sessionID: "s", created: dayAgo(10), tokens: 2000 }),
      assistant({ id: "3", sessionID: "s", created: dayAgo(100), tokens: 3000 }),
    ])
    const result = combineAggregates([agg], now, "all")
    expect(result.messages).toBe(3)
    expect(result.tokens).toBe(6000)
    expect(result.activeDays).toBe(3)
  })

  test("30d range only counts messages within window — no scaling", () => {
    const agg = aggregateSessionMessages("s", now, [
      assistant({ id: "in", sessionID: "s", created: dayAgo(5), tokens: 1000 }),
      assistant({ id: "out", sessionID: "s", created: dayAgo(100), tokens: 9999 }),
    ])
    const result = combineAggregates([agg], now, "30d")
    expect(result.messages).toBe(1)
    expect(result.tokens).toBe(1000)
    expect(result.activeDays).toBe(1)
  })

  test("7d range is exact", () => {
    const agg = aggregateSessionMessages("s", now, [
      assistant({ id: "today", sessionID: "s", created: now, tokens: 5 }),
      assistant({ id: "5d", sessionID: "s", created: dayAgo(5), tokens: 7 }),
      assistant({ id: "10d", sessionID: "s", created: dayAgo(10), tokens: 999 }),
    ])
    const result = combineAggregates([agg], now, "7d")
    expect(result.messages).toBe(2)
    expect(result.tokens).toBe(12)
    expect(result.activeDays).toBe(2)
  })

  test("combines multiple sessions without double counting", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: now, tokens: 100 }),
      assistant({ id: "2", sessionID: "a", created: dayAgo(2), tokens: 200 }),
    ])
    const b = aggregateSessionMessages("b", now, [
      assistant({ id: "3", sessionID: "b", created: now, tokens: 300 }),
      assistant({ id: "4", sessionID: "b", created: dayAgo(5), tokens: 400 }),
    ])
    const result = combineAggregates([a, b], now, "all")
    expect(result.messages).toBe(4)
    expect(result.tokens).toBe(1000)
    // "now" is shared between a and b → 3 unique active days
    expect(result.activeDays).toBe(3)
  })

  test("identifies peak hour across all sessions", () => {
    const morning = new Date(2026, 4, 19, 9, 0).getTime()
    const evening = new Date(2026, 4, 19, 20, 0).getTime()
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: morning, tokens: 1 }),
      assistant({ id: "2", sessionID: "a", created: morning, tokens: 1 }),
      assistant({ id: "3", sessionID: "a", created: evening, tokens: 1 }),
    ])
    const result = combineAggregates([a], now, "all")
    expect(result.peakHour).toBe(9)
  })

  test("computes streaks correctly", () => {
    const days = [0, 1, 2, 5, 6].map((d) => dayAgo(d))
    const messages = days.map((created, i) => assistant({ id: String(i), sessionID: "s", created, tokens: 1 }))
    const agg = aggregateSessionMessages("s", now, messages)
    const result = combineAggregates([agg], now, "all")
    expect(result.currentStreak).toBe(3) // today, yesterday, 2 days ago
    expect(result.longestStreak).toBe(3)
    expect(result.activeDays).toBe(5)
  })
})

describe("materialized home stats", () => {
  test("reads the same totals, models, preferred model, and heatmap as aggregate wrappers", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: now, tokens: 100, modelID: "opus" }),
      assistant({ id: "2", sessionID: "a", created: dayAgo(1), tokens: 50, modelID: "sonnet" }),
    ])
    const b = aggregateSessionMessages("b", now, [
      assistant({ id: "3", sessionID: "b", created: now, tokens: 200, modelID: "opus" }),
    ])
    const aggregates = [a, b]
    const stats = materializeAggregates(aggregates)

    expect(combineMaterializedStats(stats, now, "all")).toEqual(combineAggregates(aggregates, now, "all"))
    expect(modelBreakdownFromMaterializedStats(stats, "all", now)).toEqual(modelBreakdown(aggregates, "all", now))
    expect(preferredModelFromMaterializedStats(stats, "all", now)).toEqual(preferredModel(aggregates, "all", now))
    expect(heatmapBucketsFromMaterializedStats(stats, now)).toEqual(heatmapBuckets(aggregates, now))
  })

  test("replacing a session subtracts the previous contribution before adding the new one", () => {
    const previous = aggregateSessionMessages("s", now, [
      assistant({ id: "old-1", sessionID: "s", created: now, tokens: 100, modelID: "opus" }),
      assistant({ id: "old-2", sessionID: "s", created: now, tokens: 200, modelID: "opus" }),
    ])
    const next = aggregateSessionMessages("s", now + 1, [
      assistant({ id: "new-1", sessionID: "s", created: now, tokens: 25, modelID: "sonnet" }),
    ])

    let stats = emptyMaterializedHomeStats()
    stats = applySessionAggregateToMaterializedStats(stats, undefined, previous)
    stats = applySessionAggregateToMaterializedStats(stats, previous, next)

    expect(combineMaterializedStats(stats, now, "all")).toMatchObject({ messages: 1, tokens: 25 })
    expect(modelBreakdownFromMaterializedStats(stats, "all", now)).toEqual([
      { modelID: "sonnet", providerID: "anthropic", messages: 1, tokens: 25, sessions: 1 },
    ])
  })

  test("dropping sessions removes their accumulated totals", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "a1", sessionID: "a", created: now, tokens: 100, modelID: "opus" }),
    ])
    const b = aggregateSessionMessages("b", now, [
      assistant({ id: "b1", sessionID: "b", created: now, tokens: 300, modelID: "opus" }),
    ])

    const stats = removeSessionAggregatesFromMaterializedStats(materializeAggregates([a, b]), [a])

    expect(combineMaterializedStats(stats, now, "all")).toMatchObject({ messages: 1, tokens: 300 })
    expect(modelBreakdownFromMaterializedStats(stats, "all", now)[0]).toMatchObject({ sessions: 1 })
  })

  test("model sessions are deduplicated across days in the materialized store", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "a1", sessionID: "a", created: now, tokens: 100, modelID: "opus" }),
      assistant({ id: "a2", sessionID: "a", created: dayAgo(1), tokens: 50, modelID: "opus" }),
    ])
    const b = aggregateSessionMessages("b", now, [
      assistant({ id: "b1", sessionID: "b", created: now, tokens: 25, modelID: "opus" }),
    ])

    const breakdown = modelBreakdownFromMaterializedStats(materializeAggregates([a, b]), "all", now)

    expect(breakdown[0]).toMatchObject({ modelID: "opus", messages: 3, tokens: 175, sessions: 2 })
  })
})

describe("modelBreakdown", () => {
  test("sums tokens and counts per model with session deduplication", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: now, tokens: 100, modelID: "opus" }),
      assistant({ id: "2", sessionID: "a", created: now, tokens: 50, modelID: "sonnet" }),
    ])
    const b = aggregateSessionMessages("b", now, [
      assistant({ id: "3", sessionID: "b", created: now, tokens: 200, modelID: "opus" }),
    ])
    const breakdown = modelBreakdown([a, b], "all", now)
    const opus = breakdown.find((m) => m.modelID === "opus")
    const sonnet = breakdown.find((m) => m.modelID === "sonnet")
    expect(opus).toMatchObject({ messages: 2, tokens: 300, sessions: 2 })
    expect(sonnet).toMatchObject({ messages: 1, tokens: 50, sessions: 1 })
  })

  test("range filter excludes out-of-window messages", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "in", sessionID: "a", created: dayAgo(3), tokens: 50, modelID: "opus" }),
      assistant({ id: "out", sessionID: "a", created: dayAgo(50), tokens: 999, modelID: "opus" }),
    ])
    const breakdown = modelBreakdown([a], "7d", now)
    expect(breakdown[0]).toMatchObject({ modelID: "opus", messages: 1, tokens: 50 })
  })
})

describe("preferredModel", () => {
  test("picks the model with the most messages in range", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: now, modelID: "opus" }),
      assistant({ id: "2", sessionID: "a", created: now, modelID: "opus" }),
      assistant({ id: "3", sessionID: "a", created: now, modelID: "sonnet" }),
    ])
    expect(preferredModel([a], "all", now)?.modelID).toBe("opus")
  })
})

describe("heatmapBuckets", () => {
  test("returns 364 buckets and bucket counts match raw message counts", () => {
    const a = aggregateSessionMessages("a", now, [
      assistant({ id: "1", sessionID: "a", created: now }),
      assistant({ id: "2", sessionID: "a", created: now - 1000 }),
      assistant({ id: "3", sessionID: "a", created: dayAgo(1) }),
      assistant({ id: "4", sessionID: "a", created: dayAgo(400) }),
    ])
    const buckets = heatmapBuckets([a], now)
    expect(buckets).toHaveLength(HEATMAP_DAYS_REFERENCE)
    expect(buckets[buckets.length - 1]?.count).toBe(2)
    expect(buckets[buckets.length - 2]?.count).toBe(1)
    // Day 400 is outside the 364-day window
    expect(buckets.reduce((total, b) => total + b.count, 0)).toBe(3)
  })
})

describe("defensive handling", () => {
  test("malformed aggregate without days field doesn't crash combineAggregates", () => {
    const broken = { sessionID: "x", updatedAt: now, newestMessageAt: now } as unknown as Parameters<
      typeof combineAggregates
    >[0][number]
    const result = combineAggregates([broken], now, "all")
    expect(result.messages).toBe(0)
    expect(result.tokens).toBe(0)
  })

  test("undefined entries in aggregate list are skipped", () => {
    const result = combineAggregates([undefined as never, null as never], now, "all")
    expect(result.messages).toBe(0)
  })

  test("modelBreakdown handles missing days/models gracefully", () => {
    const broken = { sessionID: "x", updatedAt: now, newestMessageAt: now } as unknown as Parameters<
      typeof modelBreakdown
    >[0][number]
    expect(modelBreakdown([broken], "all", now)).toEqual([])
  })

  test("heatmapBuckets handles missing days field", () => {
    const broken = { sessionID: "x", updatedAt: now, newestMessageAt: now } as unknown as Parameters<
      typeof heatmapBuckets
    >[0][number]
    const buckets = heatmapBuckets([broken], now)
    expect(buckets).toHaveLength(HEATMAP_DAYS_REFERENCE)
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })
})

describe("streaks (exported)", () => {
  test("computes from a Set of day starts", () => {
    const today = startOfDay(now)
    const set = new Set([today, today - DAY_MS, today - 2 * DAY_MS, today - 5 * DAY_MS])
    const result = streaks(set, now)
    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
  })
})
