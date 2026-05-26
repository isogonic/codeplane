import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session as SessionNs } from "../../src/session"
import { PromptQueue } from "../../src/session/prompt-queue"
import type { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function run<A, E>(fx: Effect.Effect<A, E, SessionNs.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SessionNs.defaultLayer)))
}

const svc = {
  create(input?: SessionNs.CreateInput) {
    return run(SessionNs.Service.use((s) => s.create(input)))
  },
  remove(id: SessionID) {
    return run(SessionNs.Service.use((s) => s.remove(id)))
  },
}

function enqueue(sessionID: string, directory: string, label: string) {
  return Effect.runPromise(
    PromptQueue.Service.use((s) =>
      s.enqueue({
        sessionID: sessionID as SessionID,
        directory,
        payload: JSON.stringify({ parts: [{ type: "text", text: label }] }),
      }),
    ).pipe(Effect.provide(PromptQueue.defaultLayer)),
  )
}

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

describe("session queue routes", () => {
  test("GET /:sessionID/queue returns empty when nothing is enqueued", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/queue`)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
        await svc.remove(session.id)
      },
    })
  })

  test("GET /:sessionID/queue surfaces enqueued jobs in run order", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const a = await enqueue(session.id, tmp.path, "first")
        const b = await enqueue(session.id, tmp.path, "second")

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/queue`)
        expect(res.status).toBe(200)
        const list = (await res.json()) as Array<{ id: string; payload: string }>
        expect(list.map((j) => j.id)).toEqual([a.id, b.id])
        expect(list[0]?.payload).toContain("first")
        expect(list[1]?.payload).toContain("second")
        await svc.remove(session.id)
      },
    })
  })

  test("GET /:sessionID/queue?all=1 includes terminal rows; default hides them", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const job = await enqueue(session.id, tmp.path, "done")
        await Effect.runPromise(
          PromptQueue.Service.use((s) =>
            s.recordResult({ jobID: job.id, status: "completed" }),
          ).pipe(Effect.provide(PromptQueue.defaultLayer)),
        )

        const app = Server.Default().app

        const defaultRes = await app.request(`/session/${session.id}/queue`)
        expect(((await defaultRes.json()) as unknown[]).length).toBe(0)

        const allRes = await app.request(`/session/${session.id}/queue?all=1`)
        const allList = (await allRes.json()) as Array<{ id: string; status: string }>
        expect(allList.length).toBe(1)
        expect(allList[0]?.status).toBe("completed")
        await svc.remove(session.id)
      },
    })
  })

  test("DELETE /:sessionID/queue/:jobID cancels a pending job idempotently", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const job = await enqueue(session.id, tmp.path, "victim")

        const app = Server.Default().app

        const res = await app.request(`/session/${session.id}/queue/${job.id}`, { method: "DELETE" })
        expect(res.status).toBe(204)

        // Idempotent — deleting again is still 204.
        const res2 = await app.request(`/session/${session.id}/queue/${job.id}`, { method: "DELETE" })
        expect(res2.status).toBe(204)

        // Job now reads as cancelled.
        const final = await Effect.runPromise(
          PromptQueue.Service.use((s) => s.get(job.id)).pipe(Effect.provide(PromptQueue.defaultLayer)),
        )
        expect(final.status).toBe("cancelled")
        await svc.remove(session.id)
      },
    })
  })

  test("POST /:sessionID/queue/reorder rewrites sort_order and returns the new order", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const a = await enqueue(session.id, tmp.path, "a")
        const b = await enqueue(session.id, tmp.path, "b")
        const c = await enqueue(session.id, tmp.path, "c")

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/queue/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobIDs: [c.id, a.id, b.id] }),
        })
        expect(res.status).toBe(200)
        const reordered = (await res.json()) as Array<{ id: string; sortOrder?: number }>
        expect(reordered.map((j) => j.id)).toEqual([c.id, a.id, b.id])
        expect(reordered.map((j) => j.sortOrder)).toEqual([0, 1, 2])

        // Subsequent list call reflects the new order.
        const listRes = await app.request(`/session/${session.id}/queue`)
        const list = (await listRes.json()) as Array<{ id: string }>
        expect(list.map((j) => j.id)).toEqual([c.id, a.id, b.id])
        await svc.remove(session.id)
      },
    })
  })

  test("POST /:sessionID/queue/reorder returns 409 when an id is not pending", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        const a = await enqueue(session.id, tmp.path, "a")
        const b = await enqueue(session.id, tmp.path, "b")

        // Burn a to "running" so the next reorder hits the precondition check.
        await Effect.runPromise(
          PromptQueue.Service.use((s) => s.claim(Date.now(), 1)).pipe(Effect.provide(PromptQueue.defaultLayer)),
        )

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/queue/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobIDs: [a.id, b.id] }),
        })
        expect(res.status).toBe(409)
        const body = (await res.json()) as { name?: string; data?: { jobID?: string } }
        expect(body.name).toBe("PromptQueueConflict")
        // Either a or whichever row ended up running may be reported,
        // depending on which one was claimed; we just assert it's named.
        expect(body.data?.jobID).toBeTruthy()
        await svc.remove(session.id)
      },
    })
  })

  test("POST /:sessionID/queue/reorder returns 404 for an unknown id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await svc.create({})
        await enqueue(session.id, tmp.path, "a")

        const app = Server.Default().app
        const res = await app.request(`/session/${session.id}/queue/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobIDs: ["pjob_does_not_exist"] }),
        })
        expect(res.status).toBe(404)
        await svc.remove(session.id)
      },
    })
  })
})
