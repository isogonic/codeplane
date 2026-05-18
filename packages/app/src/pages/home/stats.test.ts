import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message, Session, SnapshotFileDiff } from "@codeplane-ai/sdk/v2/client"
import {
  aggregateModels,
  aggregateProjects,
  aggregateTotals,
  buildHomeStats,
  dailyBuckets,
  DAY_MS,
  recentSessions,
  streaks,
} from "./stats"

const now = new Date("2026-04-27T12:00:00Z").getTime()

const session = (overrides: Partial<Session> & { id: string; created: number; updated?: number }): Session => ({
  id: overrides.id,
  slug: overrides.slug ?? overrides.id,
  projectID: overrides.projectID ?? "p",
  directory: overrides.directory ?? "/proj",
  title: overrides.title ?? overrides.id,
  version: overrides.version ?? "1",
  time: {
    created: overrides.created,
    updated: overrides.updated ?? overrides.created,
    archived: overrides.time?.archived,
  },
  summary: overrides.summary,
  parentID: overrides.parentID,
})

const dayAgo = (days: number) => now - days * DAY_MS

const diff = (file: string, additions: number, deletions: number): SnapshotFileDiff => ({
  file,
  patch: "",
  additions,
  deletions,
})

const patchDiff = (file: string, patch: string): SnapshotFileDiff => ({
  file,
  patch,
  additions: 0,
  deletions: 0,
  status: "modified",
})

const assistant = (overrides: {
  id: string
  sessionID: string
  created: number
  modelID?: string
  providerID?: string
  tokens?: Partial<AssistantMessage["tokens"]>
}): AssistantMessage =>
  ({
    id: overrides.id,
    sessionID: overrides.sessionID,
    role: "assistant",
    time: { created: overrides.created },
    parentID: "u" + overrides.id,
    modelID: overrides.modelID ?? "claude-opus-4-7",
    providerID: overrides.providerID ?? "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      total: overrides.tokens?.total,
      input: overrides.tokens?.input ?? 0,
      output: overrides.tokens?.output ?? 0,
      reasoning: overrides.tokens?.reasoning ?? 0,
      cache: { read: overrides.tokens?.cache?.read ?? 0, write: overrides.tokens?.cache?.write ?? 0 },
    },
  }) as AssistantMessage

const user = (overrides: { id: string; sessionID: string; created: number }): Message =>
  ({
    id: overrides.id,
    sessionID: overrides.sessionID,
    role: "user",
    time: { created: overrides.created },
    agent: "default",
    model: { providerID: "anthropic", modelID: "claude-opus-4-7" },
  }) as Message

const emptyMessages: Message[] = []

