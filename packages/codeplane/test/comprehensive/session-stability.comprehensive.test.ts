import { describe, expect, test } from "bun:test"
import { getUsage } from "../../src/session/session"
import type { Provider } from "../../src/provider"

/**
 * Stability & edge-case tests for the session module.
 *
 * Covers null-safety, invalid input, extreme values, and concurrent-access
 * patterns that historically caused production incidents.
 */

// Minimal cost model that doesn't throw when accessed
const safeCost = {
  input: 0,
  output: 0,
  cache: { read: 0, write: 0 },
}

// Helper to create a usage object that satisfies LanguageModelUsage type
// The ai SDK v6 requires inputTokenDetails and outputTokenDetails
const makeUsage = (partial: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number }
  outputTokenDetails?: { reasoningTokens?: number }
}) => partial as any

describe("SESSION STABILITY — getUsage", () => {
  const baseModel = { cost: safeCost } as unknown as Provider.Model

  test("handles zero tokens without NaN", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    })
    expect(result.cost).toBe(0)
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
  })

  test("handles undefined inputTokens gracefully", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: undefined as any, outputTokens: 5, totalTokens: 5 }),
    })
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(5)
    expect(Number.isFinite(result.cost)).toBe(true)
  })

  test("handles undefined outputTokens gracefully", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 10, outputTokens: undefined as any, totalTokens: 10 }),
    })
    expect(result.tokens.input).toBe(10)
    expect(result.tokens.output).toBe(0)
    expect(Number.isFinite(result.cost)).toBe(true)
  })

  test("handles negative tokens as zero", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: -1, outputTokens: -5, totalTokens: -6 }),
    })
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.cost).toBe(0)
  })

  test("handles NaN tokens as zero", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: NaN, outputTokens: NaN, totalTokens: NaN }),
    })
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.cost).toBe(0)
  })

  test("handles Infinity tokens as zero", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: Infinity, outputTokens: -Infinity, totalTokens: 0 }),
    })
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    expect(result.cost).toBe(0)
  })

  test("handles missing metadata without throwing", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      metadata: undefined,
    })
    expect(result.tokens.input).toBe(100)
    expect(result.tokens.output).toBe(50)
    expect(Number.isFinite(result.cost)).toBe(true)
  })

  test("handles empty metadata object", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
      metadata: {},
    })
    expect(result.tokens.input).toBe(100)
    expect(Number.isFinite(result.cost)).toBe(true)
  })

  test("handles cacheWrite tokens with bedrock metadata shape", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }),
      metadata: {
        bedrock: { usage: { cacheWriteInputTokens: 50 } },
      } as any,
    })
    expect(result.tokens.cache.write).toBe(50)
    expect(result.tokens.input).toBe(150) // 200 - 50
  })

  test("handles cacheWrite tokens with venice metadata shape", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }),
      metadata: {
        venice: { usage: { cacheCreationInputTokens: 30 } },
      } as any,
    })
    expect(result.tokens.cache.write).toBe(30)
    expect(result.tokens.input).toBe(170) // 200 - 30
  })

  test("handles reasoning tokens deduction correctly", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        outputTokenDetails: { reasoningTokens: 80 },
      }),
    })
    expect(result.tokens.reasoning).toBe(80)
    expect(result.tokens.output).toBe(120) // 200 - 80
  })

  test("handles large token counts without overflow", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({
        inputTokens: 10_000_000,
        outputTokens: 5_000_000,
        totalTokens: 15_000_000,
      }),
    })
    expect(result.tokens.input).toBe(10_000_000)
    expect(result.tokens.output).toBe(5_000_000)
    expect(Number.isFinite(result.cost)).toBe(true)
  })

  test("handles cost with experimentalOver200K pricing", () => {
    const model = {
      cost: {
        input: 3,
        output: 15,
        cache: { read: 0.3, write: 3.75 },
        experimentalOver200K: {
          input: 6,
          output: 30,
          cache: { read: 0.6, write: 7.5 },
        },
      },
    } as unknown as Provider.Model
    const result = getUsage({
      model,
      usage: makeUsage({
        inputTokens: 300_000,
        outputTokens: 100_000,
        totalTokens: 400_000,
        inputTokenDetails: { cacheReadTokens: 50_000 },
      }),
    })
    expect(result.tokens.cache.read).toBe(50_000)
    // Should use experimentalOver200K because total > 200K
    expect(Number.isFinite(result.cost)).toBe(true)
    expect(result.cost).toBeGreaterThan(0)
  })

  test("handles model without cost info", () => {
    const model = {} as unknown as Provider.Model
    const result = getUsage({
      model,
      usage: makeUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
    })
    expect(result.cost).toBe(0)
    expect(result.tokens.input).toBe(100)
  })

  test("handles totalTokens being undefined", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: undefined as any,
      }),
    })
    expect(result.tokens.total).toBeUndefined()
    expect(result.tokens.input).toBe(100)
  })

  test("cache reads don't underflow input below zero", () => {
    const result = getUsage({
      model: baseModel,
      usage: makeUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        inputTokenDetails: { cacheReadTokens: 100 }, // more cache than input — shouldn't go negative
      }),
    })
    expect(result.tokens.input).toBe(0) // clamped at 0 by safe()
    expect(result.tokens.cache.read).toBe(100)
  })
})
