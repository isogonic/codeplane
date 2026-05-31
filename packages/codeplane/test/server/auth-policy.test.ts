import { describe, expect, test } from "bun:test"
import { evaluatePassword, evaluateTotp, config } from "../../src/server/auth-policy"
import { generateSecret, isValidSecret } from "../../src/server/totp"

describe("evaluatePassword", () => {
  test("refuses missing password when binding non-loopback", () => {
    const v = evaluatePassword({ password: undefined, username: undefined, isLocalBind: false })
    expect(v.kind).toBe("refuse")
  })

  test("warns about missing password on loopback bind", () => {
    const v = evaluatePassword({ password: undefined, username: undefined, isLocalBind: true })
    expect(v.kind).toBe("warn")
  })

  test("refuses passwords shorter than the minimum", () => {
    const short = "x".repeat(config.MIN_PASSWORD_BYTES - 1)
    const v = evaluatePassword({ password: short, username: undefined, isLocalBind: true })
    expect(v.kind).toBe("refuse")
  })

  test("refuses well-known weak passwords even at minimum length", () => {
    const v = evaluatePassword({ password: "password", username: undefined, isLocalBind: true })
    expect(v.kind).toBe("refuse")
  })

  test("warns when password is below the recommended length", () => {
    const ok = "z".repeat(config.MIN_PASSWORD_BYTES + 1)
    expect(ok.length).toBeLessThan(config.RECOMMENDED_PASSWORD_BYTES)
    const v = evaluatePassword({ password: ok, username: undefined, isLocalBind: true })
    expect(v.kind).toBe("warn")
  })

  test("warns about default username on non-loopback bind", () => {
    const strong = "Z".repeat(config.RECOMMENDED_PASSWORD_BYTES + 4)
    const v = evaluatePassword({ password: strong, username: undefined, isLocalBind: false })
    expect(v.kind).toBe("warn")
    if (v.kind === "warn") expect(v.message).toContain("CODEPLANE_SERVER_USERNAME")
  })

  test("ok when password is strong, username custom, exposed bind", () => {
    const strong = "Z".repeat(config.RECOMMENDED_PASSWORD_BYTES + 4)
    const v = evaluatePassword({ password: strong, username: "alice", isLocalBind: false })
    expect(v.kind).toBe("ok")
  })

  test("ok when password is strong on loopback even with default username", () => {
    const strong = "Z".repeat(config.RECOMMENDED_PASSWORD_BYTES + 4)
    const v = evaluatePassword({ password: strong, username: undefined, isLocalBind: true })
    expect(v.kind).toBe("ok")
  })

  test("byte length is measured in utf-8 bytes not chars", () => {
    // 4-byte utf-8 characters; 3 of them = 12 bytes (above the minimum
    // but below the recommended).
    const v = evaluatePassword({ password: "🦄🦄🦄", username: undefined, isLocalBind: true })
    expect(v.kind).toBe("warn")
  })
})

describe("evaluateTotp", () => {
  const strong = "Z".repeat(config.RECOMMENDED_PASSWORD_BYTES + 4)

  test("ok when no TOTP secret is set", () => {
    const v = evaluateTotp({ totpSecret: undefined, password: strong, isValidSecret })
    expect(v.kind).toBe("ok")
  })

  test("ok with a valid secret and a password", () => {
    const v = evaluateTotp({ totpSecret: generateSecret(), password: strong, isValidSecret })
    expect(v.kind).toBe("ok")
  })

  test("refuses a malformed secret", () => {
    const v = evaluateTotp({ totpSecret: "not-base32-###", password: strong, isValidSecret })
    expect(v.kind).toBe("refuse")
  })

  test("warns when a secret is set without a password (2FA inactive)", () => {
    const v = evaluateTotp({ totpSecret: generateSecret(), password: undefined, isValidSecret })
    expect(v.kind).toBe("warn")
    if (v.kind === "warn") expect(v.message).toContain("inactive")
  })
})
