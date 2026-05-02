import { describe, expect, test } from "bun:test"
import { formatServerError } from "../../src/utils/server-errors"

describe("formatServerError - basic types", () => {
  test("Error instance", () =>
    expect(formatServerError(new Error("oops"))).toBe("oops"))
  test("string error", () => expect(formatServerError("plain")).toBe("plain"))
  test("undefined falls back", () =>
    expect(formatServerError(undefined, undefined, "fallback")).toBe("fallback"))
  test("undefined without fallback", () =>
    expect(formatServerError(undefined)).toBe("Unknown error"))
  test("null falls back", () =>
    expect(formatServerError(null, undefined, "fallback")).toBe("fallback"))
  test("number error returns Unknown", () => expect(formatServerError(42)).toBe("Unknown error"))
})

describe("formatServerError - ConfigInvalidError", () => {
  test("with simple message", () => {
    const err = {
      name: "ConfigInvalidError",
      data: { message: "bad config" },
    }
    const result = formatServerError(err)
    expect(result).toContain("config")
  })
  test("with path", () => {
    const err = {
      name: "ConfigInvalidError",
      data: { path: "/etc/codeplane.json" },
    }
    const result = formatServerError(err)
    expect(result).toContain("/etc/codeplane.json")
  })
  test("with issues", () => {
    const err = {
      name: "ConfigInvalidError",
      data: {
        issues: [
          { message: "bad value", path: ["foo", "bar"] },
        ],
      },
    }
    const result = formatServerError(err)
    expect(result).toContain("foo.bar")
    expect(result).toContain("bad value")
  })
  test("with multiple issues", () => {
    const err = {
      name: "ConfigInvalidError",
      data: {
        issues: [
          { message: "first issue", path: ["a"] },
          { message: "second issue", path: ["b"] },
        ],
      },
    }
    const result = formatServerError(err)
    expect(result).toContain("first issue")
    expect(result).toContain("second issue")
  })
})

describe("formatServerError - ProviderModelNotFoundError", () => {
  test("simple", () => {
    const err = {
      name: "ProviderModelNotFoundError",
      data: { providerID: "p", modelID: "m" },
    }
    const result = formatServerError(err)
    expect(result).toContain("p")
    expect(result).toContain("m")
  })
  test("with suggestions", () => {
    const err = {
      name: "ProviderModelNotFoundError",
      data: { providerID: "openai", modelID: "gpt-99", suggestions: ["gpt-4", "gpt-3.5"] },
    }
    const result = formatServerError(err)
    expect(result).toContain("Did you mean")
    expect(result).toContain("gpt-4")
  })
  test("limits suggestions to 5", () => {
    const err = {
      name: "ProviderModelNotFoundError",
      data: {
        providerID: "p",
        modelID: "m",
        suggestions: Array.from({ length: 10 }, (_, i) => `s${i}`),
      },
    }
    const result = formatServerError(err)
    expect(result.split(",").length).toBeLessThanOrEqual(6)
  })
})

describe("formatServerError - bulk", () => {
  for (let i = 0; i < 50; i++) {
    test(`Error #${i}`, () => {
      expect(formatServerError(new Error(`oops-${i}`))).toBe(`oops-${i}`)
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`string #${i}`, () => expect(formatServerError(`error-${i}`)).toBe(`error-${i}`))
  }
})

describe("formatServerError - translator", () => {
  test("translator overrides default text", () => {
    const tr = (key: string) => (key === "error.chain.unknown" ? "Localized!" : "")
    expect(formatServerError(undefined, tr)).toBe("Localized!")
  })
  test("translator returning empty falls back", () => {
    const tr = () => ""
    expect(formatServerError(undefined, tr)).toBe("Unknown error")
  })
  test("translator returning key falls back", () => {
    const tr = (key: string) => key
    expect(formatServerError(undefined, tr)).toBe("Unknown error")
  })
})
