// RFC 6238 TOTP (Time-based One-Time Password) — the second factor for the
// server's HTTP Basic Auth gate. Self-contained: no third-party dependency,
// just node:crypto. Compatible with Google Authenticator, 1Password, Authy,
// Aegis, etc. (SHA-1, 6 digits, 30 s period — the universal defaults).
//
// Threat model recap (see auth-policy.ts): a Codeplane server grants shell +
// filesystem + provider keys to any authenticated client. The password is the
// first factor; TOTP adds a second factor so a leaked password alone is not a
// full compromise. The TOTP secret lives only on the server (env/flag) and in
// the user's authenticator app — never transits the wire after enrolment.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export const TOTP_DIGITS = 6
export const TOTP_PERIOD_SECONDS = 30
// Accept the code from the adjacent windows too, so a small clock skew
// between the server and the user's phone (or a code entered right as it
// rolls over) still validates. ±1 window = ±30 s of tolerance.
export const TOTP_WINDOW = 1
const TOTP_ALGORITHM = "sha1"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

// Encode raw bytes as RFC 4648 base32 (no padding) — the format every
// authenticator app expects for the `secret=` field of an otpauth:// URI.
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

// Decode a base32 string back to bytes. Tolerant of lowercase, spaces, and
// `=` padding so a user can paste a secret however their app displays it.
// Returns undefined for anything that isn't valid base32.
export function base32Decode(input: string): Uint8Array | undefined {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "")
  if (clean.length === 0) return undefined
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) return undefined
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

// Generate a fresh random TOTP secret as a base32 string. 20 bytes (160 bits)
// is the RFC 6238 recommendation for SHA-1 and what most apps assume.
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

// Validate that a string is a usable base32 TOTP secret.
export function isValidSecret(secret: string): boolean {
  const decoded = base32Decode(secret)
  return !!decoded && decoded.length >= 10
}

function hotp(secretBytes: Uint8Array, counter: number): string {
  // 8-byte big-endian counter.
  const buf = Buffer.alloc(8)
  // Counter fits in 53-bit safe-integer range for any realistic time; split
  // into high/low 32-bit halves to avoid bit-shift overflow.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac(TOTP_ALGORITHM, Buffer.from(secretBytes)).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0")
}

// Compute the current TOTP code for a base32 secret. Mainly used in tests and
// by the CLI's optional self-check; the server only ever *verifies*.
export function generateCode(secret: string, atMs: number = Date.now()): string | undefined {
  const bytes = base32Decode(secret)
  if (!bytes) return undefined
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS)
  return hotp(bytes, counter)
}

// Constant-time string compare (length-independent via SHA-256 digest in the
// caller; here we compare equal-length 6-digit codes directly).
function safeEqualDigits(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const ba = Buffer.from(a, "utf8")
  const bb = Buffer.from(b, "utf8")
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// Verify a user-entered code against the secret, allowing ±TOTP_WINDOW steps
// of clock skew. Returns false for malformed input. Constant-time per window
// so a near-miss can't be distinguished from a far-miss by timing.
export function verifyCode(secret: string, code: string, atMs: number = Date.now()): boolean {
  const normalized = code.replace(/\s+/g, "")
  if (!/^[0-9]{6}$/.test(normalized)) return false
  const bytes = base32Decode(secret)
  if (!bytes) return false
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS)
  let matched = false
  for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
    // Don't early-return: keep the loop constant-shape so timing doesn't leak
    // which window matched.
    if (safeEqualDigits(hotp(bytes, counter + w), normalized)) matched = true
  }
  return matched
}

// Build an otpauth:// URI for enrolment in an authenticator app. `account` is
// the label shown in the app (typically the Basic Auth username), `issuer`
// groups it (defaults to "Codeplane").
export function otpauthURI(input: { secret: string; account: string; issuer?: string }): string {
  const issuer = input.issuer ?? "Codeplane"
  const label = `${issuer}:${input.account}`
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  })
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}
