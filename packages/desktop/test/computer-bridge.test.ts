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
    let requestedDisplayId: string | undefined
    const captureScreen: DesktopComputerCapture = async (request) => {
      captured = true
      requestedDisplayId = request.displayId
      return {
        displays: [
          {
            id: "display-1",
            label: "Built-in Display",
            bounds: { x: 0, y: 0, width: 1440, height: 900 },
            workArea: { x: 0, y: 25, width: 1440, height: 875 },
            scaleFactor: 2,
            rotation: 0,
            primary: true,
            internal: true,
          },
          {
            id: "display-2",
            label: "Studio Display",
            bounds: { x: 1440, y: 0, width: 2560, height: 1440 },
            workArea: { x: 1440, y: 0, width: 2560, height: 1415 },
            scaleFactor: 1,
            rotation: 0,
            primary: false,
            internal: false,
            current: true,
          },
        ],
        screenshot: {
          dataUrl: "data:image/png;base64,AAAA",
          width: 4,
          height: 3,
          displayId: "display-2",
          scope: "display",
        },
      }
    }

    const result = await performDesktopComputer({ action: "screenshot", displayId: "display-2" }, { captureScreen })

    expect(captured).toBe(true)
    expect(requestedDisplayId).toBe("display-2")
    expect(result.screenshot.width).toBe(4)
    expect(result.screenshot.height).toBe(3)
    expect(result.screenshot.displayId).toBe("display-2")
    expect(result.screenshot.scope).toBe("display")
    expect(result.displays.map((display) => display.id)).toEqual(["display-1", "display-2"])
    expect(result.displays[1]?.current).toBe(true)
    expect(result.actions.map((action) => action.action)).toEqual(["screenshot"])
  })

  test("runs safe batches through the Electron bridge and captures once at the end", async () => {
    let captures = 0
    const captureScreen: DesktopComputerCapture = async () => {
      captures++
      return {
        displays: [],
        screenshot: {
          dataUrl: "data:image/png;base64,BBBB",
          width: 8,
          height: 6,
          scope: "virtual-desktop",
        },
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
    expect(result.screenshot.scope).toBe("virtual-desktop")
  })
})
