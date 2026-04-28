import { describe, expect, test } from "bun:test"
import { cronProjectDirectories, cronTaskInScope } from "./cron-scope"

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
})
