import { describe, expect, test } from "bun:test"
import { shouldEmitCleanupTaskEvent } from "./live-activity-task-emitter"

describe("shouldEmitCleanupTaskEvent", () => {
  test("does not complete still-enabled queued or running tasks on watcher cleanup", () => {
    expect(shouldEmitCleanupTaskEvent({ stillEnabled: true, phase: "queued" })).toBe(false)
    expect(shouldEmitCleanupTaskEvent({ stillEnabled: true, phase: "running" })).toBe(false)
  })

  test("emits a terminal frame for completed or failed tasks", () => {
    expect(shouldEmitCleanupTaskEvent({ stillEnabled: true, phase: "completed" })).toBe(true)
    expect(shouldEmitCleanupTaskEvent({ stillEnabled: true, phase: "failed" })).toBe(true)
  })

  test("emits cleanup when the user opted out", () => {
    expect(shouldEmitCleanupTaskEvent({ stillEnabled: false, phase: "running" })).toBe(true)
  })
})
