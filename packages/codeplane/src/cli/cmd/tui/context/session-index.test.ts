import { describe, expect, test } from "bun:test"
import type { Session } from "@codeplane-ai/sdk/v2"
import { SESSION_INDEX_LIMIT, loadSessionIndex, sessionIndexQuery, sortSessionIndex } from "./session-index"

describe("tui session index", () => {
  test("queries root active sessions without an age cutoff", () => {
    const query = sessionIndexQuery()

    expect(query).toEqual({ roots: true, archived: false, limit: SESSION_INDEX_LIMIT })
    expect("start" in query).toBe(false)
  })

  test("loads and sorts sessions by id for binary search", async () => {
    const calls: Array<ReturnType<typeof sessionIndexQuery>> = []
    const sessions = await loadSessionIndex({
      session: {
        list: async (query) => {
          calls.push(query)
          return {
            data: [{ id: "ses_b" } as Session, { id: "ses_a" } as Session],
          }
        },
      },
    })

    expect(calls).toEqual([sessionIndexQuery()])
    expect(sessions.map((session) => session.id)).toEqual(["ses_a", "ses_b"])
  })

  test("filters invalid items before sorting", () => {
    const sessions = sortSessionIndex([undefined as unknown as Session, { id: "ses_b" } as Session])

    expect(sessions.map((session) => session.id)).toEqual(["ses_b"])
  })
})
