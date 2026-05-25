import { describe, expect, test } from "bun:test"
import type { AssistantMessage } from "@codeplane-ai/sdk/v2/client"
import {
  aggregateSessionMessages,
  combineMaterializedStats,
  emptyMaterializedHomeStats,
  SESSION_AGGREGATE_VERSION,
} from "./aggregate"
import { normalizeHomeCacheStore } from "./cache"
import { startOfDay } from "./stats"

const now = new Date("2026-05-19T12:00:00Z").getTime()

const assistant = (overrides: { id: string; sessionID: string; tokens: number }): AssistantMessage =>
  ({
    id: overrides.id,
    sessionID: overrides.sessionID,
    role: "assistant",
    time: { created: now },
    parentID: `p-${overrides.id}`,
    modelID: "opus",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { total: overrides.tokens, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as AssistantMessage

describe("normalizeHomeCacheStore", () => {
  test("migrates v4 aggregate-only storage into v5 materialized stats", () => {
    const aggregate = aggregateSessionMessages("s", now, [assistant({ id: "a", sessionID: "s", tokens: 123 })])

    const store = normalizeHomeCacheStore({ version: 4, aggregates: { s: aggregate } })

    expect(store.version).toBe(SESSION_AGGREGATE_VERSION)
    expect(store.aggregates.s).toEqual(aggregate)
    expect(combineMaterializedStats(store.materialized, now, "all")).toMatchObject({ messages: 1, tokens: 123 })
  })

  test("reads current v5 counters from materialized storage", () => {
    const aggregate = aggregateSessionMessages("s", now, [assistant({ id: "a", sessionID: "s", tokens: 123 })])
    const materialized = emptyMaterializedHomeStats()
    materialized.days[startOfDay(now)] = {
      count: 9,
      tokens: 900,
      hours: Array.from({ length: 24 }, () => 0),
      models: {},
      git: { commits: 0 },
    }

    const store = normalizeHomeCacheStore({
      version: SESSION_AGGREGATE_VERSION,
      aggregates: { s: aggregate },
      materialized,
    })

    expect(combineMaterializedStats(store.materialized, now, "all")).toMatchObject({ messages: 9, tokens: 900 })
  })
})
