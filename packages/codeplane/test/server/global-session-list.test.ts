import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project"
import { Session as SessionNs } from "../../src/session"
import { Log } from "../../src/util"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  ...SessionNs,
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((svc) => svc.create(input)))
  },
  setArchived(input: z.output<typeof SessionNs.SetArchivedInput.zod>) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
}

describe("session.listGlobal", () => {
  test("lists sessions across projects with project metadata", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => svc.create({ title: "first-session" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => svc.create({ title: "second-session" }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(firstSession.id)
    expect(ids).toContain(secondSession.id)

    const firstProject = Project.get(firstSession.projectID)
    const secondProject = Project.get(secondSession.projectID)

    const firstItem = sessions.find((session) => session.id === firstSession.id)
    const secondItem = sessions.find((session) => session.id === secondSession.id)

    expect(firstItem?.project?.id).toBe(firstProject?.id)
    expect(firstItem?.project?.worktree).toBe(firstProject?.worktree)
    expect(secondItem?.project?.id).toBe(secondProject?.id)
    expect(secondItem?.project?.worktree).toBe(secondProject?.worktree)
  })

  test("excludes archived sessions by default", async () => {
    await using tmp = await tmpdir({ git: true })

    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-session" }),
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const sessions = [...svc.listGlobal({ limit: 200 })]
    const ids = sessions.map((session) => session.id)

    expect(ids).not.toContain(archived.id)

    const allSessions = [...svc.listGlobal({ limit: 200, archived: true })]
    const allIds = allSessions.map((session) => session.id)

    expect(allIds).toContain(archived.id)
  })

  test("supports cursor pagination", async () => {
    await using tmp = await tmpdir({ git: true })

    const first = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-one" }),
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "page-two" }),
    })

    const page = [...svc.listGlobal({ directory: tmp.path, limit: 1 })]
    expect(page.length).toBe(1)
    expect(page[0].id).toBe(second.id)

    const next = [...svc.listGlobal({ directory: tmp.path, limit: 10, cursor: page[0].time.updated })]
    const ids = next.map((session) => session.id)

    expect(ids).toContain(first.id)
    expect(ids).not.toContain(second.id)
  })

  test("directory filter includes sessions created under the directory", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "app")
    await fs.mkdir(subdir, { recursive: true })

    const created = await Instance.provide({
      directory: subdir,
      fn: async () => svc.create({ title: "nested-global-session" }),
    })

    const sessions = [...svc.listGlobal({ directory: tmp.path, limit: 200 })]

    expect(sessions.map((session) => session.id)).toContain(created.id)
  })

  test("directory filter excludes sessions from nested projects", async () => {
    await using parent = await tmpdir()
    const nested = path.join(parent.path, "nested-project")
    await fs.mkdir(nested, { recursive: true })
    await $`git init`.cwd(nested).quiet()
    await $`git config core.fsmonitor false`.cwd(nested).quiet()
    await $`git config commit.gpgsign false`.cwd(nested).quiet()
    await $`git config user.email "test@codeplane.test"`.cwd(nested).quiet()
    await $`git config user.name "Test"`.cwd(nested).quiet()
    await $`git commit --allow-empty -m "root commit"`.cwd(nested).quiet()

    const created = await Instance.provide({
      directory: nested,
      fn: async () => svc.create({ title: "nested-global-session" }),
    })

    const sessions = [...svc.listGlobal({ directory: parent.path, limit: 200 })]

    expect(sessions.map((session) => session.id)).not.toContain(created.id)
  })
})
