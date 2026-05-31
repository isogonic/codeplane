import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { Flag } from "../../src/flag/flag"
import * as AuthRateLimit from "../../src/server/rate-limit"
import { generateCode, base32Encode } from "../../src/server/totp"
import { Log } from "../../src/util"

void Log.init({ print: false })

// Exercises the real POST /global/auth/verify route end-to-end through the
// fully-assembled server app (AuthMiddleware + GlobalRoutes), then uses the
// returned token to pass the gate on a protected route.
const PASSWORD = "verify-route-strong-1234"
const SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"))

const original = {
  password: Flag.CODEPLANE_SERVER_PASSWORD,
  username: Flag.CODEPLANE_SERVER_USERNAME,
  totp: Flag.CODEPLANE_SERVER_TOTP_SECRET,
  latency: process.env["CODEPLANE_SERVER_MIN_AUTH_LATENCY_MS"],
}

function basic() {
  return `Basic ${Buffer.from(`codeplane:${PASSWORD}`).toString("base64")}`
}

beforeEach(() => {
  process.env["CODEPLANE_SERVER_MIN_AUTH_LATENCY_MS"] = "0"
  Flag.CODEPLANE_SERVER_PASSWORD = PASSWORD
  Flag.CODEPLANE_SERVER_TOTP_SECRET = SECRET
  AuthRateLimit.reset()
})

afterEach(() => {
  Flag.CODEPLANE_SERVER_PASSWORD = original.password
  Flag.CODEPLANE_SERVER_USERNAME = original.username
  Flag.CODEPLANE_SERVER_TOTP_SECRET = original.totp
  if (original.latency === undefined) delete process.env["CODEPLANE_SERVER_MIN_AUTH_LATENCY_MS"]
  else process.env["CODEPLANE_SERVER_MIN_AUTH_LATENCY_MS"] = original.latency
  AuthRateLimit.reset()
})

const app = () => Server.Default().app

describe("POST /global/auth/verify", () => {
  test("full flow: password → verify code → token grants access", async () => {
    // Password alone is blocked with a totp-required 401.
    const blocked = await app().request("/global/version", { headers: { authorization: basic() } })
    expect(blocked.status).toBe(401)
    expect(((await blocked.json()) as { totp?: boolean }).totp).toBe(true)

    // Exchange a valid code for a token.
    const code = generateCode(SECRET)!
    const verify = await app().request("/global/auth/verify", {
      method: "POST",
      headers: { authorization: basic(), "content-type": "application/json" },
      body: JSON.stringify({ code }),
    })
    expect(verify.status).toBe(200)
    const { token, expiresAt } = (await verify.json()) as { token: string; expiresAt: number }
    expect(typeof token).toBe("string")
    expect(expiresAt).toBeGreaterThan(Date.now())

    // The token now passes the gate.
    const ok = await app().request("/global/version", {
      headers: { authorization: basic(), "x-codeplane-otp": token },
    })
    expect(ok.status).toBe(200)
  })

  test("rejects a wrong code with 401 + totp flag", async () => {
    const res = await app().request("/global/auth/verify", {
      method: "POST",
      headers: { authorization: basic(), "content-type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { totp?: boolean }).totp).toBe(true)
  })

  test("rejects a wrong password with 401 (no totp flag)", async () => {
    const code = generateCode(SECRET)!
    const res = await app().request("/global/auth/verify", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`codeplane:wrong-password-here-1234`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ code }),
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { totp?: boolean }).totp).toBeUndefined()
  })

  test("returns 400 when TOTP is not enabled on the server", async () => {
    Flag.CODEPLANE_SERVER_TOTP_SECRET = undefined
    const res = await app().request("/global/auth/verify", {
      method: "POST",
      headers: { authorization: basic(), "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    })
    expect(res.status).toBe(400)
  })
})
