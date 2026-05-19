import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@codeplane-ai/sdk/v2/client"
import {
  childSessionIndex,
  childSessionOnPath,
  childSessions,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasMoreVisibleSessions,
  hasProjectPermissions,
  latestRootSession,
  loadedRootSessionCount,
  sortedRootSessions,
  workspaceKey,
} from "./helpers"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("codeplane://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("codeplane://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("codeplane://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("codeplane://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("codeplane://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("codeplane://open-project")).toBeUndefined()
    expect(parseDeepLink("codeplane://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "codeplane://open-project?directory=/a",
      "codeplane://other?directory=/b",
      "codeplane://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("codeplane://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("codeplane://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("codeplane://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("codeplane://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "codeplane://new-session?directory=/a",
      "codeplane://open-project?directory=/b",
      "codeplane://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __CODEPLANE__: {
        deepLinks: ["codeplane://open-project?directory=/a"],
      },
    } as unknown as Window & { __CODEPLANE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["codeplane://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(workspaceKey("/tmp/demo///")).toBe("/tmp/demo")
    expect(workspaceKey("C:\\tmp\\demo\\\\")).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(workspaceKey("/")).toBe("/")
    expect(workspaceKey("///")).toBe("/")
    expect(workspaceKey("C:\\")).toBe("C:/")
    expect(workspaceKey("C://")).toBe("C:/")
    expect(workspaceKey("C:///")).toBe("C:/")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("treats nested directories as part of the workspace", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "nested",
              directory: "/workspace/packages/app",
              time: { created: 2, updated: 2, archived: undefined },
            }),
            session({
              id: "sibling",
              directory: "/workspace-other",
              time: { created: 3, updated: 3, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("nested")
  })

  test("filters nested project sessions by project id", () => {
    const result = sortedRootSessions(
      {
        project: "parent",
        path: { directory: "/workspace" },
        session: [
          session({
            id: "parent-session",
            projectID: "parent",
            directory: "/workspace",
            time: { created: 2, updated: 2, archived: undefined },
          }),
          session({
            id: "child-session",
            projectID: "child",
            directory: "/workspace/nested-project",
            time: { created: 3, updated: 3, archived: undefined },
          }),
        ],
      },
      120_000,
      "/workspace",
    )

    expect(result.map((item) => item.id)).toEqual(["parent-session"])
  })

  test("uses explicit workspace directory when resolved path differs", () => {
    const result = sortedRootSessions(
      {
        path: { directory: "/resolved/workspace" },
        session: [
          session({
            id: "kept",
            directory: "/requested/workspace",
            time: { created: 2, updated: 2, archived: undefined },
          }),
          session({
            id: "other",
            directory: "/elsewhere",
            time: { created: 3, updated: 3, archived: undefined },
          }),
        ],
      },
      120_000,
      "/requested/workspace",
    )

    expect(result.map((item) => item.id)).toEqual(["kept"])
  })

  test("excludes cron sessions from the root session list", () => {
    const result = sortedRootSessions(
      {
        path: { directory: "/workspace" },
        session: [
          session({
            id: "regular",
            directory: "/workspace",
            title: "Hello world",
            time: { created: 1, updated: 1, archived: undefined },
          }),
          session({
            id: "cron-by-id",
            directory: "/workspace",
            title: "any title",
            time: { created: 2, updated: 2, archived: undefined },
            ...({ cronRunID: "run-1" } as Partial<Session>),
          }),
          session({
            id: "cron-by-title",
            directory: "/workspace",
            title: "[Cron] daily report",
            time: { created: 3, updated: 3, archived: undefined },
          }),
        ],
      },
      120_000,
      "/workspace",
    )

    expect(result.map((item) => item.id)).toEqual(["regular"])
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("lists direct child sessions by recency", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "old", directory: "/workspace", parentID: "root", time: { created: 1, updated: 1 } }),
      session({ id: "new", directory: "/workspace", parentID: "root", time: { created: 2, updated: 3 } }),
      session({
        id: "archived",
        directory: "/workspace",
        parentID: "root",
        time: { created: 4, updated: 4, archived: 4 },
      }),
      session({ id: "leaf", directory: "/workspace", parentID: "new", time: { created: 5, updated: 5 } }),
    ]

    expect(childSessions(list, "root", 120_000).map((item) => item.id)).toEqual(["new", "old"])
  })

  test("indexes visible child sessions by parent", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "old", directory: "/workspace", parentID: "root", time: { created: 1, updated: 1 } }),
      session({ id: "new", directory: "/workspace", parentID: "root", time: { created: 2, updated: 3 } }),
      session({
        id: "archived",
        directory: "/workspace",
        parentID: "root",
        time: { created: 4, updated: 4, archived: 4 },
      }),
      session({ id: "leaf", directory: "/workspace", parentID: "new", time: { created: 5, updated: 5 } }),
    ]

    const result = childSessionIndex(list, 120_000)

    expect(result.get("root")?.map((item) => item.id)).toEqual(["new", "old"])
    expect(result.get("new")?.map((item) => item.id)).toEqual(["leaf"])
    expect(result.get("archived")).toBeUndefined()
  })

  test("keeps load more visible only while unloaded visible sessions may remain", () => {
    expect(hasMoreVisibleSessions({ loadedRootCount: 3, total: 5, visible: 3 })).toBe(true)
    expect(hasMoreVisibleSessions({ loadedRootCount: 5, total: 5, visible: 3 })).toBe(false)
    expect(hasMoreVisibleSessions({ loadedRootCount: 3, total: 3, visible: 3 })).toBe(false)
  })

  test("counts loaded root sessions without applying visible-only sidebar filters", () => {
    const list = [
      session({ id: "visible", directory: "/workspace" }),
      session({ id: "cron", directory: "/workspace", title: "[Cron] daily report" }),
      session({ id: "child", directory: "/workspace", parentID: "visible" }),
      session({ id: "archived", directory: "/workspace", time: { created: 1, updated: 1, archived: 1 } }),
    ]

    expect(loadedRootSessionCount(list)).toBe(2)
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})
