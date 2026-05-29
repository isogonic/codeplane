import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { parseAPICallError, parseStreamError } from "../../src/provider/error"

describe("parseAPICallError", () => {
  test("surfaces the Codex backend `detail` field instead of dumping raw JSON", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://chatgpt.com/backend-api/codex/responses",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        detail: "The 'gpt-5.1-codex' model is not supported when using Codex with a ChatGPT account.",
      }),
      isRetryable: false,
    })

    const parsed = parseAPICallError({ providerID: "openai" as never, error })

    expect(parsed.type).toBe("api_error")
    expect(parsed.message).toContain("not supported when using Codex with a ChatGPT account")
    // the raw JSON envelope should not leak into the message
    expect(parsed.message).not.toContain('{"detail"')
  })

  test("marks GitHub Copilot quota-exhaustion 429 non-retryable with an actionable message", () => {
    const error = new APICallError({
      message: "quota exceeded",
      url: "https://api.githubcopilot.com/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      // multi-day retry-after + this header is how Copilot signals a hard limit
      responseHeaders: { "x-ratelimit-exceeded": "quota_exceeded", "retry-after": "262030" },
      responseBody: "quota exceeded",
      isRetryable: true,
    })

    const parsed = parseAPICallError({ providerID: "github-copilot" as never, error })

    expect(parsed.type).toBe("api_error")
    if (parsed.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(false)
    expect(parsed.message).toContain("quota exceeded")
  })

  test("keeps a transient 429 (no quota header) retryable", () => {
    const error = new APICallError({
      message: "rate limit",
      url: "https://api.githubcopilot.com/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "retry-after": "5" },
      responseBody: "rate limit",
      isRetryable: true,
    })

    const parsed = parseAPICallError({ providerID: "github-copilot" as never, error })

    expect(parsed.type).toBe("api_error")
    if (parsed.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(true)
  })

  test("marks a Codex `usage_limit_reached` 429 non-retryable with the reset time", () => {
    // exact shape the chatgpt.com/backend-api/codex backend returns when the
    // ChatGPT-plan rolling allowance is spent (resets ~33h out).
    const error = new APICallError({
      message: "The usage limit has been reached",
      url: "https://api.openai.com/v1/responses",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({
        error: {
          type: "usage_limit_reached",
          message: "The usage limit has been reached",
          plan_type: "prolite",
          resets_at: 1780175813,
          resets_in_seconds: 119008,
        },
      }),
      isRetryable: true,
    })

    const parsed = parseAPICallError({ providerID: "openai" as never, error })

    expect(parsed.type).toBe("api_error")
    if (parsed.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(false)
    expect(parsed.message).toContain("Codex usage limit reached")
    expect(parsed.message).toContain("33h")
  })

  test("usage_limit_reached without a reset hint stays non-retryable, no reset clause", () => {
    const error = new APICallError({
      message: "The usage limit has been reached",
      url: "https://api.openai.com/v1/responses",
      requestBodyValues: {},
      statusCode: 429,
      responseBody: JSON.stringify({ error: { type: "usage_limit_reached" } }),
      isRetryable: true,
    })

    const parsed = parseAPICallError({ providerID: "openai" as never, error })

    if (parsed.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(false)
    expect(parsed.message).toContain("Codex usage limit reached")
    expect(parsed.message).not.toContain("resets in")
  })
})

describe("parseStreamError", () => {
  test("classifies a `usage_limit_reached` stream error (keyed by type) non-retryable", () => {
    const parsed = parseStreamError({
      type: "error",
      error: { type: "usage_limit_reached", message: "The usage limit has been reached", resets_in_seconds: 300 },
    })

    expect(parsed?.type).toBe("api_error")
    if (parsed?.type !== "api_error") throw new Error("expected api_error")
    expect(parsed.isRetryable).toBe(false)
    expect(parsed.message).toContain("5 minute")
  })
})
