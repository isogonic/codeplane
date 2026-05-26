import { afterEach, describe, expect, test } from "bun:test"
import { PromptQueue } from "../../src/session/prompt-queue"
import { SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import type { Job } from "../../src/session/prompt-queue"
import type { PromptJobID } from "../../src/session/prompt-queue-schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const session = (suffix: string) => SessionID.make(`ses_test_${suffix}_${Math.random().toString(36).slice(2)}`)

afterEach(async () => {
  await resetDatabase()
})

describe("PromptQueue", () => {
  test("enqueue, claim, recordResult round-trip", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("rt")
        const job = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) =>
            svc.enqueue({
              sessionID,
              directory: tmp.path,
              payload: JSON.stringify({ parts: [{ type: "text", text: "hi" }] }),
            }),
          ),
        )
        expect(job.status).toBe("pending")
        expect(job.attempt).toBe(0)
        expect(job.sessionID).toBe(sessionID)

        const claimed = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        expect(claimed).toHaveLength(1)
        expect(claimed[0].id).toBe(job.id)
        expect(claimed[0].status).toBe("running")
        expect(claimed[0].attempt).toBe(1)

        await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.recordResult({ jobID: job.id, status: "completed" })),
        )
        const final = await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.get(job.id)))
        expect(final.status).toBe("completed")
        expect(final.timeCompleted).toBeGreaterThan(0)
      },
    })
  })

  test("per-session FIFO: only one running job per session at a time", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("fifo")
        // Enqueue three jobs for the same session.
        for (let i = 0; i < 3; i++) {
          await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) =>
              svc.enqueue({
                sessionID,
                directory: tmp.path,
                payload: JSON.stringify({ tag: i }),
              }),
            ),
          )
        }

        const claimed1 = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        // Only one of the three may be claimed because the others share the
        // same session and we forbid concurrent running rows per session.
        expect(claimed1).toHaveLength(1)

        // While that one is still "running", a second tick should claim
        // nothing for the same session.
        const claimed2 = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        expect(claimed2).toHaveLength(0)

        // Complete the first; now the next pending row becomes claimable.
        await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.recordResult({ jobID: claimed1[0].id, status: "completed" })),
        )
        const claimed3 = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        expect(claimed3).toHaveLength(1)
        // FIFO order: claimed3 should be the second-enqueued row, which has
        // a strictly greater id than claimed1.
        expect(claimed3[0].id > claimed1[0].id).toBe(true)
      },
    })
  })

  test("recover marks running rows for requeue or fail", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("rec")
        const job = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) =>
            svc.enqueue({
              sessionID,
              directory: tmp.path,
              payload: "{}",
              maxAttempts: 2,
            }),
          ),
        )
        // Simulate a crash: claim, but never record a terminal result.
        const claimed = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        expect(claimed[0].status).toBe("running")

        const recovered = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.recover()),
        )
        expect(recovered).toHaveLength(1)
        // attempt=1 (from the claim) and maxAttempts=2 — so requeue.
        expect(recovered[0].status).toBe("pending")

        const after = await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.get(job.id)))
        expect(after.status).toBe("pending")
        expect(after.errorMessage).toMatch(/Server restarted/i)
      },
    })
  })

  test("recover marks rows as failed once attempts are exhausted", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("rec-fail")
        const job = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) =>
            svc.enqueue({
              sessionID,
              directory: tmp.path,
              payload: "{}",
              maxAttempts: 1,
            }),
          ),
        )
        // Burn the only allowed attempt.
        await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)))
        const recovered = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.recover()),
        )
        expect(recovered[0].status).toBe("failed")
        const after = await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.get(job.id)))
        expect(after.status).toBe("failed")
        expect(after.timeCompleted).toBeGreaterThan(0)
      },
    })
  })

  test("publishes Created on enqueue, Updated on claim and recordResult", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("events")
        type Created = { sessionID: string; job: Job }
        type Updated = { sessionID: string; job: Job }
        const created: Created[] = []
        const updated: Updated[] = []
        // Use the top-level subscribe helper (synchronous, returns an unsub
        // closure). The Bus is keyed by Instance directory, so this
        // subscription receives publishes issued by PromptQueue inside the
        // same Instance.provide scope.
        const unsubCreated = Bus.subscribe(PromptQueue.Event.Created, (ev) => created.push(ev.properties as Created))
        const unsubUpdated = Bus.subscribe(PromptQueue.Event.Updated, (ev) => updated.push(ev.properties as Updated))
        // Give the subscriber fibers a tick to actually start consuming.
        await Bun.sleep(10)
        try {
          const job = await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) =>
              svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" }),
            ),
          )
          await Bun.sleep(20)
          expect(created).toHaveLength(1)
          expect(created[0].job.id).toBe(job.id)
          expect(created[0].sessionID).toBe(sessionID)

          await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)))
          await Bun.sleep(20)
          expect(updated.some((u) => u.job.id === job.id && u.job.status === "running")).toBe(true)

          await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) => svc.recordResult({ jobID: job.id, status: "completed" })),
          )
          await Bun.sleep(20)
          expect(updated.some((u) => u.job.id === job.id && u.job.status === "completed")).toBe(true)
        } finally {
          unsubCreated()
          unsubUpdated()
        }
      },
    })
  })

  test("publishes Updated for every cancelled row on cancelSession", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("cancel-events")
        const ids = new Set<PromptJobID>()
        for (let i = 0; i < 3; i++) {
          const job = await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) =>
              svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" }),
            ),
          )
          ids.add(job.id)
        }

        const cancelled: { jobID: PromptJobID }[] = []
        const unsub = Bus.subscribe(PromptQueue.Event.Updated, (ev) => {
          const props = ev.properties as { sessionID: string; job: Job }
          if (props.job.status === "cancelled") cancelled.push({ jobID: props.job.id })
        })
        await Bun.sleep(10)
        try {
          await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) => svc.cancelSession(sessionID)),
          )
          await Bun.sleep(20)
          const cancelledIDs = new Set(cancelled.map((c) => c.jobID))
          // Exactly the enqueued ids should be reported, no duplicates.
          expect(cancelledIDs).toEqual(ids)
        } finally {
          unsub()
        }
      },
    })
  })

  test("reorder rewrites sort_order; claim respects it (explicit-first, NULLS last)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("reorder")
        // Three pending jobs in insertion (FIFO) order: A, B, C.
        const a = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        const b = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        const c = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )

        // Reorder to C, A, B.
        const reordered = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.reorder({ sessionID, jobIDs: [c.id, a.id, b.id] })),
        )
        expect(reordered.map((j) => j.id)).toEqual([c.id, a.id, b.id])
        expect(reordered.map((j) => j.sortOrder)).toEqual([0, 1, 2])

        // claim picks them up in the new order.
        const first = await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.claim(Date.now(), 1)))
        expect(first[0]?.id).toBe(c.id)
        await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.recordResult({ jobID: first[0]!.id, status: "completed" })),
        )
        const second = await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.claim(Date.now(), 1)))
        expect(second[0]?.id).toBe(a.id)
      },
    })
  })

  test("reorder rejects non-pending jobs and unknown ids", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("reorder-reject")
        const a = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        const b = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        // Claim moves A to "running" — it's no longer reorderable.
        await AppRuntime.runPromise(PromptQueue.Service.use((svc) => svc.claim(Date.now(), 1)))

        await expect(
          AppRuntime.runPromise(
            PromptQueue.Service.use((svc) => svc.reorder({ sessionID, jobIDs: [a.id, b.id] })),
          ),
        ).rejects.toThrow(/PromptQueueConflict|not pending|state changed/)

        // Unknown id → NotFoundError.
        await expect(
          AppRuntime.runPromise(
            PromptQueue.Service.use((svc) =>
              svc.reorder({
                sessionID,
                jobIDs: ["pjob_does_not_exist" as unknown as typeof a.id],
              }),
            ),
          ),
        ).rejects.toThrow(/NotFoundError|not found/i)
      },
    })
  })

  test("newly-enqueued jobs sort after reordered ones", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("reorder-after")
        const a = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        const b = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )
        await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.reorder({ sessionID, jobIDs: [b.id, a.id] })),
        )
        // C enqueued after reorder; sort_order remains NULL so it falls
        // *after* the reordered pair regardless of insertion order.
        const c = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" })),
        )

        const order: string[] = []
        for (let i = 0; i < 3; i++) {
          const claimed = await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) => svc.claim(Date.now(), 1)),
          )
          if (claimed.length === 0) break
          order.push(claimed[0].id)
          await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) => svc.recordResult({ jobID: claimed[0].id, status: "completed" })),
          )
        }
        expect(order).toEqual([b.id, a.id, c.id])
      },
    })
  })

  test("cancelSession marks pending and running jobs cancelled", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = session("cancel")
        for (let i = 0; i < 2; i++) {
          await AppRuntime.runPromise(
            PromptQueue.Service.use((svc) =>
              svc.enqueue({ sessionID, directory: tmp.path, payload: "{}" }),
            ),
          )
        }
        const claimed = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.claim(Date.now(), 10)),
        )
        expect(claimed).toHaveLength(1)
        expect(claimed[0].status).toBe("running")

        const cancelled = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.cancelSession(sessionID)),
        )
        expect(cancelled).toBe(2)

        const list = await AppRuntime.runPromise(
          PromptQueue.Service.use((svc) => svc.list({ sessionID })),
        )
        expect(list.every((j) => j.status === "cancelled")).toBe(true)
      },
    })
  })
})
