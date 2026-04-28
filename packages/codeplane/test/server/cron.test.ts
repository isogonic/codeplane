import { afterEach, describe, expect, test } from "bun:test"
import { Project } from "../../src/project"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await resetDatabase()
})

describe("cron routes", () => {
  test("creates a task by directory and registers the project when projectID is omitted", async () => {
    await using tmp = await tmpdir({ git: true })

    const res = await Server.Default().app.request("/global/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directory: tmp.path,
        name: "directory-only",
        prompt: "Run from directory",
        schedule: { kind: "cron", expression: "0 9 * * 1-5" },
        status: "active",
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    const project = Project.list().find((item) => item.worktree === tmp.path)

    expect(project).toBeDefined()
    expect(body).toMatchObject({
      projectID: project?.id,
      directory: tmp.path,
      name: "directory-only",
    })
  })
})
