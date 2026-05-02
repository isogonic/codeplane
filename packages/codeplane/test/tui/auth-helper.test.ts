import { describe, expect, test } from "bun:test"
import { normalizeAuthInput } from "../../src/tui/auth-helper"

describe("normalizeAuthInput", () => {
  test("returns undefined for empty / whitespace input", () => {
    expect(normalizeAuthInput("")).toBeUndefined()
    expect(normalizeAuthInput("   \n  ")).toBeUndefined()
  })

  test("keeps an existing `Name: Value` header line as-is", () => {
    expect(normalizeAuthInput("Authorization: Bearer eyJabc")).toBe("Authorization: Bearer eyJabc")
    expect(normalizeAuthInput("Cookie: CF_Authorization=eyJabc")).toBe("Cookie: CF_Authorization=eyJabc")
    expect(normalizeAuthInput("X-Custom-Header: some-value")).toBe("X-Custom-Header: some-value")
  })

  test("trims surrounding whitespace", () => {
    expect(normalizeAuthInput("   Authorization: Bearer eyJabc   ")).toBe("Authorization: Bearer eyJabc")
  })

  test("wraps `Bearer ...` as Authorization header", () => {
    expect(normalizeAuthInput("Bearer eyJabc")).toBe("Authorization: Bearer eyJabc")
    expect(normalizeAuthInput("bearer eyJabc")).toBe("Authorization: bearer eyJabc")
  })

  test("wraps `Basic ...` and `Token ...` as Authorization header", () => {
    expect(normalizeAuthInput("Basic dXNlcjpwYXNz")).toBe("Authorization: Basic dXNlcjpwYXNz")
    expect(normalizeAuthInput("Token abc123")).toBe("Authorization: Token abc123")
  })

  test("wraps a raw JWT as Authorization Bearer", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"
    expect(normalizeAuthInput(jwt)).toBe(`Authorization: Bearer ${jwt}`)
  })

  test("wraps a `name=value` cookie pair as a Cookie header", () => {
    expect(normalizeAuthInput("CF_Authorization=eyJabc")).toBe("Cookie: CF_Authorization=eyJabc")
  })

  test("preserves multi-pair cookies with `;` separator", () => {
    // The cookie value contains `;`, which would normally be a split
    // character — normalizeAuthInput must keep it intact.
    expect(normalizeAuthInput("CF_Authorization=v1; CF_Other=v2")).toBe("Cookie: CF_Authorization=v1; CF_Other=v2")
  })

  test("falls back to wrapping anything else as a Cookie value", () => {
    // No `=`, no `:`, no Bearer/Basic prefix, not a JWT shape — treat as
    // an opaque cookie value the user pasted from devtools.
    expect(normalizeAuthInput("opaque-token-value")).toBe("Cookie: opaque-token-value")
  })

  test("does not misinterpret cookie values that contain a colon", () => {
    // `name=value:with:colons` has `=` before `:`, so we wrap as Cookie.
    expect(normalizeAuthInput("session=abc:def:ghi")).toBe("Cookie: session=abc:def:ghi")
  })

  test("does not treat `not-a-valid-name: x` (with hyphen-leading-digit etc.) as header line", () => {
    // First char is digit → not a valid HTTP header name → fall through.
    expect(normalizeAuthInput("1abc: value")).toBe("Cookie: 1abc: value")
  })
})
