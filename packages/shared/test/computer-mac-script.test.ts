import { describe, expect, test } from "bun:test"
import { buildMacComputerScript } from "../src/computer-mac-script"

describe("buildMacComputerScript", () => {
  test("uses JXA delay instead of the missing usleep bridge", () => {
    const script = buildMacComputerScript(60_000)
    expect(script).toContain("pause(0.06)")
    expect(script).toContain("pauseMs(")
    expect(script).not.toContain("$.usleep")
  })

  test("uses System Events for layout-safe text and shortcut input", () => {
    const script = buildMacComputerScript(60_000)
    expect(script).toContain("Application('System Events')")
    expect(script).toContain("system.keystroke(text)")
    expect(script).toContain("system.keyCode(")
    expect(script).not.toContain("CGEventKeyboardSetUnicodeString")
    expect(script).not.toContain("a: 0")
  })
})
