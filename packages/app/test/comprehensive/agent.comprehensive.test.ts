import { describe, expect, test } from "bun:test"
import { agentColor, messageAgentColor } from "../../src/utils/agent"

describe("agentColor - default agents", () => {
  test("ask uses ask base", () => expect(agentColor("ask")).toBe("var(--icon-agent-ask-base)"))
  test("build uses build base", () =>
    expect(agentColor("build")).toBe("var(--icon-agent-build-base)"))
  test("docs uses docs base", () => expect(agentColor("docs")).toBe("var(--icon-agent-docs-base)"))
  test("plan uses plan base", () => expect(agentColor("plan")).toBe("var(--icon-agent-plan-base)"))
  test("uppercase ask works", () => expect(agentColor("ASK")).toBe("var(--icon-agent-ask-base)"))
  test("mixed case build works", () =>
    expect(agentColor("Build")).toBe("var(--icon-agent-build-base)"))
})

describe("agentColor - custom override", () => {
  test("custom takes precedence", () =>
    expect(agentColor("ask", "custom-color")).toBe("custom-color"))
  test("empty custom does not take precedence", () =>
    expect(agentColor("ask", "")).toBe("var(--icon-agent-ask-base)"))
  test("custom for unknown agent", () => expect(agentColor("xyz", "red")).toBe("red"))
})

describe("agentColor - hash for unknowns", () => {
  for (let i = 0; i < 100; i++) {
    test(`unknown agent ${i} returns from palette`, () => {
      const result = agentColor(`unknown-agent-${i}`)
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })
  }
  test("same name gives same color", () => {
    expect(agentColor("foo")).toBe(agentColor("foo"))
  })
  test("different names typically give different colors", () => {
    const a = agentColor("agent-a")
    const b = agentColor("agent-zzzz")
    expect(typeof a).toBe("string")
    expect(typeof b).toBe("string")
  })
})

describe("messageAgentColor", () => {
  test("undefined list returns undefined", () =>
    expect(messageAgentColor(undefined, [])).toBeUndefined())
  test("empty list returns undefined", () =>
    expect(messageAgentColor([], [])).toBeUndefined())
  test("returns last user agent color", () => {
    const list = [{ role: "user", agent: "ask" }, { role: "assistant" }]
    expect(messageAgentColor(list, [])).toBe("var(--icon-agent-ask-base)")
  })
  test("uses agent custom color from registry", () => {
    const list = [{ role: "user", agent: "ask" }]
    const agents = [{ name: "ask", color: "red" }]
    expect(messageAgentColor(list, agents)).toBe("red")
  })
  test("ignores assistant messages", () => {
    const list = [{ role: "user", agent: "ask" }, { role: "assistant", agent: "build" }]
    expect(messageAgentColor(list, [])).toBe("var(--icon-agent-ask-base)")
  })
  test("ignores user without agent", () => {
    const list = [{ role: "user", agent: "ask" }, { role: "user" }]
    expect(messageAgentColor(list, [])).toBe("var(--icon-agent-ask-base)")
  })
  test("returns last user with agent", () => {
    const list = [
      { role: "user", agent: "ask" },
      { role: "user", agent: "build" },
    ]
    expect(messageAgentColor(list, [])).toBe("var(--icon-agent-build-base)")
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk user agent #${i}`, () => {
      const list = [{ role: "user", agent: `agent-${i}` }]
      expect(messageAgentColor(list, [])).toBeDefined()
    })
  }
})
