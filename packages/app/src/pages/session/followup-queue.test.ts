import { describe, expect, test } from "bun:test"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { nextRunnableFollowup, type FollowupItem, type FollowupSession } from "./followup-queue"

const draft = (input: Partial<FollowupDraft> & Pick<FollowupDraft, "sessionID" | "sessionDirectory">) =>
  ({
    prompt: [{ type: "text", content: "next", start: 0, end: 4 }],
    context: [],
    agent: "agent",
    model: { providerID: "provider", modelID: "model" },
    ...input,
  }) as FollowupDraft

const item = (id: string, input: Partial<FollowupDraft> & Pick<FollowupDraft, "sessionID" | "sessionDirectory">) =>
  ({
    id,
    ...draft(input),
  }) as FollowupItem

const session = (input: Partial<FollowupSession> & Pick<FollowupSession, "id">) =>
  ({
    time: {},
    ...input,
  }) as FollowupSession

describe("nextRunnableFollowup", () => {
  test("keeps draining queued follow-ups for sessions that are not currently visible", () => {
    const hidden = item("message-002", { sessionID: "hidden", sessionDirectory: "/repo" })
    const visible = item("message-003", { sessionID: "visible", sessionDirectory: "/repo" })

    const next = nextRunnableFollowup({
      items: {
        hidden: [hidden],
        visible: [visible],
      },
      failed: {},
      paused: {},
      sending: false,
      session: (id) => session({ id }),
      busy: (id) => id === "visible",
      blocked: () => false,
    })

    expect(next).toEqual({ sessionID: "hidden", item: hidden })
  })

  test("does not start another follow-up while one is already being submitted", () => {
    const queued = item("message-001", { sessionID: "session", sessionDirectory: "/repo" })

    const next = nextRunnableFollowup({
      items: { session: [queued] },
      failed: {},
      paused: {},
      sending: true,
      session: (id) => session({ id }),
      busy: () => false,
      blocked: () => false,
    })

    expect(next).toBeUndefined()
  })

  test("skips blocked, paused, failed, child, archived, cron, and busy sessions", () => {
    const runnable = item("message-008", { sessionID: "runnable", sessionDirectory: "/repo" })

    const next = nextRunnableFollowup({
      items: {
        blocked: [item("message-000", { sessionID: "blocked", sessionDirectory: "/repo" })],
        missing: [item("message-001", { sessionID: "missing", sessionDirectory: "/repo" })],
        child: [item("message-002", { sessionID: "child", sessionDirectory: "/repo" })],
        archived: [item("message-003", { sessionID: "archived", sessionDirectory: "/repo" })],
        cron: [item("message-004", { sessionID: "cron", sessionDirectory: "/repo" })],
        paused: [item("message-005", { sessionID: "paused", sessionDirectory: "/repo" })],
        failed: [item("message-006", { sessionID: "failed", sessionDirectory: "/repo" })],
        busy: [item("message-007", { sessionID: "busy", sessionDirectory: "/repo" })],
        runnable: [runnable],
      },
      failed: { failed: "message-006" },
      paused: { paused: true },
      sending: false,
      session: (id) => {
        if (id === "missing") return
        if (id === "child") return session({ id, parentID: "root" })
        if (id === "archived") return session({ id, time: { archived: 1 } })
        if (id === "cron") return session({ id, cronRunID: "cron-run" })
        return session({ id })
      },
      busy: (id) => id === "busy",
      blocked: (id) => id === "blocked",
    })

    expect(next).toEqual({ sessionID: "runnable", item: runnable })
  })

  test("only considers the first queued item per session", () => {
    const failedFirst = item("message-001", { sessionID: "session-a", sessionDirectory: "/repo" })
    const readySecond = item("message-002", { sessionID: "session-a", sessionDirectory: "/repo" })
    const other = item("message-003", { sessionID: "session-b", sessionDirectory: "/repo" })

    const next = nextRunnableFollowup({
      items: {
        "session-a": [failedFirst, readySecond],
        "session-b": [other],
      },
      failed: { "session-a": "message-001" },
      paused: {},
      sending: false,
      session: (id) => session({ id }),
      busy: () => false,
      blocked: () => false,
    })

    expect(next).toEqual({ sessionID: "session-b", item: other })
  })
})