describe("aggregateProjects", () => {
  test("counts visible sessions and aggregates summary", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [
          session({ id: "1", created: dayAgo(0), summary: { additions: 10, deletions: 5, files: 2 } }),
          session({ id: "2", created: dayAgo(1), summary: { additions: 1, deletions: 1, files: 1 } }),
          session({ id: "child", created: dayAgo(0), parentID: "1" }),
        ],
      },
      {
        directory: "/b",
        worktree: "/b",
        name: "B",
        sessions: [session({ id: "3", created: dayAgo(2), summary: { additions: 4, deletions: 0, files: 1 } })],
      },
    ])

    expect(projects).toHaveLength(2)
    expect(projects[0]).toMatchObject({ name: "A", sessions: 2, files: 3, additions: 11, deletions: 6 })
    expect(projects[1]).toMatchObject({ name: "B", sessions: 1, files: 1, additions: 4, deletions: 0 })
  })

  test("falls back to cached session diffs when summary has no changes", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [
          session({ id: "1", created: dayAgo(0), summary: { additions: 0, deletions: 0, files: 0 } }),
          session({
            id: "2",
            created: dayAgo(1),
            summary: { additions: 0, deletions: 0, files: 0, diffs: [diff("src/b.ts", 2, 2)] },
          }),
        ],
        sessionDiffs: {
          "1": [diff("src/a.ts", 3, 0), diff("src/a.ts", 2, 0), diff("src/old.ts", 0, 4), diff("src/same.ts", 0, 0)],
        },
      },
    ])

    expect(projects[0]).toMatchObject({ sessions: 2, files: 3, additions: 7, deletions: 6 })
  })

  test("counts changed files and parses patch lines when diff totals are missing", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [
          session({ id: "patch", created: dayAgo(0), summary: { additions: 0, deletions: 0, files: 0 } }),
          session({ id: "binary", created: dayAgo(0), summary: { additions: 0, deletions: 0, files: 0 } }),
        ],
        sessionDiffs: {
          patch: [
            patchDiff(
              "src/a.ts",
              ["--- src/a.ts", "+++ src/a.ts", "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+extra"].join("\n"),
            ),
          ],
          binary: [{ ...diff("assets/logo.png", 0, 0), status: "modified" }],
        },
      },
    ])

    expect(projects[0]).toMatchObject({ sessions: 2, files: 2, additions: 2, deletions: 1 })
  })

  test("fills missing summary line counts from cached diffs", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [session({ id: "1", created: dayAgo(0), summary: { additions: 0, deletions: 0, files: 1 } })],
        sessionDiffs: {
          "1": [
            patchDiff(
              "src/a.ts",
              ["--- src/a.ts", "+++ src/a.ts", "@@ -1 +1,2 @@", "-old", "+new", "+extra"].join("\n"),
            ),
          ],
        },
      },
    ])

    expect(projects[0]).toMatchObject({ sessions: 1, files: 1, additions: 2, deletions: 1 })
  })

  test("uses summary diffs when cached diffs are empty", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [
          session({
            id: "1",
            created: dayAgo(0),
            summary: { additions: 0, deletions: 0, files: 0, diffs: [diff("src/a.ts", 3, 1)] },
          }),
        ],
        sessionDiffs: {
          "1": [],
        },
      },
    ])

    expect(projects[0]).toMatchObject({ sessions: 1, files: 1, additions: 3, deletions: 1 })
  })

  test("sorts by session count then last activity", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [session({ id: "1", created: dayAgo(5) })],
      },
      {
        directory: "/b",
        worktree: "/b",
        name: "B",
        sessions: [session({ id: "2", created: dayAgo(0) })],
      },
      {
        directory: "/c",
        worktree: "/c",
        name: "C",
        sessions: [session({ id: "3", created: dayAgo(0) }), session({ id: "4", created: dayAgo(1) })],
      },
    ])

    expect(projects.map((p) => p.name)).toEqual(["C", "B", "A"])
  })

  test("counts archived sessions separately", () => {
    const projects = aggregateProjects([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [
          session({ id: "1", created: dayAgo(0) }),
          session({
            id: "old",
            created: dayAgo(40),
            time: { created: dayAgo(40), archived: dayAgo(30) } as Session["time"],
          }),
        ],
      },
    ])
    expect(projects[0]?.sessions).toBe(1)
    expect(projects[0]?.archived).toBe(1)
  })
})

