import { describe, expect, test } from "bun:test"
import { classifyPromptJobTerminal } from "../../src/session/prompt-queue-worker"

const assistantResult = (errorName?: string, message?: string) =>
  ({
    info: {
      role: "assistant",
      error: errorName
        ? {
            name: errorName,
            data: message ? { message } : undefined,
          }
        : undefined,
    },
    parts: [],
  }) as any

describe("PromptQueueWorker terminal classification", () => {
  test("requeues interrupted assistant results that were not explicitly cancelled", () => {
    expect(
      classifyPromptJobTerminal({
        rowStatus: "running",
        result: assistantResult("MessageAbortedError", "runner interrupted"),
        abortSignalAborted: false,
        abortDisposition: "cancel",
      }),
    ).toBe("requeue")
  })

  test("keeps explicit session cancellation terminal even when the runner returns an aborted assistant", () => {
    expect(
      classifyPromptJobTerminal({
        rowStatus: "cancelled",
        result: assistantResult("MessageAbortedError", "cancelled"),
        abortSignalAborted: false,
        abortDisposition: "cancel",
      }),
    ).toBe("cancelled")
  })

  test("requeues worker-stop aborts instead of turning them into cancellations", () => {
    expect(
      classifyPromptJobTerminal({
        rowStatus: "running",
        result: assistantResult("MessageAbortedError", "server stopping"),
        abortSignalAborted: true,
        abortDisposition: "requeue",
      }),
    ).toBe("requeue")
  })

  test("completes ordinary successful assistant results", () => {
    expect(
      classifyPromptJobTerminal({
        rowStatus: "running",
        result: assistantResult(),
        abortSignalAborted: false,
        abortDisposition: "cancel",
      }),
    ).toBe("completed")
  })
})
