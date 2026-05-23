import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import type { SessionID } from "../../src/session/schema"
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
  setArchived(input: { sessionID: SessionID; time: number }) {
    return run(SessionNs.Service.use((svc) => svc.setArchived(input)))
  },
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("session.list", () => {
  test("filters by directory", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const first = await svc.create({})

        await using other = await tmpdir({ git: true })
        const second = await Instance.provide({
          directory: other.path,
          fn: async () => svc.create({}),
        })

        const sessions = [...svc.list({ directory: tmp.path })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(first.id)
        expect(ids).not.toContain(second.id)
      },
    })
  })

  test("includes sessions created from subdirectories", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "app")
    await fs.mkdir(subdir, { recursive: true })

    const created = await Instance.provide({
      directory: subdir,
      fn: async () => svc.create({ title: "nested-session" }),
    })

    const sessions = await Instance.provide({
      directory: tmp.path,
      fn: async () => [...svc.list({ directory: tmp.path, roots: true })],
    })

    expect(sessions.map((s) => s.id)).toContain(created.id)
  })

  test("excludes parent directory sessions from nested directory lists", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "app")
    await fs.mkdir(subdir, { recursive: true })

    const parent = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "parent-session" }),
    })
    const child = await Instance.provide({
      directory: subdir,
      fn: async () => svc.create({ title: "child-session" }),
    })

    const sessions = await Instance.provide({
      directory: subdir,
      fn: async () => [...svc.list({ directory: subdir, roots: true })],
    })
    const ids = sessions.map((s) => s.id)

    expect(ids).toContain(child.id)
    expect(ids).not.toContain(parent.id)
  })

  test("excludes nested project sessions from ancestor directories", async () => {
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
      fn: async () => svc.create({ title: "nested-project-session" }),
    })

    const sessions = await Instance.provide({
      directory: parent.path,
      fn: async () => [...svc.list({ directory: parent.path, roots: true })],
    })

    expect(sessions.map((s) => s.id)).not.toContain(created.id)
  })

  test("filters root sessions", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await svc.create({ title: "root-session" })
        const child = await svc.create({ title: "child-session", parentID: root.id })

        const sessions = [...svc.list({ roots: true })]
        const ids = sessions.map((s) => s.id)

        expect(ids).toContain(root.id)
        expect(ids).not.toContain(child.id)
      },
    })
  })

  test("filters by start time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "new-session" })
        const futureStart = Date.now() + 86400000

        const sessions = [...svc.list({ start: futureStart })]
        expect(sessions.length).toBe(0)
      },
    })
  })

  test("filters by search term", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "unique-search-term-abc" })
        await svc.create({ title: "other-session-xyz" })

        const sessions = [...svc.list({ search: "unique-search" })]
        const titles = sessions.map((s) => s.title)

        expect(titles).toContain("unique-search-term-abc")
        expect(titles).not.toContain("other-session-xyz")
      },
    })
  })

  test("respects limit parameter", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await svc.create({ title: "session-1" })
        await svc.create({ title: "session-2" })
        await svc.create({ title: "session-3" })

        const sessions = [...svc.list({ limit: 2 })]
        expect(sessions.length).toBe(2)
      },
    })
  })

  test("route parses archived=false and roots=false as false", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "active-root" }),
    })
    const child = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "active-child", parentID: root.id }),
    })
    const archived = await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.create({ title: "archived-root" }),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => svc.setArchived({ sessionID: archived.id, time: Date.now() }),
    })

    const res = await Server.Default().app.request(
      `/session?directory=${encodeURIComponent(tmp.path)}&roots=false&archived=false&limit=20`,
    )
    expect(res.status).toBe(200)
    const sessions = (await res.json()) as SessionNs.Info[]
    const ids = sessions.map((session) => session.id)

    expect(ids).toContain(root.id)
    expect(ids).toContain(child.id)
    expect(ids).not.toContain(archived.id)
  })
})
