import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import type { ProviderID } from "./schema"

// Adapted from overflow detection patterns in:
// https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/overflow.ts
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions + Responses API message text)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding, Moonshot
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /request entity too large/i, // HTTP 413
  /context length is only \d+ tokens/i, // vLLM
  /input length.*exceeds.*context length/i, // vLLM
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /too large for model with \d+ maximum context length/i, // Mistral
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
]

function isOpenAiErrorRetryable(e: APICallError) {
  const status = e.statusCode
  if (!status) return e.isRetryable
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || e.isRetryable
}

// The Codex backend (chatgpt.com/backend-api/codex) reports an exhausted ChatGPT-plan
// rolling allowance as a 429 with `error.type: "usage_limit_reached"` and a `resets_at`
// /`resets_in_seconds` that is typically HOURS away. The AI SDK's default `isRetryable`
// for 429 is true, so the session would burn its whole retry budget on quick retries
// against a wall that won't move for hours. Detect it, mark it non-retryable, and tell
// the user when it actually resets so they can switch models/providers or wait.
function usageLimitError(body: unknown): { resets_in_seconds?: unknown } | undefined {
  const err = (body as { error?: { type?: unknown; code?: unknown } } | undefined)?.error
  if (err && (err.type === "usage_limit_reached" || err.code === "usage_limit_reached")) {
    return err as { resets_in_seconds?: unknown }
  }
  return undefined
}

function usageLimitMessage(err: { resets_in_seconds?: unknown }): string {
  const secs = typeof err.resets_in_seconds === "number" ? err.resets_in_seconds : undefined
  const when = iife(() => {
    if (secs === undefined || secs <= 0) return ""
    if (secs < 90) return " It resets in about a minute."
    const h = Math.floor(secs / 3600)
    const m = Math.round((secs % 3600) / 60)
    if (h >= 1) return ` It resets in about ${h}h${m ? ` ${m}m` : ""}.`
    return ` It resets in about ${Math.max(1, m)} minute${m === 1 ? "" : "s"}.`
  })
  return `Codex usage limit reached for your ChatGPT plan.${when} Switch to another model or provider, or try again after it resets.`
}

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
function isOverflow(message: string) {
  if (OVERFLOW_PATTERNS.some((p) => p.test(message))) return true

  // Providers/status patterns handled outside of regex list:
  // - Cerebras: often returns "400 (no body)" / "413 (no body)"
  // - Mistral: often returns "400 (no body)" / "413 (no body)"
  return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)
}

function message(providerID: ProviderID, e: APICallError) {
  return iife(() => {
    const msg = e.message
    if (msg === "") {
      if (e.responseBody) return e.responseBody
      if (e.statusCode) {
        const err = STATUS_CODES[e.statusCode]
        if (err) return err
      }
      return "Unknown error"
    }

    if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
      return msg
    }

    try {
      const body = JSON.parse(e.responseBody)
      // try to extract common error message fields. `detail` is what the Codex
      // backend (chatgpt.com/backend-api/codex) returns, e.g. for an
      // unsupported model on a ChatGPT account.
      const errMsg = body.message || body.error || body.error?.message || body.detail
      if (errMsg && typeof errMsg === "string") {
        return `${msg}: ${errMsg}`
      }
    } catch {}

    // If responseBody is HTML (e.g. from a gateway or proxy error page),
    // provide a human-readable message instead of dumping raw markup
    if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
      if (e.statusCode === 401) {
        return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `codeplane auth login <your provider URL>` to re-authenticate."
      }
      if (e.statusCode === 403) {
        return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
      }
      return msg
    }

    return `${msg}: ${e.responseBody}`
  }).trim()
}

function json(input: unknown) {
  if (typeof input === "string") {
    try {
      const result = JSON.parse(input)
      if (result && typeof result === "object") return result
      return undefined
    } catch {
      return undefined
    }
  }
  if (typeof input === "object" && input !== null) {
    return input
  }
  return undefined
}

export type ParsedStreamError =
  | {
      type: "context_overflow"
      message: string
      responseBody: string
    }
  | {
      type: "api_error"
      message: string
      isRetryable: boolean
      responseBody: string
    }

