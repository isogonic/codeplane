import { describe, expect, test } from "bun:test"
import { formatTaskHierarchy } from "../../../src/cli/cmd/tui/routes/session/task-hierarchy"

describe("formatTaskHierarchy", () => {
  test("shows the main agent, subagent, and empty toolcall branch", () => {
    expect(
      formatTaskHierarchy({
        description: "inspect auth",
        duration: 0,
        parentAgent: "build",
        status: "running",
        subagentType: "explore",
        toolCount: 0,
      }),
    ).toBe(["Main agent: Build", "└─ Subagent: Explore — inspect auth", "   └─ Toolcalls: 0"].join("\n"))
  })

  test("shows the active child toolcall while the subagent is running", () => {
    expect(
      formatTaskHierarchy({
        currentTool: {
          title: "run tests",
          tool: "bash",
        },
        description: "verify task",
        duration: 0,
        parentAgent: "build",
        status: "running",
        subagentType: "worker",
        toolCount: 2,
      }),
    ).toBe(
      [
        "Main agent: Build",
        "└─ Subagent: Worker — verify task",
        "   └─ Toolcalls: 2",
        "      └─ Active: Bash run tests",
      ].join("\n"),
    )
  })

  test("shows completion duration and last child toolcall", () => {
    expect(
      formatTaskHierarchy({
        currentTool: {
          title: "src/index.ts",
          tool: "read",
        },
        description: "inspect files",
        duration: 1500,
        parentAgent: "plan",
        status: "completed",
        subagentType: "explore",
        toolCount: 3,
      }),
    ).toBe(
      [
        "Main agent: Plan",
        "└─ Subagent: Explore — inspect files",
        "   └─ Toolcalls: 3 · 1.5s",
        "      └─ Last: Read src/index.ts",
      ].join("\n"),
    )
  })
})
