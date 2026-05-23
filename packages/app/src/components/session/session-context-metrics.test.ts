import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@codeplane-ai/sdk/v2/client"
import { getSessionContextMetrics } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
  time?: { created: number; completed: number },
  extras: { summary?: boolean; agent?: string } = {},
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    agent: extras.agent ?? "general",
    summary: extras.summary,
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

const textPart = (id: string, messageID: string, start: number, end: number): Part =>
  ({
    id,
    sessionID: "s",
    messageID,
    type: "text",
    text: "x",
    time: { start, end },
  }) as unknown as Part

const reasoningPart = (id: string, messageID: string, start: number, end: number): Part =>
  ({
    id,
    sessionID: "s",
    messageID,
    type: "reasoning",
    text: "x",
    time: { start, end },
  }) as unknown as Part

const stepStartPart = (id: string, messageID: string, createdAt?: number): Part =>
  ({
    id,
    sessionID: "s",
    messageID,
    type: "step-start",
    ...(createdAt !== undefined ? { time: { created: createdAt } } : {}),
  }) as unknown as Part

const stepFinishPart = (
  id: string,
  messageID: string,
  tokens: { input?: number; output: number; reasoning: number; read?: number; write?: number },
  createdAt?: number,
): Part =>
  ({
    id,
    sessionID: "s",
    messageID,
    type: "step-finish",
    reason: "stop",
    cost: 0,
    tokens: {
      input: tokens.input ?? 0,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: { read: tokens.read ?? 0, write: tokens.write ?? 0 },
    },
    ...(createdAt !== undefined ? { time: { created: createdAt } } : {}),
  }) as unknown as Part

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
    // Median of [10, 100] = 55. Token-weighted recent over both turns =
    // 250/7000ms ~ 35.71.
    expect(metrics.speed.lifetime).toBe(55)
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
    // Median of [10,10,10,100,100,100,100,100] = 100 (5/8 of turns are fast).
    expect(metrics.speed.lifetime).toBe(100)
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

  test("filters isolated TPS spikes from peak and sparkline data", () => {
    const normal = Array.from({ length: 9 }, (_, index) =>
      assistant(
        `a${index + 1}`,
        { input: 0, output: 250, reasoning: 0, read: 0, write: 0 },
        0,
        "openai",
        "gpt-4.1",
        {
          created: index * 6_000,
          completed: index * 6_000 + 5_000,
        },
      ),
    )
    const spike = assistant("spike", { input: 0, output: 700, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 60_000,
      completed: 60_500,
    })

    const metrics = getSessionContextMetrics([...normal, spike], [{ id: "openai", models: {} }])

    expect(metrics.speed.turns.map((turn) => turn.id)).not.toContain("spike")
    expect(metrics.speed.turns).toHaveLength(9)
    expect(metrics.speed.peak).toBe(50)
    expect(metrics.speed.recent).toBe(50)
    expect(metrics.speed.current).toBe(50)
  })

  test("keeps consistently high TPS sessions", () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      assistant(
        `a${index + 1}`,
        { input: 0, output: 400, reasoning: 0, read: 0, write: 0 },
        0,
        "openai",
        "gpt-4.1",
        {
          created: index * 2_000,
          completed: index * 2_000 + 1_000,
        },
      ),
    )

    const metrics = getSessionContextMetrics(messages, [{ id: "openai", models: {} }])

    expect(metrics.speed.turns).toHaveLength(8)
    expect(metrics.speed.peak).toBe(400)
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

  test("multi-step turn: TPS uses summed step-finish tokens (not the overwritten msg.tokens)", () => {
    // The AI SDK reports per-step usage at finish-step. Upstream we do
    // `assistantMessage.tokens = usage.tokens` per step, so msg.tokens reflects
    // ONLY the last step. A precise TPS reading must sum the per-step tokens
    // from the step-finish parts.
    //
    // This turn: 600 output tokens generated across two steps separated by a
    // tool call. msg.tokens.output (= last step only) is 200, but the true
    // turn output is 400 + 200 = 600.
    const msg = assistant("a1", { input: 0, output: 200, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 50_000, // 50s wall (includes a long tool exec)
    })
    const parts: Part[] = [
      // Step 1 boundaries: 100ms..4_100ms (4s decode wall) — captures the
      // text streaming AND any tool-input args streamed inside the step.
      stepStartPart("p1", "a1", 100),
      textPart("p2", "a1", 100, 4_000),
      stepFinishPart("p3", "a1", { output: 400, reasoning: 0 }, 4_100),
      // Long tool call between step 1 and step 2 (40s) — must NOT inflate
      // the denominator. Step 2 boundaries: 45_000..46_000 (1s decode).
      stepStartPart("p4", "a1", 45_000),
      textPart("p5", "a1", 45_000, 46_000),
      stepFinishPart("p6", "a1", { output: 200, reasoning: 0 }, 46_000),
    ]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    const turn = metrics.speed.turns[0]!
    expect(turn.tokens).toBe(600)
    expect(turn.ms).toBe(5_000) // 4000 + 1000
    expect(turn.tps).toBe(120)
  })

  test("step-boundary timestamps cover tool-input streaming inside the step", () => {
    // In a real step the model often streams text, then tool input args, all
    // before finish-step. With only text-part timestamps the denominator
    // ends at text-end and misses the tool-input decode. The step boundary
    // pair (start-step → finish-step) covers BOTH, matching what the AI SDK
    // measures.
    const msg = assistant("a1", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 5_000,
    })
    const parts: Part[] = [
      stepStartPart("p1", "a1", 0),
      textPart("p2", "a1", 0, 1_000), // text streamed for 1s
      // Tool input streamed for another second between text-end and
      // step-finish (no part-level timestamp captures this). Step boundary
      // ends at 2000ms.
      stepFinishPart("p3", "a1", { output: 200, reasoning: 0 }, 2_000),
    ]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    // Boundary-based: 2s wall, 200 tokens → 100 tps. (Sum-of-text-parts would
    // have been 1s → falsely reported 200 tps.)
    expect(metrics.speed.turns[0]?.ms).toBe(2_000)
    expect(metrics.speed.turns[0]?.tps).toBe(100)
  })

  test("falls back to summed text/reasoning durations when boundary timestamps are absent", () => {
    // Older sessions (recorded before step-start.time / step-finish.time
    // existed) don't have boundary timestamps. Sum-of-parts must still work.
    const msg = assistant("a1", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 10_000,
    })
    const parts: Part[] = [
      stepStartPart("p1", "a1"), // no time field
      textPart("p2", "a1", 100, 2_100),
      stepFinishPart("p3", "a1", { output: 100, reasoning: 0 }), // no time field
    ]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.ms).toBe(2_000)
    expect(metrics.speed.turns[0]?.tps).toBe(50)
  })

  test("multi-step turn: reasoning tokens are summed across step-finish parts too", () => {
    const msg = assistant(
      "a1",
      // overwritten last-step tokens — should be ignored.
      { input: 0, output: 50, reasoning: 0, read: 0, write: 0 },
      0,
      "openai",
      "gpt-4.1",
      { created: 0, completed: 30_000 },
    )
    const parts: Part[] = [
      stepStartPart("p1", "a1", 100),
      reasoningPart("p2", "a1", 100, 2_100), // 2s reasoning
      textPart("p3", "a1", 2_100, 4_100), // 2s text
      // 200 reasoning + 200 text in 4s → 100 tps
      stepFinishPart("p4", "a1", { output: 200, reasoning: 200 }, 4_100),
      stepStartPart("p5", "a1", 25_000),
      textPart("p6", "a1", 25_000, 25_500), // 0.5s text
      // 50 text in 0.5s → 100 tps
      stepFinishPart("p7", "a1", { output: 50, reasoning: 0 }, 25_500),
    ]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    const turn = metrics.speed.turns[0]!
    expect(turn.tokens).toBe(450) // 200+200+50, not the overwritten 50
    expect(turn.ms).toBe(4_500) // 4000 + 500
    expect(turn.tps).toBe(100)
  })

  test("legacy turn without step-finish parts falls back to msg.tokens + part durations", () => {
    const msg = assistant("a1", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 10_000,
    })
    // No step-start/step-finish — older session shape. Just two text parts.
    const parts: Part[] = [textPart("p1", "a1", 0, 1_000), textPart("p2", "a1", 1_000, 2_000)]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.tokens).toBe(100)
    expect(metrics.speed.turns[0]?.ms).toBe(2_000)
    expect(metrics.speed.turns[0]?.tps).toBe(50)
  })

  test("turn with step-start/step-finish but no part timestamps falls back to whole-turn ms", () => {
    const msg = assistant("a1", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 5_000,
    })
    // Only step parts, no boundary times either, no text/reasoning parts.
    const parts: Part[] = [stepStartPart("p1", "a1"), stepFinishPart("p2", "a1", { output: 250, reasoning: 0 })]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    // No streaming durations available → use whole-turn (5s) so the turn isn't
    // dropped entirely. 250 tokens / 5s = 50 tps.
    expect(metrics.speed.turns[0]?.ms).toBe(5_000)
    expect(metrics.speed.turns[0]?.tokens).toBe(250)
    expect(metrics.speed.turns[0]?.tps).toBe(50)
  })

  test("text/reasoning parts outside any step still contribute (older event shapes)", () => {
    const msg = assistant("a1", { input: 0, output: 80, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 4_000,
    })
    // No step-start before the first text part — content is in an "implicit"
    // leading step. Still counts.
    const parts: Part[] = [textPart("p1", "a1", 0, 2_000), stepFinishPart("p2", "a1", { output: 80, reasoning: 0 })]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.tokens).toBe(80)
    expect(metrics.speed.turns[0]?.ms).toBe(2_000)
    expect(metrics.speed.turns[0]?.tps).toBe(40)
  })

  test("ignores text parts missing one of start/end", () => {
    const msg = assistant("a1", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
      created: 0,
      completed: 10_000,
    })
    const finished = textPart("p1", "a1", 100, 2_100) // 2s
    // Streaming part with only `start` — should NOT count toward duration.
    const inflight = {
      id: "p2",
      sessionID: "s",
      messageID: "a1",
      type: "text",
      text: "x",
      time: { start: 3_000 },
    } as unknown as Part
    // No boundary timestamps so we exercise the text-part-sum fallback.
    const parts: Part[] = [
      stepStartPart("p0", "a1"),
      finished,
      inflight,
      stepFinishPart("p3", "a1", { output: 100, reasoning: 0 }),
    ]

    const metrics = getSessionContextMetrics([msg], [{ id: "openai", models: {} }], { a1: parts })

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.ms).toBe(2_000)
    expect(metrics.speed.turns[0]?.tps).toBe(50)
  })

  test("synthetic summary turns are excluded from the speed series", () => {
    const realTurn = assistant(
      "a1",
      { input: 0, output: 100, reasoning: 0, read: 0, write: 0 },
      0,
      "openai",
      "gpt-4.1",
      { created: 0, completed: 5_000 },
    )
    // Compaction summary — runs a real model call but inflates the meter
    // with output the user didn't request.
    const summaryTurn = assistant(
      "a2",
      { input: 0, output: 1000, reasoning: 0, read: 0, write: 0 },
      0,
      "openai",
      "gpt-4.1",
      { created: 6_000, completed: 6_500 }, // 0.5s, 1000 tokens → 2000 tps
      { summary: true },
    )
    const compactorTurn = assistant(
      "a3",
      { input: 0, output: 500, reasoning: 0, read: 0, write: 0 },
      0,
      "openai",
      "gpt-4.1",
      { created: 7_000, completed: 7_500 },
      { agent: "compactor" },
    )

    const metrics = getSessionContextMetrics(
      [realTurn, summaryTurn, compactorTurn],
      [{ id: "openai", models: {} }],
    )

    expect(metrics.speed.turns).toHaveLength(1)
    expect(metrics.speed.turns[0]?.id).toBe("a1")
    expect(metrics.speed.peak).toBe(20)
  })

  test("median lifetime is robust to a single anomalously fast turn", () => {
    // Three normal-paced turns + one tiny burst (just above the
    // MIN_TURN_MS=250 floor) that completes faster than realistic. Mean
    // would lift lifetime way above what the user actually experiences;
    // median ignores the outlier.
    const realistic = (id: string, created: number) =>
      assistant(id, { input: 0, output: 200, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created,
        completed: created + 4_000,
      })
    const messages = [
      realistic("a1", 0),
      realistic("a2", 5_000),
      realistic("a3", 10_000),
      // 100 tokens in 250ms = 400 tps spike (pre-cached prompt fast path).
      assistant("a4", { input: 0, output: 100, reasoning: 0, read: 0, write: 0 }, 0, "openai", "gpt-4.1", {
        created: 15_000,
        completed: 15_250,
      }),
    ]

    const metrics = getSessionContextMetrics(messages, [{ id: "openai", models: {} }])

    expect(metrics.speed.turns).toHaveLength(4)
    // Three turns at 50 tps + one at 400 tps. Median = (50+50)/2 = 50.
    expect(metrics.speed.lifetime).toBe(50)
    expect(metrics.speed.peak).toBe(400)
  })
})
