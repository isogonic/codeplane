import { describe, expect, test } from "bun:test"
import {
  canCancelCronRunStatus,
  canShowCronSessionStop,
  cronSidebarStopButtonClass,
} from "./cron-stop"

describe("cron stop helpers", () => {
  test("allows cancelling only queued or running runs", () => {
    expect(canCancelCronRunStatus("queued")).toBe(true)
    expect(canCancelCronRunStatus("running")).toBe(true)
    expect(canCancelCronRunStatus("success")).toBe(false)
    expect(canCancelCronRunStatus("failed")).toBe(false)
    expect(canCancelCronRunStatus("timeout")).toBe(false)
    expect(canCancelCronRunStatus("cancelled")).toBe(false)
    expect(canCancelCronRunStatus(undefined)).toBe(false)
  })

  test("keeps the shared sidebar stop button visible on mobile", () => {
    expect(cronSidebarStopButtonClass(true)).toContain("pointer-events-auto")
    expect(cronSidebarStopButtonClass(true)).toContain("opacity-100")
    expect(cronSidebarStopButtonClass(false)).toContain("group-hover/session:opacity-100")
    expect(cronSidebarStopButtonClass(false)).toContain("opacity-0")
    expect(cronSidebarStopButtonClass(false)).toContain("pointer-events-none")
    expect(cronSidebarStopButtonClass(false)).toContain("group-hover/session:pointer-events-auto")
  })

  test("shows cron session stop only when a busy cron run is present", () => {
    expect(canShowCronSessionStop({ sessionID: "session-1", runID: "run-1", busy: true })).toBe(true)
    expect(canShowCronSessionStop({ sessionID: "session-1", runID: "run-1", busy: false })).toBe(false)
    expect(canShowCronSessionStop({ sessionID: "session-1", runID: undefined, busy: true })).toBe(false)
    expect(canShowCronSessionStop({ sessionID: undefined, runID: "run-1", busy: true })).toBe(false)
  })
})
