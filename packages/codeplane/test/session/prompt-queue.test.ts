import { afterEach, describe, expect, test } from "bun:test"
import { PromptQueue } from "../../src/session/prompt-queue"
import { SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
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
