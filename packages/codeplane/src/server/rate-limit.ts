// In-memory failed-auth tracker. Brakes brute-force attacks against Basic
// Auth by locking out clients that hammer the auth endpoint with wrong
// credentials.
//
// Codeplane is a single-user instance that grants the authenticated client
// the same powers as the user running the server: shell execution, file
// access, every configured model provider, every MCP server. A leaked or
// guessable password is a full compromise. SHA-256 + timing-safe compare
// (handled by hono's basicAuth) makes a single guess constant-time, but
// nothing stops an attacker from making a million guesses — that's what
// this module guards against.
//
// Track failures in a sliding window keyed by the client identifier (see
// `clientKeyForRequest` in middleware.ts). Once a client crosses the soft
// limit, each additional failure doubles a lockout window — the gate
// returns 429 with a Retry-After until the window expires. A successful
// authentication clears the counter for that client.
//
// In-memory state is fine because:
//   1. The same hardening goal applies per-process; an attacker forking
//      across multiple processes is already past Basic Auth's threat model
//      (we're not protecting against state-level adversaries).
//   2. Server restarts are rare in practice, and a restart isn't worse
//      than reaching the lockout window's natural expiry.
//   3. The map is capped (`MAX_TRACKED_CLIENTS`) and evicts oldest entries
//      so a flood of distinct attacker IPs can't OOM us.

const WINDOW_MS = 15 * 60_000
// SOFT_LIMIT raised from 5 → 20 in v29.0.33. The middleware now gates
// recordFailure on "credentials were actually presented", so legitimate
// browser-boot bursts (no Authorization header) don't count anymore.
// What remains in the counter is real wrong-password attempts. Even so,
// 5 was too tight — a user fat-fingering through a 2FA-style password
// manager could trip the lockout. 20 still bounds an attacker to
// 80 guesses/window against the SHA-256 + timing-safe compare path.
const SOFT_LIMIT = 20
const HARD_LIMIT = 100
const HARD_BLOCK_MS = WINDOW_MS
const BASE_LOCKOUT_MS = 5_000
const MAX_LOCKOUT_MS = WINDOW_MS
const MAX_TRACKED_CLIENTS = 10_000

export type Entry = {
  failures: number
  firstFailureAt: number
  blockedUntil: number
}

const entries = new Map<string, Entry>()

function isStale(entry: Entry, now: number) {
  return entry.blockedUntil <= now && now - entry.firstFailureAt > WINDOW_MS
}

function evictOldest() {
  if (entries.size <= MAX_TRACKED_CLIENTS) return
  // O(n) scan is fine — only runs when the map exceeds the cap, which is
  // an abnormal condition anyway. Keeps the code simple and dependency
  // free.
  let oldestKey: string | undefined
  let oldestAt = Infinity
  for (const [key, value] of entries) {
    if (value.firstFailureAt < oldestAt) {
      oldestAt = value.firstFailureAt
      oldestKey = key
    }
  }
  if (oldestKey) entries.delete(oldestKey)
}

export function check(key: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  const entry = entries.get(key)
  if (!entry) return { allowed: true, retryAfterMs: 0 }
  if (isStale(entry, now)) {
    entries.delete(key)
    return { allowed: true, retryAfterMs: 0 }
  }
  if (entry.blockedUntil > now) {
    return { allowed: false, retryAfterMs: entry.blockedUntil - now }
  }
  return { allowed: true, retryAfterMs: 0 }
}

export function recordFailure(key: string, now = Date.now()): Entry {
  let entry = entries.get(key)
  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    entry = { failures: 0, firstFailureAt: now, blockedUntil: 0 }
    entries.set(key, entry)
  }
  entry.failures += 1
  if (entry.failures >= HARD_LIMIT) {
    // Long, full-window block once we're sure this is a brute-force run.
    entry.blockedUntil = entry.firstFailureAt + HARD_BLOCK_MS
  } else if (entry.failures > SOFT_LIMIT) {
    // 6th fail → 5s; 7th → 10s; 8th → 20s; ... capped at WINDOW_MS.
    const overshoot = entry.failures - SOFT_LIMIT
    const lockoutMs = Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** (overshoot - 1))
    entry.blockedUntil = now + lockoutMs
  }
  evictOldest()
  return entry
}

export function recordSuccess(key: string): void {
  entries.delete(key)
}

// Test helpers — not used by production code paths.
export function reset(): void {
  entries.clear()
}

export function size(): number {
  return entries.size
}

export const config = {
  WINDOW_MS,
  SOFT_LIMIT,
  HARD_LIMIT,
  HARD_BLOCK_MS,
  BASE_LOCKOUT_MS,
  MAX_LOCKOUT_MS,
  MAX_TRACKED_CLIENTS,
} as const