describe("aggregateTotals", () => {
  test("counts today, this week, messages and tokens", () => {
    const sessions: Session[] = [
      session({ id: "today", created: now }),
      session({ id: "yesterday", created: dayAgo(1) }),
      session({ id: "weekAgo", created: dayAgo(6) }),
      session({ id: "old", created: dayAgo(8) }),
    ]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const messages = [
      { message: assistant({ id: "1", sessionID: "today", created: now, tokens: { input: 10, output: 20 } }), sessionID: "today" },
      { message: user({ id: "2", sessionID: "today", created: now }), sessionID: "today" },
      { message: assistant({ id: "3", sessionID: "yesterday", created: dayAgo(1), tokens: { total: 100 } }), sessionID: "yesterday" },
    ]
    const totals = aggregateTotals(projects, sessions, messages, now, "all")
    expect(totals).toMatchObject({
      projects: 1,
      sessions: 4,
      today: 1,
      thisWeek: 3,
      messages: 3,
      tokens: 130,
      activeDays: 2,
    })
  })

  test("excludes archived sessions from active counts", () => {
    const sessions: Session[] = [
      session({ id: "live", created: now }),
      session({ id: "archived", created: now, time: { created: now, archived: now } as Session["time"] }),
    ]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const totals = aggregateTotals(projects, sessions, [], now, "all")
    expect(totals.sessions).toBe(1)
    expect(totals.archived).toBe(1)
  })

  test("identifies peak hour and preferred model", () => {
    const sessions: Session[] = [session({ id: "s", created: now })]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const messages = [
      { message: assistant({ id: "1", sessionID: "s", created: new Date(2026, 3, 27, 10).getTime(), modelID: "opus" }), sessionID: "s" },
      { message: assistant({ id: "2", sessionID: "s", created: new Date(2026, 3, 27, 10).getTime(), modelID: "opus" }), sessionID: "s" },
      { message: assistant({ id: "3", sessionID: "s", created: new Date(2026, 3, 27, 14).getTime(), modelID: "sonnet" }), sessionID: "s" },
    ]
    const totals = aggregateTotals(projects, sessions, messages, now, "all")
    expect(totals.peakHour).toBe(10)
    expect(totals.preferredModel?.modelID).toBe("opus")
    expect(totals.preferredModel?.messages).toBe(2)
  })

  test("filters by range", () => {
    const sessions: Session[] = [session({ id: "s", created: dayAgo(20) })]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const messages = [
      { message: assistant({ id: "old", sessionID: "s", created: dayAgo(20), tokens: { total: 50 } }), sessionID: "s" },
      { message: assistant({ id: "new", sessionID: "s", created: dayAgo(2), tokens: { total: 10 } }), sessionID: "s" },
    ]
    const totalsAll = aggregateTotals(projects, sessions, messages, now, "all")
    const totals7d = aggregateTotals(projects, sessions, messages, now, "7d")
    expect(totalsAll.tokens).toBe(60)
    expect(totals7d.tokens).toBe(10)
  })
})

describe("streaks", () => {
  test("computes current and longest streak", () => {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const start = today.getTime()
    const days = new Set([start, start - DAY_MS, start - 2 * DAY_MS, start - 5 * DAY_MS, start - 6 * DAY_MS])
    const result = streaks(days, now)
    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
  })

  test("returns zero for empty set", () => {
    expect(streaks(new Set(), now)).toEqual({ current: 0, longest: 0 })
  })
})

describe("aggregateModels", () => {
  test("breaks down by model with tokens and session counts", () => {
    const messages = [
      { message: assistant({ id: "1", sessionID: "s1", created: now, modelID: "opus", tokens: { total: 100 } }), sessionID: "s1" },
      { message: assistant({ id: "2", sessionID: "s2", created: now, modelID: "opus", tokens: { total: 50 } }), sessionID: "s2" },
      { message: assistant({ id: "3", sessionID: "s1", created: now, modelID: "sonnet", tokens: { total: 30 } }), sessionID: "s1" },
    ]
    const breakdown = aggregateModels(messages, now, "all")
    expect(breakdown[0]).toMatchObject({ modelID: "opus", messages: 2, tokens: 150, sessions: 2 })
    expect(breakdown[1]).toMatchObject({ modelID: "sonnet", messages: 1, tokens: 30, sessions: 1 })
  })
})

