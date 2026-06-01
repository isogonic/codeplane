import { describe, expect, test } from "bun:test"
import {
  OTP_HEADER,
  checkRemoteAuth,
  composeRemoteAuthHeaders,
  splitRemoteAuthHeaders,
  verifyRemoteTotp,
} from "../src/remote-auth"

const decodeBasic = (value: string | undefined) => {
  const match = /^Basic\s+(.+)$/i.exec(value ?? "")
  expect(match).toBeTruthy()
  return atob(match![1]!)
}

describe("remote auth headers", () => {
  test("composes only basic auth and OTP", () => {
    const headers = composeRemoteAuthHeaders({
      headers: { "X-Team": "infra" },
      password: "secret",
      otpToken: "otp-session",
    })

    expect(headers?.["X-Team"]).toBeUndefined()
    expect(decodeBasic(headers?.Authorization)).toBe("codeplane:secret")
    expect(headers?.[OTP_HEADER]).toBe("otp-session")
  })

  test("splits saved login headers back into form fields", () => {
    const headers = composeRemoteAuthHeaders({
      headers: { "X-Team": "infra" },
      username: "alice",
      password: "secret",
      otpToken: "otp-session",
    })

    expect(splitRemoteAuthHeaders(headers)).toEqual({
      username: "alice",
      password: "secret",
      otpToken: "otp-session",
    })
  })
})

describe("remote auth probes", () => {
  test("maps /global/auth response fields", async () => {
    const status = await checkRemoteAuth(
      { url: "https://example.test", headers: composeRemoteAuthHeaders({ username: "alice", password: "secret", otpToken: "old" }) },
      async (_input, init) => {
        const headers = new Headers(init?.headers)
        expect(decodeBasic(headers.get("authorization") ?? undefined)).toBe("alice:secret")
        expect(headers.get(OTP_HEADER)).toBeNull()
        return Response.json({ required: true, authenticated: false, totpRequired: true, passwordValid: true })
      },
    )

    expect(status).toEqual({
      reachable: true,
      required: true,
      authenticated: false,
      totpRequired: true,
      passwordValid: true,
    })
  })

  test("verifies OTP using credentials split from saved headers", async () => {
    const result = await verifyRemoteTotp(
      {
        url: "https://example.test/base/",
        code: "123 456",
        headers: composeRemoteAuthHeaders({ username: "alice", password: "secret", otpToken: "old" }),
      },
      async (input, init) => {
        expect(new URL(input).pathname).toBe("/base/global/auth/verify")
        const headers = new Headers(init?.headers)
        expect(decodeBasic(headers.get("authorization") ?? undefined)).toBe("alice:secret")
        expect(headers.get(OTP_HEADER)).toBeNull()
        expect(init?.body).toBe(JSON.stringify({ code: "123456" }))
        return Response.json({ token: "next-token" })
      },
    )

    expect(result).toEqual({ ok: true, token: "next-token" })
  })
})
