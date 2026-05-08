import type { NamedError } from "@codeplane-ai/shared/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { Flag } from "@/flag/flag"

export type Err = ReturnType<NamedError["toObject"]>

export const FREE_USAGE_EXCEEDED_MESSAGE = "Free usage exceeded"

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
// Hard upper bound for any single sleep-between-retries — even when the
// provider asks for more via `retry-after`. 5 minutes is plenty for any
// real overload condition; longer than that and the user should see the
// error rather than have the session hang.
export const RETRY_MAX_DELAY = 5 * 60_000

// Default ceilings for the outer retry policy. These cap how long a single
// LLM turn can spend retrying before the session reports a hard failure.
// `processor.ts` may pass overrides via SessionRetry.policy({ maxAttempts, maxTotalDelayMs }).
export const RETRY_DEFAULT_MAX_ATTEMPTS = 8
export const RETRY_DEFAULT_MAX_TOTAL_DELAY_MS = 10 * 60_000

// Jitter spreads retry attempts after a provider-wide outage so reconnecting
// clients don't all hit the recovering provider at the same instant. We take
// 50% of the computed delay and add a uniform random in [0, 50%).
function jitter(ms: number) {
  const half = ms / 2
  return Math.round(half + Math.random() * half)
}

function cap(ms: number) {
  return Math.min(Math.max(ms, 0), RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          // Provider-supplied delays are honored verbatim (no jitter) up to
          // RETRY_MAX_DELAY. Adding jitter on top of an explicit retry-after
          // would defeat the provider's pacing.
          return cap(parsedMs)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return cap(Math.ceil(parsedSeconds * 1000))
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return cap(Math.ceil(parsed))
        }
      }

      return cap(jitter(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)))
    }
  }

  return cap(
    jitter(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS)),
  )
}

export function retryable(error: Err) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // Free-tier quota exhaustion is a hard limit, not a transient failure.
    // The provider may surface it with isRetryable=true (or as a 5xx in some
    // gateway configs), but retrying just burns the user's session-attempt
    // budget against the same wall. Fail fast so the user can upgrade or
    // switch providers immediately.
    if (error.data.responseBody?.includes("FreeUsageLimitError")) return undefined
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
    return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
  }

  // Check for rate limit patterns in plain text error messages
  const msg = error.data?.message
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return msg
    }
  }

  const json = iife(() => {
    try {
      if (typeof error.data?.message === "string") {
        const parsed = JSON.parse(error.data.message)
        return parsed
      }

      return JSON.parse(error.data.message)
    } catch {
      return undefined
    }
  })
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return "Too Many Requests"
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return "Provider is overloaded"
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return "Rate Limited"
  }
  return undefined
}

export function policy(opts: {
  parse: (error: unknown) => Err
  set: (input: { attempt: number; message: string; next: number }) => Effect.Effect<void>
  /** Hard cap on the number of retry attempts. Default {@link RETRY_DEFAULT_MAX_ATTEMPTS}. */
  maxAttempts?: number
  /**
   * Hard cap on the total time spent sleeping between retries. Once exceeded
   * the policy stops retrying and the underlying error propagates to the
   * caller. Default {@link RETRY_DEFAULT_MAX_TOTAL_DELAY_MS}.
   */
  maxTotalDelayMs?: number
}) {
  // Operator override via env: CODEPLANE_RETRY_MAX_ATTEMPTS lets a deployment
  // tighten or loosen the cap without redeploying code. Explicit caller
  // overrides via opts still win — env is just the new default.
  const maxAttempts = opts.maxAttempts ?? Flag.CODEPLANE_RETRY_MAX_ATTEMPTS ?? RETRY_DEFAULT_MAX_ATTEMPTS
  const maxTotalDelayMs = opts.maxTotalDelayMs ?? RETRY_DEFAULT_MAX_TOTAL_DELAY_MS
  // Effect.sync forces a fresh closure (and thus a fresh budget) per schedule
  // activation, so reusing the same policy() return across multiple Effect.retry
  // sites still gives each retry sequence its own counter.
  return Schedule.fromStepWithMetadata(
    Effect.sync(() => {
      let totalDelayMs = 0
      return (meta: Schedule.InputMetadata<unknown>) => {
        const error = opts.parse(meta.input)
        const message = retryable(error)
        if (!message) return Cause.done(meta.attempt)
        // Stop retrying once we've exhausted either budget. Returning Cause.done
        // makes Effect.retry surface the original error, so the caller sees the
        // real reason rather than a synthetic "budget exceeded".
        // `meta.attempt` is 1-indexed (pre-incremented by Effect's metadata fn),
        // so `> maxAttempts` allows N retry attempts before stopping:
        //   maxAttempts=3 → meta.attempt sees 1, 2, 3, then stops at 4.
        if (meta.attempt > maxAttempts) return Cause.done(meta.attempt)
        if (totalDelayMs >= maxTotalDelayMs) return Cause.done(meta.attempt)
        return Effect.gen(function* () {
          const proposed = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
          const remaining = Math.max(0, maxTotalDelayMs - totalDelayMs)
          const wait = Math.min(proposed, remaining)
          totalDelayMs += wait
          const now = yield* Clock.currentTimeMillis
          yield* opts.set({ attempt: meta.attempt, message, next: now + wait })
          return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
        })
      }
    }),
  )
}

export * as SessionRetry from "./retry"