describe("dailyBuckets", () => {
  test("always returns 364 buckets ending today", () => {
    const messages = [
      { message: assistant({ id: "1", sessionID: "s", created: now }), sessionID: "s" },
      { message: assistant({ id: "2", sessionID: "s", created: now - 1000 * 60 * 60 }), sessionID: "s" },
      { message: assistant({ id: "3", sessionID: "s", created: dayAgo(1) }), sessionID: "s" },
      { message: assistant({ id: "4", sessionID: "s", created: dayAgo(13) }), sessionID: "s" },
      { message: assistant({ id: "5", sessionID: "s", created: dayAgo(40) }), sessionID: "s" },
      { message: assistant({ id: "6", sessionID: "s", created: dayAgo(400) }), sessionID: "s" },
    ]
    const buckets = dailyBuckets(messages, now)
    expect(buckets).toHaveLength(364)
    expect(buckets[buckets.length - 1]?.count).toBe(2)
    expect(buckets[buckets.length - 2]?.count).toBe(1)
    expect(buckets[buckets.length - 14]?.count).toBe(1)
    expect(buckets[buckets.length - 41]?.count).toBe(1)
    // anything older than 364 days is dropped
    expect(buckets.reduce((total, b) => total + b.count, 0)).toBe(5)
  })

  test("empty input still returns 364 zero-count buckets", () => {
    const buckets = dailyBuckets([], now)
    expect(buckets).toHaveLength(364)
    expect(buckets.every((b) => b.count === 0)).toBe(true)
  })
})

describe("recentSessions", () => {
  test("returns most recent across projects with project info", () => {
    const recent = recentSessions(
      [
        {
          directory: "/a",
          worktree: "/a",
          name: "A",
          iconColor: "pink",
          sessions: [
            session({ id: "old", created: dayAgo(2) }),
            session({ id: "new", created: dayAgo(0), title: "Latest" }),
          ],
        },
        {
          directory: "/b",
          worktree: "/b",
          name: "B",
          sessions: [session({ id: "mid", created: dayAgo(1) })],
        },
      ],
      2,
    )

    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({ id: "new", title: "Latest", projectName: "A", projectColor: "pink" })
    expect(recent[1]).toMatchObject({ id: "mid", projectName: "B" })
  })

  test("includes file and line stats from cached diffs", () => {
    const recent = recentSessions([
      {
        directory: "/a",
        worktree: "/a",
        name: "A",
        sessions: [session({ id: "latest", created: dayAgo(0), summary: { additions: 0, deletions: 0, files: 0 } })],
        sessionDiffs: {
          latest: [diff("src/a.ts", 10, 1), diff("src/b.ts", 0, 3)],
        },
      },
    ])

    expect(recent[0]).toMatchObject({ id: "latest", files: 2, additions: 10, deletions: 4 })
  })
})

describe("buildHomeStats", () => {
  test("composes the full result with messages", () => {
    const stats = buildHomeStats(
      [
        {
          directory: "/a",
          worktree: "/a",
          name: "A",
          sessions: [session({ id: "1", created: now, summary: { additions: 1, deletions: 0, files: 1 } })],
          sessionMessages: {
            "1": [assistant({ id: "m1", sessionID: "1", created: now, tokens: { total: 42 } })],
          },
        },
      ],
      now,
      "all",
    )
    expect(stats.totals.projects).toBe(1)
    expect(stats.totals.sessions).toBe(1)
    expect(stats.totals.messages).toBe(1)
    expect(stats.totals.tokens).toBe(42)
    expect(stats.projects[0]?.name).toBe("A")
    expect(stats.recent[0]?.id).toBe("1")
    expect(stats.buckets).toHaveLength(364)
    expect(stats.buckets.at(-1)?.count).toBe(1)
    expect(stats.models[0]?.modelID).toBe("claude-opus-4-7")
  })

  test("handles missing message data gracefully", () => {
    const stats = buildHomeStats(
      [
        {
          directory: "/a",
          worktree: "/a",
          name: "A",
          sessions: [session({ id: "1", created: now })],
        },
      ],
      now,
      "all",
    )
    expect(stats.totals.messages).toBe(0)
    expect(stats.totals.tokens).toBe(0)
    expect(stats.models).toHaveLength(0)
  })
})

// avoid "declared but unused" if no test references it
void emptyMessages
