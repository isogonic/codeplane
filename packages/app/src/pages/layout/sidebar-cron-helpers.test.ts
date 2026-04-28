import { describe, expect, test } from "bun:test"
import type { Session } from "@codeplane-ai/sdk/v2/client"
import type { CronRun } from "@/utils/cron-client"
import { cronSidebarEntries, cronTaskNameFromSessionTitle, isCronSessionInfo } from "./sidebar-cron-helpers"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory" | "title">) =>
  ({
    version: "v2",
    parentID: undefined,
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

const run = (input: Partial<CronRun> & Pick<CronRun, "id" | "taskID" | "status">) =>
  ({
    attempt: 1,
    time: { created: 0, updated: 0 },
    ...input,
  }) as CronRun

describe("cron sidebar helpers", () => {
  test("extracts task names from legacy cron session titles", () => {
    expect(cronTaskNameFromSessionTitle("[Cron] Tetris")).toBe("Tetris")
    expect(cronTaskNameFromSessionTitle("Tetris")).toBeUndefined()
  })

  test("detects legacy and current cron sessions", () => {
    expect(isCronSessionInfo({ title: "[Cron] Tetris" })).toBe(true)
    expect(isCronSessionInfo({ title: "Tetris", cronRunID: "run_1" })).toBe(true)
    expect(isCronSessionInfo({ title: "Tetris" })).toBe(false)
  })

  test("includes legacy cron sessions that no longer have cron_run rows", () => {
    const entries = cronSidebarEntries({
      directory: "/project",
      runs: [
        {
          ...run({
            id: "run_1",
            taskID: "task_1",
            sessionID: "session_run",
            status: "success",
            time: { created: 20, updated: 20 },
          }),
          taskName: "Run task",
          taskDirectory: "/project",
        },
      ],
      sessions: [
        session({
          id: "session_legacy",
          directory: "/project",
          title: "[Cron] Legacy task",
          time: { created: 10, updated: 10, archived: undefined },
        }),
        session({
          id: "session_run",
          directory: "/project",
          title: "[Cron] Run task",
          time: { created: 20, updated: 20, archived: undefined },
        }),
        session({
          id: "session_normal",
          directory: "/project",
          title: "Normal chat",
          time: { created: 30, updated: 30, archived: undefined },
        }),
      ],
    })

    expect(entries.map((entry) => entry.sessionID)).toEqual(["session_run", "session_legacy"])
    expect(entries.map((entry) => entry.taskName)).toEqual(["Run task", "Legacy task"])
    expect(entries.map((entry) => entry.sequence)).toEqual([2, 1])
  })

  test("includes legacy cron sessions from each project directory", () => {
    const entries = cronSidebarEntries({
      directories: ["/project", "/tmp/project-worktree"],
      runs: [],
      sessions: [
        session({
          id: "session_root",
          directory: "/project",
          title: "[Cron] Root task",
          time: { created: 10, updated: 10, archived: undefined },
        }),
        session({
          id: "session_sandbox",
          directory: "/tmp/project-worktree",
          title: "[Cron] Sandbox task",
          time: { created: 20, updated: 20, archived: undefined },
        }),
        session({
          id: "session_other",
          directory: "/other",
          title: "[Cron] Other task",
          time: { created: 30, updated: 30, archived: undefined },
        }),
      ],
    })

    expect(entries.map((entry) => entry.sessionID)).toEqual(["session_sandbox", "session_root"])
  })
})
