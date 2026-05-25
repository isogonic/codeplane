import { describe, expect, test } from "bun:test"
import {
  projectToolCommand,
  projectToolOperation,
  projectToolSubtitle,
  projectToolTitle,
} from "./message-part-project"

describe("project tool formatting", () => {
  test("uses metadata operation before input operation", () => {
    expect(projectToolOperation({ operation: "detect" }, { operation: "commands" })).toBe("commands")
    expect(projectToolTitle({ operation: "detect" }, {})).toBe("Project detect")
  })

  test("formats command configuration without raw empty args", () => {
    const input = {
      operation: "config_set",
      name: "typecheck",
      command: "bun turbo typecheck",
      label: "Typecheck",
      cwd: "",
    }

    expect(projectToolTitle(input, {})).toBe("Project command")
    expect(projectToolCommand(input, {})).toBe("bun turbo typecheck")
    expect(projectToolSubtitle(input, {})).toBe("typecheck · Typecheck · bun turbo typecheck")
  })

  test("summarizes command counts and blocked checks", () => {
    expect(projectToolSubtitle({ operation: "check" }, { count: 3, blocked: 1 })).toBe("3 commands, 1 blocked")
    expect(projectToolSubtitle({ operation: "detect" }, { count: 1 })).toBe("1 command")
  })
})
