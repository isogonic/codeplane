import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Cron, CronScheduler } from "../../src/cron"
import { CronTaskTable } from "../../src/cron/cron.sql"
import { CronExpression } from "../../src/cron/expression"
import { Project } from "../../src/project"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  await AppRuntime.runPromise(CronScheduler.Service.use((svc) => svc.stop())).catch(() => undefined)
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

  test("rejects unstable timeout and retry values", async () => {
    await using tmp = await tmpdir({ git: true })

    const timeout = await Server.Default().app.request("/global/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directory: tmp.path,
        name: "bad-timeout",
        prompt: "Run from directory",
        schedule: { kind: "cron", expression: "0 9 * * 1-5" },
        timeoutMs: 0,
      }),
    })
    const retries = await Server.Default().app.request("/global/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directory: tmp.path,
        name: "bad-retries",
        prompt: "Run from directory",
        schedule: { kind: "cron", expression: "0 9 * * 1-5" },
        maxRetries: -1,
      }),
    })

    expect(timeout.status).toBe(400)
    expect(await timeout.json()).toMatchObject({
      name: "CronValidationError",
      data: { field: "timeoutMs" },
    })
    expect(retries.status).toBe(400)
    expect(await retries.json()).toMatchObject({
      name: "CronValidationError",
      data: { field: "maxRetries" },
    })
  })

  test("rejects malformed and impossible cron expressions", async () => {
    await using tmp = await tmpdir({ git: true })

    const malformed = await Server.Default().app.request("/global/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directory: tmp.path,
        name: "malformed",
        prompt: "Run from directory",
        schedule: { kind: "cron", expression: "1,,2 * * * *" },
      }),
    })
    const impossible = await Server.Default().app.request("/global/cron", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        directory: tmp.path,
        name: "impossible",
        prompt: "Run from directory",
        schedule: { kind: "cron", expression: "0 0 31 2 *" },
      }),
    })

    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({
      name: "CronValidationError",
      data: { field: "schedule.expression" },
    })
    expect(impossible.status).toBe(400)
    expect(await impossible.json()).toMatchObject({
      name: "CronValidationError",
      data: { field: "schedule.expression" },
    })
  })

  test("computes sparse leap-day schedules beyond an 8-year window", () => {
    const next = new Date(CronExpression.next("0 0 29 2 1", new Date(2026, 0, 1).getTime()))

    expect(next.getFullYear()).toBe(2044)
    expect(next.getMonth()).toBe(1)
    expect(next.getDate()).toBe(29)
  })

  test("stop clears delayed startup tick before it can execute queued runs", async () => {
    await using tmp = await tmpdir({ git: true })

    const run = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cron = yield* Cron.Service
        const task = yield* cron.create({
          directory: tmp.path,
          name: "queued",
          prompt: "Run from directory",
          schedule: { kind: "cron", expression: "0 9 * * 1-5" },
          status: "paused",
        })
        return yield* cron.trigger(task.id)
      }),
    )

    await AppRuntime.runPromise(CronScheduler.Service.use((svc) => svc.start()))
    await AppRuntime.runPromise(CronScheduler.Service.use((svc) => svc.stop()))
    await new Promise((resolve) => setTimeout(resolve, 150))

    const after = await AppRuntime.runPromise(Cron.Service.use((svc) => svc.getRun(run.id)))
    expect(after.status).toBe("queued")
  })

  test("claiming due tasks disables corrupt stored schedules and continues", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cron = yield* Cron.Service
        const bad = yield* cron.create({
          directory: tmp.path,
          name: "bad",
          prompt: "bad",
          schedule: { kind: "cron", expression: "0 9 * * 1-5" },
        })
        const good = yield* cron.create({
          directory: tmp.path,
          name: "good",
          prompt: "good",
          schedule: { kind: "interval", intervalMs: 60_000 },
        })

        Database.use((db) => {
          db.update(CronTaskTable)
            .set({ schedule_value: "0 0 31 2 *", next_run_at: 0 })
            .where(eq(CronTaskTable.id, bad.id))
            .run()
          db.update(CronTaskTable)
            .set({ next_run_at: 0 })
            .where(eq(CronTaskTable.id, good.id))
            .run()
        })

        return {
          claimed: yield* cron.claimDueTasks(Date.now()),
          bad: yield* cron.get(bad.id),
        }
      }),
    )

    expect(result.claimed.map((item) => item.task.name)).toEqual(["good"])
    expect(result.bad.status).toBe("disabled")
    expect(result.bad.lastError).toContain("Could not find next time")
  })
})
