import { describe, expect, test } from "bun:test"
import type { Agent } from "@codeplane-ai/sdk/v2/client"
import { cronAgentOptions } from "./cron-agents"

const agent = (input: Pick<Agent, "name" | "mode"> & Partial<Agent>): Agent => ({
  permission: [],
  options: {},
  ...input,
})

describe("cron agent options", () => {
  test("includes project agents returned by the app agents endpoint", () => {
    expect(
      cronAgentOptions({
        defaultLabel: "Default",
        agents: [
          agent({ name: "build", mode: "primary" }),
          agent({ name: "goal", mode: "primary" }),
          agent({ name: "review", mode: "subagent" }),
          agent({ name: "summary", mode: "primary", hidden: true }),
        ],
        config: {},
      }).map((item) => item.name),
    ).toEqual(["", "build", "goal"])
  })

  test("merges enabled config-only agent modes", () => {
    expect(
      cronAgentOptions({
        defaultLabel: "Default",
        agents: [agent({ name: "build", mode: "primary" })],
        config: {
          mode: {
            plan: { mode: "primary" },
          },
          agent: {
            custom: { mode: "all" },
            hidden: { hidden: true },
            disabled: { disable: true },
            worker: { mode: "subagent" },
          },
        },
      }).map((item) => item.name),
    ).toEqual(["", "build", "custom", "plan"])
  })

  test("lets agent config override deprecated mode config", () => {
    expect(
      cronAgentOptions({
        defaultLabel: "Default",
        agents: [agent({ name: "build", mode: "primary" })],
        config: {
          mode: {
            build: { mode: "primary" },
            custom: { mode: "primary" },
            restored: { disable: true },
          },
          agent: {
            build: { disable: true },
            custom: { mode: "subagent" },
            restored: { mode: "primary" },
          },
        },
      }).map((item) => item.name),
    ).toEqual(["", "restored"])
  })
})
