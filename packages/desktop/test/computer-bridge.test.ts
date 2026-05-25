import { describe, expect, test } from "bun:test"
import {
  desktopComputerNeedsAccessibility,
  performDesktopComputer,
  type DesktopComputerCapture,
} from "../src/main/computer-bridge"

describe("desktop computer bridge", () => {
  test("does not require Accessibility for screenshot-only or wait-only actions", () => {
    expect(desktopComputerNeedsAccessibility({ action: "screenshot" })).toBe(false)
    expect(desktopComputerNeedsAccessibility({ action: "wait", durationMs: 1 })).toBe(false)
    expect(
      desktopComputerNeedsAccessibility({
        action: "batch",
        actions: [{ action: "wait", durationMs: 1 }, { action: "screenshot" }],
      }),
    ).toBe(false)
  })

  test("requires Accessibility for native input actions inside batches", () => {
    expect(
      desktopComputerNeedsAccessibility({
        action: "batch",
        actions: [{ action: "screenshot" }, { action: "move", coordinate: [10, 20] }],
      }),
    ).toBe(true)
  })

  test("uses the Electron-owned capture override", async () => {
    let captured = false
    const captureScreen: DesktopComputerCapture = async () => {
      captured = true
      return {
        dataUrl: "data:image/png;base64,AAAA",
        width: 4,
        height: 3,
      }
    }

    const result = await performDesktopComputer({ action: "screenshot" }, { captureScreen })

    expect(captured).toBe(true)
    expect(result.screenshot.width).toBe(4)
    expect(result.screenshot.height).toBe(3)
    expect(result.actions.map((action) => action.action)).toEqual(["screenshot"])
  })

  test("runs safe batches through the Electron bridge and captures once at the end", async () => {
    let captures = 0
    const captureScreen: DesktopComputerCapture = async () => {
      captures++
      return {
        dataUrl: "data:image/png;base64,BBBB",
        width: 8,
        height: 6,
      }
    }

    const result = await performDesktopComputer(
      {
        action: "batch",
        actions: [{ action: "wait", durationMs: 1 }, { action: "screenshot" }],
      },
      { captureScreen },
    )

    expect(captures).toBe(1)
    expect(result.actions.map((action) => action.action)).toEqual(["wait", "screenshot"])
    expect(result.screenshot.dataUrl).toBe("data:image/png;base64,BBBB")
  })
})
