import { describe, expect, test } from "bun:test"
import type { Session, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import { aggregateProjects, aggregateTotals, buildHomeStats, dailyBuckets, DAY_MS, recentSessions } from "./stats"

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
  test("counts today and this week correctly", () => {
    const sessions: Session[] = [
      session({ id: "today", created: now }),
      session({ id: "yesterday", created: dayAgo(1) }),
      session({ id: "weekAgo", created: dayAgo(6) }),
      session({ id: "old", created: dayAgo(8) }),
    ]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const totals = aggregateTotals(projects, sessions, now)
    expect(totals).toMatchObject({
      projects: 1,
      sessions: 4,
      today: 1,
      thisWeek: 3,
    })
  })

  test("excludes archived sessions from active counts", () => {
    const sessions: Session[] = [
      session({ id: "live", created: now }),
      session({ id: "archived", created: now, time: { created: now, archived: now } as Session["time"] }),
    ]
    const projects = aggregateProjects([{ directory: "/a", worktree: "/a", name: "A", sessions }])
    const totals = aggregateTotals(projects, sessions, now)
    expect(totals.sessions).toBe(1)
    expect(totals.archived).toBe(1)
  })
})

describe("dailyBuckets", () => {
  test("buckets sessions by day, oldest first", () => {
    const sessions: Session[] = [
      session({ id: "today", created: now }),
      session({ id: "today2", created: now - 1000 * 60 * 60 }),
      session({ id: "y", created: dayAgo(1) }),
      session({ id: "old", created: dayAgo(13) }),
      session({ id: "tooOld", created: dayAgo(20) }),
    ]
    const buckets = dailyBuckets(sessions, now, 14)
    expect(buckets).toHaveLength(14)
    expect(buckets[buckets.length - 1]?.count).toBe(2)
    expect(buckets[buckets.length - 2]?.count).toBe(1)
    expect(buckets[0]?.count).toBe(1)
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
  test("composes the full result", () => {
    const stats = buildHomeStats(
      [
        {
          directory: "/a",
          worktree: "/a",
          name: "A",
          sessions: [session({ id: "1", created: now, summary: { additions: 1, deletions: 0, files: 1 } })],
        },
      ],
      now,
    )
    expect(stats.totals.projects).toBe(1)
    expect(stats.totals.sessions).toBe(1)
    expect(stats.projects[0]?.name).toBe("A")
    expect(stats.recent[0]?.id).toBe("1")
    expect(stats.buckets.at(-1)?.count).toBe(1)
  })
})
