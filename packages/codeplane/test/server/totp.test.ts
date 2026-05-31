import { describe, expect, test } from "bun:test"
import {
  base32Decode,
  base32Encode,
  generateCode,
  generateSecret,
  isValidSecret,
  otpauthURI,
  verifyCode,
  TOTP_PERIOD_SECONDS,
} from "../../src/server/totp"
import { issueToken, verifyToken, OTP_SESSION_TTL_MS } from "../../src/server/totp-session"

describe("base32", () => {
  test("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128, 64, 32, 16, 8])
    const encoded = base32Encode(bytes)
    expect(base32Decode(encoded)).toEqual(bytes)
  })

  test("decodes tolerant of case/spaces/padding", () => {
    const secret = generateSecret()
    const lower = secret.toLowerCase()
    const spaced = secret.replace(/(.{4})/g, "$1 ").trim()
    expect(base32Decode(lower)).toEqual(base32Decode(secret)!)
    expect(base32Decode(spaced)).toEqual(base32Decode(secret)!)
  })

  test("rejects invalid characters", () => {
    expect(base32Decode("1890!!!")).toBeUndefined()
    expect(base32Decode("")).toBeUndefined()
  })
})

describe("TOTP (RFC 6238)", () => {
  // Canonical RFC 6238 SHA-1 test vectors use the ASCII seed
  // "12345678901234567890". We verify a couple of the published codes.
  const seed = base32Encode(new TextEncoder().encode("12345678901234567890"))

  test("matches published RFC 6238 vectors", () => {
    expect(generateCode(seed, 59 * 1000)).toBe("287082")
    expect(generateCode(seed, 1111111109 * 1000)).toBe("081804")
    expect(generateCode(seed, 1234567890 * 1000)).toBe("005924")
  })

  test("generate → verify round-trips", () => {
    const secret = generateSecret()
    const code = generateCode(secret)!
    expect(verifyCode(secret, code)).toBe(true)
  })

  test("rejects a wrong code", () => {
    const secret = generateSecret()
    const code = generateCode(secret)!
    const wrong = code === "000000" ? "111111" : "000000"
    expect(verifyCode(secret, wrong)).toBe(false)
  })

  test("accepts the previous window (clock skew tolerance)", () => {
    const secret = generateSecret()
    const now = Date.now()
    const prev = generateCode(secret, now - TOTP_PERIOD_SECONDS * 1000)!
    expect(verifyCode(secret, prev, now)).toBe(true)
  })

  test("rejects a code two windows away", () => {
    const secret = generateSecret()
    const now = Date.now()
    const far = generateCode(secret, now - TOTP_PERIOD_SECONDS * 1000 * 3)!
    // Only ±1 window is tolerated, so 3 windows ago must fail (unless it
    // coincidentally collides, which is a 1e-6 chance — retry-proof here
    // because we compare against the exact far code, not a random one).
    const current = generateCode(secret, now)!
    if (far !== current) expect(verifyCode(secret, far, now)).toBe(false)
  })

  test("ignores whitespace in entered code", () => {
    const secret = generateSecret()
    const code = generateCode(secret)!
    expect(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true)
  })

  test("rejects malformed input", () => {
    const secret = generateSecret()
    expect(verifyCode(secret, "12345")).toBe(false)
    expect(verifyCode(secret, "1234567")).toBe(false)
    expect(verifyCode(secret, "abcdef")).toBe(false)
    expect(verifyCode(secret, "")).toBe(false)
  })

  test("isValidSecret", () => {
    expect(isValidSecret(generateSecret())).toBe(true)
    expect(isValidSecret("not base32 ###")).toBe(false)
    expect(isValidSecret("AAAA")).toBe(false) // too short
  })

  test("otpauthURI is well-formed", () => {
    const secret = generateSecret()
    const uri = otpauthURI({ secret, account: "admin", issuer: "My Server" })
    expect(uri.startsWith("otpauth://totp/")).toBe(true)
    const parsed = new URL(uri)
    expect(parsed.searchParams.get("secret")).toBe(secret)
    expect(parsed.searchParams.get("issuer")).toBe("My Server")
    expect(parsed.searchParams.get("digits")).toBe("6")
    expect(parsed.searchParams.get("period")).toBe("30")
  })
})

describe("OTP session token", () => {
  const password = "a-strong-password-1234"
  const secret = generateSecret()

  test("issued token verifies", () => {
    const token = issueToken({ password, secret })
    expect(verifyToken({ token, password, secret })).toBe(true)
  })

  test("rejects token under a different password", () => {
    const token = issueToken({ password, secret })
    expect(verifyToken({ token, password: "different-password-1234", secret })).toBe(false)
  })

  test("rejects token under a different secret", () => {
    const token = issueToken({ password, secret })
    expect(verifyToken({ token, password, secret: generateSecret() })).toBe(false)
  })

  test("rejects an expired token", () => {
    const now = Date.now()
    const token = issueToken({ password, secret, now })
    expect(verifyToken({ token, password, secret, now: now + OTP_SESSION_TTL_MS + 1 })).toBe(false)
  })

  test("rejects tampered tokens", () => {
    const token = issueToken({ password, secret })
    expect(verifyToken({ token: token + "x", password, secret })).toBe(false)
    expect(verifyToken({ token: "garbage", password, secret })).toBe(false)
    expect(verifyToken({ token: undefined, password, secret })).toBe(false)
  })
})
