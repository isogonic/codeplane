import { describe, expect, test } from "bun:test"
import { taskAgent, taskChildSession, taskSubtitle } from "./message-part-task"
import type { Session } from "@codeplane-ai/sdk/v2"

describe("taskAgent", () => {
  test("returns empty object for non-string input", () => {
    expect(taskAgent(undefined)).toEqual({})
    expect(taskAgent(null)).toEqual({})
    expect(taskAgent({})).toEqual({})
    expect(taskAgent(42)).toEqual({})
  })

  test("returns empty object for empty string", () => {
    expect(taskAgent("")).toEqual({})
  })

  test("capitalizes first letter when no list given", () => {
    expect(taskAgent("ask").name).toBe("Ask")
    expect(taskAgent("build").name).toBe("Build")
    expect(taskAgent("custom").name).toBe("Custom")
  })

  test("returns ask color for 'ask'", () => {
    expect(taskAgent("ask").color).toContain("ask")
  })

  test("returns build color for 'build'", () => {
    expect(taskAgent("build").color).toContain("build")
  })

  test("returns docs color for 'docs'", () => {
    expect(taskAgent("docs").color).toContain("docs")
  })

  test("returns plan color for 'plan'", () => {
    expect(taskAgent("plan").color).toContain("plan")
  })

  test("uses provided agent list when name matches", () => {
    const list = [{ name: "MyAgent", color: "red" }]
    expect(taskAgent("MyAgent", list)).toEqual({ name: "MyAgent", color: "red" })
  })

  test("matches case-insensitively", () => {
    const list = [{ name: "MyAgent", color: "red" }]
    expect(taskAgent("myagent", list).name).toBe("MyAgent")
  })

  test("falls back to capitalize for unknown agent name", () => {
    const list = [{ name: "Other" }]
    expect(taskAgent("foo", list).name).toBe("Foo")
  })

  test("uses generated tone for unknown agent name", () => {
    const result = taskAgent("xyzabc")
    expect(typeof result.color).toBe("string")
    expect(result.color!.length).toBeGreaterThan(0)
  })

  test("same name produces same color (deterministic)", () => {
    expect(taskAgent("foo").color).toBe(taskAgent("foo").color)
  })
})

describe("taskChildSession", () => {
  const session = (over: Partial<Session> = {}) =>
    ({
      id: "ses_x",
      parentID: "ses_parent",
      title: "title",
      time: { created: 1 },
      ...over,
    }) as unknown as Session

  test("returns metadata sessionId when provided", () => {
    expect(taskChildSession({}, { sessionId: "ses_meta" }, "/session/ses_parent", [])).toBe("ses_meta")
  })

  test("non-string sessionId is ignored", () => {
    expect(
      taskChildSession({}, { sessionId: 123 } as any, "/session/ses_parent", []),
    ).toBeUndefined()
  })

  test("returns undefined when no parent in path", () => {
    expect(taskChildSession({}, {}, "/no-session", [])).toBeUndefined()
  })

  test("matches session by parentID", () => {
    const child = session({ id: "ses_child", parentID: "ses_p", title: "any" })
    const result = taskChildSession({}, {}, "/session/ses_p", [child])
    expect(result).toBe("ses_child")
  })

  test("filters out archived sessions", () => {
    const child = session({ id: "ses_child", parentID: "ses_p", title: "any", time: { created: 1, archived: true } as any })
    expect(taskChildSession({}, {}, "/session/ses_p", [child])).toBeUndefined()
  })

  test("matches session by description prefix", () => {
    const a = session({ id: "ses_a", parentID: "ses_p", title: "different work" })
    const b = session({ id: "ses_b", parentID: "ses_p", title: "fix auth bug" })
    expect(taskChildSession({ description: "fix auth" }, {}, "/session/ses_p", [a, b])).toBe("ses_b")
  })

  test("returns undefined when no matching session", () => {
    expect(taskChildSession({}, {}, "/session/ses_p", [])).toBeUndefined()
  })

  test("picks newest matching session when multiple match", () => {
    const a = session({ id: "ses_a", parentID: "ses_p", title: "any", time: { created: 1, updated: 1 } })
    const b = session({ id: "ses_b", parentID: "ses_p", title: "any", time: { created: 2, updated: 2 } })
    expect(taskChildSession({}, {}, "/session/ses_p", [a, b])).toBe("ses_b")
  })
})

describe("taskSubtitle", () => {
  test("removes a duplicated task title prefix from the description", () => {
    expect(taskSubtitle("Explore", "Explore website codebase")).toBe("website codebase")
    expect(taskSubtitle("Explore", "Explore: website codebase")).toBe("website codebase")
    expect(taskSubtitle("Explore", "Explore - website codebase")).toBe("website codebase")
  })

  test("keeps unrelated descriptions untouched", () => {
    expect(taskSubtitle("Explore", "Inspect the auth flow")).toBe("Inspect the auth flow")
  })

  test("drops empty or title-only descriptions", () => {
    expect(taskSubtitle("Explore", "Explore")).toBeUndefined()
    expect(taskSubtitle("Explore", "  ")).toBeUndefined()
    expect(taskSubtitle("Explore", undefined)).toBeUndefined()
  })
})
