import { describe, expect, test } from "bun:test"
import type { Message } from "@codeplane-ai/sdk/v2/client"
import { getSessionContextMetrics } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
  time?: { created: number; completed: number },
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: time ?? { created: 1 },
  } as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContextMetrics", () => {
  test("computes totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.totalCost).toBe(1.75)
    expect(metrics.context?.message.id).toBe("a2")
    expect(metrics.context?.total).toBe(500)
    expect(metrics.context?.usage).toBe(50)
    expect(metrics.context?.providerLabel).toBe("OpenAI")
    expect(metrics.context?.modelLabel).toBe("GPT-4.1")
    expect(metrics.speed.lifetime).toBeNull()
    expect(metrics.speed.recent).toBeNull()
    expect(metrics.speed.peak).toBeNull()
    expect(metrics.speed.turns).toEqual([])
  })

  test("computes per-turn speed series and lifetime/recent/peak", () => {
    const messages = [
      assistant("a1", { input: 0, output: 40, reasoning: 10, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created: 0,
        completed: 5000,
      }),
      assistant("a2", { input: 0, output: 200, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created: 6000,
        completed: 8000,
      }),
      assistant("a3", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0),
    ]

    const metrics = getSessionContextMetrics(messages, [{ id: "openai", models: {} }])

    expect(metrics.speed.turns).toHaveLength(2)
    expect(metrics.speed.turns[0]?.tps).toBe(10)
    expect(metrics.speed.turns[1]?.tps).toBe(100)
    expect(metrics.speed.lifetime).toBeCloseTo(35.71, 1)
    expect(metrics.speed.recent).toBeCloseTo(35.71, 1)
    expect(metrics.speed.peak).toBe(100)
    expect(metrics.speed.current).toBe(100)
  })

  test("recent window only covers the last few turns", () => {
    const slow = (id: string, created: number) =>
      assistant(id, { input: 0, output: 50, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created,
        completed: created + 5000,
      })
    const fast = (id: string, created: number) =>
      assistant(id, { input: 0, output: 500, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created,
        completed: created + 5000,
      })
    const messages = [
      slow("a1", 0),
      slow("a2", 6000),
      slow("a3", 12000),
      fast("a4", 18000),
      fast("a5", 24000),
      fast("a6", 30000),
      fast("a7", 36000),
      fast("a8", 42000),
    ]

    const metrics = getSessionContextMetrics(messages, [{ id: "openai", models: {} }])

    expect(metrics.speed.turns).toHaveLength(8)
    expect(metrics.speed.recent).toBe(100)
    expect(metrics.speed.peak).toBe(100)
    expect(metrics.speed.lifetime).toBeLessThan(100)
    expect(metrics.speed.lifetime).toBeGreaterThan(10)
  })

  test("filters out tiny turns that would create misleading peaks", () => {
    const messages = [
      assistant("a1", { input: 0, output: 1, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created: 0,
        completed: 50,
      }),
      assistant("a2", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created: 1000,
        completed: 6000,
      }),
    ]

    const metrics = getSessionContextMetrics(messages, [{ id: "openai", models: {} }])

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.id).toBe("a2")
    expect(metrics.speed.peak).toBe(20)
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.providerLabel).toBe("p-1")
    expect(metrics.context?.modelLabel).toBe("m-1")
    expect(metrics.context?.limit).toBeUndefined()
    expect(metrics.context?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContextMetrics(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContextMetrics(messages, providers)

    expect(one.context?.message.id).toBe("a1")
    expect(two.context?.message.id).toBe("a2")
    expect(two.totalCost).toBe(1)
  })

  test("returns empty metrics when inputs are undefined", () => {
    const metrics = getSessionContextMetrics(undefined, undefined)

    expect(metrics.totalCost).toBe(0)
    expect(metrics.speed.lifetime).toBeNull()
    expect(metrics.speed.recent).toBeNull()
    expect(metrics.speed.peak).toBeNull()
    expect(metrics.speed.turns).toEqual([])
    expect(metrics.context).toBeUndefined()
  })
})
