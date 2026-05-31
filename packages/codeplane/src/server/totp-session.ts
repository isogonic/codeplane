// Stateless second-factor session tokens.
//
// Once a client proves the second factor (a valid TOTP code on top of correct
// Basic Auth), the server hands back a short-lived token. The client presents
// it on subsequent requests via the `x-codeplane-otp` header (or the
// `otp_token` WebSocket query param) so the user enters their code once, not
// on every request.
//
// The token is HMAC-signed and self-describing — no server-side session
// store. The signing key is derived from the password + TOTP secret, so:
//   * rotating either invalidates all outstanding tokens, and
//   * a token minted by one server config can't be replayed against another.
// Tokens carry an absolute expiry and are rejected past it.

import { createHmac, timingSafeEqual } from "node:crypto"

// How long a verified second-factor session lasts before the user must enter
// a fresh code. 12 hours balances "don't nag on every reconnect" against
// "a stolen token has a bounded lifetime".
export const OTP_SESSION_TTL_MS = 12 * 60 * 60 * 1000

function signingKey(password: string, secret: string): Buffer {
  // Domain-separated so this key can never collide with any other HMAC use.
  return createHmac("sha256", `codeplane.otp.session\u0000${secret}`).update(password).digest()
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url")
}

// Mint a token valid until now + ttl. Format: `v1.<expiryMs>.<signature>`.
export function issueToken(input: {
  password: string
  secret: string
  now?: number
  ttlMs?: number
}): string {
  const now = input.now ?? Date.now()
  const expiry = now + (input.ttlMs ?? OTP_SESSION_TTL_MS)
  const payload = `v1.${expiry}`
  const sig = sign(payload, signingKey(input.password, input.secret))
  return `${payload}.${sig}`
}

// Verify a token: correct signature for the current password+secret AND not
// expired. Constant-time signature compare; malformed tokens return false.
export function verifyToken(input: {
  token: string | undefined
  password: string
  secret: string
  now?: number
}): boolean {
  if (!input.token) return false
  const parts = input.token.split(".")
  if (parts.length !== 3) return false
  const [version, expiryRaw, providedSig] = parts
  if (version !== "v1") return false
  const expiry = Number(expiryRaw)
  if (!Number.isFinite(expiry)) return false
  if ((input.now ?? Date.now()) >= expiry) return false
  const expectedSig = sign(`${version}.${expiryRaw}`, signingKey(input.password, input.secret))
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  return a.length === b.length && timingSafeEqual(a, b)
}
