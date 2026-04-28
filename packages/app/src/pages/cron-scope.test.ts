import { describe, expect, test } from "bun:test"
import {
  cronProjectDirectories,
  cronProjectForDirectory,
  cronProjectIDForRoute,
  cronTaskInScope,
} from "./cron-scope"

describe("cron scope helpers", () => {
  test("deduplicates project worktree and sandboxes", () => {
    expect(
      cronProjectDirectories({
        id: "project_1",
        worktree: "/repo/",
        sandboxes: ["/repo", "/repo-worktree"],
      }),
    ).toEqual(["/repo/", "/repo-worktree"])
  })

  test("uses project id as the strict task scope when available", () => {
    expect(
      cronTaskInScope(
        { projectID: "project_1", directory: "/other" },
        { projectID: "project_1", directory: "/repo" },
      ),
    ).toBe(true)
    expect(
      cronTaskInScope(
        { projectID: "project_2", directory: "/repo" },
        { projectID: "project_1", directory: "/repo" },
      ),
    ).toBe(false)
  })

  test("falls back to project directories when no project id is available", () => {
    const project = { worktree: "/repo", sandboxes: ["/tmp/repo-sandbox"] }
    expect(cronTaskInScope({ projectID: "project_1", directory: "/repo" }, { project })).toBe(true)
    expect(cronTaskInScope({ projectID: "project_1", directory: "/tmp/repo-sandbox" }, { project })).toBe(true)
    expect(cronTaskInScope({ projectID: "project_2", directory: "/other" }, { project })).toBe(false)
  })

  test("preserves the route project id while project metadata is still loading", () => {
    expect(cronProjectForDirectory("/repo", [], "project_1")).toEqual({
      id: "project_1",
      worktree: "/repo",
    })
    expect(cronProjectIDForRoute({ worktree: "/repo" }, "project_1")).toBe("project_1")
  })

  test("prefers the matching project metadata over a route fallback", () => {
    expect(
      cronProjectForDirectory(
        "/repo/packages/app",
        [
          { id: "project_1", worktree: "/repo" },
          { id: "project_2", worktree: "/repo/packages/app" },
        ],
        "project_1",
      ),
    ).toEqual({ id: "project_1", worktree: "/repo" })
  })
})