export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const raw = json(input)
  const body = typeof raw?.message === "string" ? (json(raw.message) ?? raw) : raw
  if (!body) return

  const responseBody = JSON.stringify(body)
  if (body.type !== "error") return

  // The Codex backend keys some errors by `type` rather than the OpenAI-standard
  // `code` (e.g. `usage_limit_reached`), so match on either.
  switch (body?.error?.code ?? body?.error?.type) {
    case "context_length_exceeded":
      return {
        type: "context_overflow",
        message: "Input exceeds context window of this model",
        responseBody,
      }
    case "insufficient_quota":
      return {
        type: "api_error",
        message: "Quota exceeded. Check your plan and billing details.",
        isRetryable: false,
        responseBody,
      }
    case "usage_limit_reached":
      return {
        type: "api_error",
        message: usageLimitMessage(body.error),
        isRetryable: false,
        responseBody,
      }
    case "usage_not_included":
      return {
        type: "api_error",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
        isRetryable: false,
        responseBody,
      }
    case "invalid_prompt":
      return {
        type: "api_error",
        message: typeof body?.error?.message === "string" ? body?.error?.message : "Invalid prompt.",
        isRetryable: false,
        responseBody,
      }
    case "server_error":
      return {
        type: "api_error",
        message: typeof body?.error?.message === "string" ? body?.error?.message : "Server error.",
        isRetryable: true,
        responseBody,
      }
  }
}

export type ParsedAPICallError =
  | {
      type: "context_overflow"
      message: string
      responseBody?: string
    }
  | {
      type: "api_error"
      message: string
      statusCode?: number
      isRetryable: boolean
      responseHeaders?: Record<string, string>
      responseBody?: string
      metadata?: Record<string, string>
    }

export function parseAPICallError(input: { providerID: ProviderID; error: APICallError }): ParsedAPICallError {
  const m = message(input.providerID, input.error)
  const body = json(input.error.responseBody)
  if (isOverflow(m) || input.error.statusCode === 413 || body?.error?.code === "context_length_exceeded") {
    return {
      type: "context_overflow",
      message: m,
      responseBody: input.error.responseBody,
    }
  }

  const metadata = input.error.url ? { url: input.error.url } : undefined

  // GitHub Copilot reports hard quota/usage-limit exhaustion (the premium-request
  // allowance is spent; it resets at the billing period, often days out) as a 429
  // carrying this header plus a multi-day `retry-after`. Unlike a transient rate
  // limit it won't clear by waiting, so the AI SDK's default `isRetryable: true`
  // for 429 makes the session sleep out its whole retry budget against a wall that
  // won't move. Mark it non-retryable and surface an actionable message instead.
  // Transient Copilot rate limits don't set this header, so they stay retryable.
  if (input.error.responseHeaders?.["x-ratelimit-exceeded"] === "quota_exceeded") {
    return {
      type: "api_error",
      message:
        "GitHub Copilot quota exceeded: your premium request allowance is used up (it resets at your billing period). Switch to an included model or upgrade your Copilot plan.",
      statusCode: input.error.statusCode,
      isRetryable: false,
      responseHeaders: input.error.responseHeaders,
      responseBody: input.error.responseBody,
      metadata,
    }
  }

  // Codex ChatGPT-plan allowance exhausted — a 429 whose `error.type` is
  // `usage_limit_reached` and that resets hours away. Don't burn the retry budget.
  const usageLimit = usageLimitError(body)
  if (usageLimit) {
    return {
      type: "api_error",
      message: usageLimitMessage(usageLimit),
      statusCode: input.error.statusCode,
      isRetryable: false,
      responseHeaders: input.error.responseHeaders,
      responseBody: input.error.responseBody,
      metadata,
    }
  }

  return {
    type: "api_error",
    message: m,
    statusCode: input.error.statusCode,
    isRetryable: input.providerID.startsWith("openai") ? isOpenAiErrorRetryable(input.error) : input.error.isRetryable,
    responseHeaders: input.error.responseHeaders,
    responseBody: input.error.responseBody,
    metadata,
  }
}
