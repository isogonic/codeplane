import { describe, expect, test } from "bun:test"
import {
  getCronSessionStopAction,
  getCronSidebarStopAction,
  getCronTaskStopAction,
} from "./cron-stop-model"

describe("cron stop action models", () => {
  test("returns a cron task stop action only for cancellable runs", () => {
    let count = 0
    expect(
      getCronTaskStopAction({ status: "success", label: "Cancel run", onClick: () => count++ }),
    ).toBeUndefined()

    const action = getCronTaskStopAction({
      status: "running",
      label: "Cancel run",
      disabled: true,
      onClick: () => count++,
    })
    expect(action?.disabled).toBe(true)
    action?.onClick(new MouseEvent("click"))
    expect(count).toBe(1)
  })

  test("builds shared sidebar stop actions with the correct visibility classes", () => {
    let count = 0
    const desktop = getCronSidebarStopAction({
      status: "running",
      label: "Cancel run",
      onClick: () => count++,
    })
    expect(desktop?.class).toContain("pointer-events-none")
    expect(desktop?.class).toContain("group-hover/session:pointer-events-auto")

    const mobile = getCronSidebarStopAction({
      status: "queued",
      mobile: true,
      label: "Cancel run",
      onClick: () => count++,
    })
    expect(mobile?.class).toContain("pointer-events-auto")
    expect(mobile?.class).toContain("opacity-100")

    mobile?.onClick(new MouseEvent("click"))
    expect(count).toBe(1)
  })

  test("returns a cron session stop action only when the readonly dock should show it", () => {
    let count = 0
    expect(
      getCronSessionStopAction({ visible: false, label: "Cancel run", onClick: () => count++ }),
    ).toBeUndefined()

    const action = getCronSessionStopAction({
      visible: true,
      label: "Cancel run",
      stopping: true,
      onClick: () => count++,
    })
    expect(action?.stopping).toBe(true)
    action?.onClick(new MouseEvent("click"))
    expect(count).toBe(1)
  })
})
