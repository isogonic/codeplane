import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Flag, truthy, falsy, number } from "../../src/flag/flag"

// History note: the original version of this file used the pattern
//
//   process.env.CODEPLANE_X = "true"
//   delete require.cache[require.resolve("../../src/flag/flag")]
//   const { Flag } = await import("../../src/flag/flag")
//   expect(Flag.CODEPLANE_X).toBe(true)
//
// to force the Flag module to re-evaluate against mutated env vars. That
// re-import installs a NEW Flag object as the active module export and
// poisons every later-loaded test file (e.g. sync/index.test.ts loads
// lazily at test execution, not at process startup, so it captures the
// new Flag — while source modules like sync/index.ts still hold the
// original Flag reference). Mutations on the new Flag are invisible to
// the source, and consumers see stale defaults — manifesting as
// "EventTable has 0 rows when we expected N".
//
// Fix: exercise the truthy/falsy/number HELPERS directly instead of
// reloading Flag. The Flag object itself is verified via its static
// shape — no module-cache shenanigans needed.

const env = { ...process.env }

beforeEach(() => {
  process.env = { ...env }
})

afterEach(() => {
  process.env = { ...env }
})

describe("Flag truthy/falsy parsing", () => {
  test("truthy() returns true for 'true'", () => {
    process.env.CODEPLANE_TEST_KEY = "true"
    expect(truthy("CODEPLANE_TEST_KEY")).toBe(true)
  })

  test("truthy() returns true for '1'", () => {
    process.env.CODEPLANE_TEST_KEY = "1"
    expect(truthy("CODEPLANE_TEST_KEY")).toBe(true)
  })

  test("truthy() is case-insensitive (TRUE)", () => {
    process.env.CODEPLANE_TEST_KEY = "TRUE"
    expect(truthy("CODEPLANE_TEST_KEY")).toBe(true)
  })

  test("truthy() returns false for invalid values like 'yes'", () => {
    process.env.CODEPLANE_TEST_KEY = "yes"
    expect(truthy("CODEPLANE_TEST_KEY")).toBe(false)
  })

  test("truthy() returns false when unset", () => {
    delete process.env.CODEPLANE_TEST_KEY
    expect(truthy("CODEPLANE_TEST_KEY")).toBe(false)
  })

  test("falsy() returns true for 'false'", () => {
    process.env.CODEPLANE_TEST_KEY = "false"
    expect(falsy("CODEPLANE_TEST_KEY")).toBe(true)
  })

  test("falsy() returns true for '0'", () => {
    process.env.CODEPLANE_TEST_KEY = "0"
    expect(falsy("CODEPLANE_TEST_KEY")).toBe(true)
  })

  test("falsy() returns false when unset", () => {
    delete process.env.CODEPLANE_TEST_KEY
    expect(falsy("CODEPLANE_TEST_KEY")).toBe(false)
  })

  test("number() parses a positive integer", () => {
    process.env.CODEPLANE_TEST_KEY = "42"
    expect(number("CODEPLANE_TEST_KEY")).toBe(42)
  })

  test("number() returns undefined for non-numeric", () => {
    process.env.CODEPLANE_TEST_KEY = "abc"
    expect(number("CODEPLANE_TEST_KEY")).toBeUndefined()
  })

  test("number() returns undefined for zero or negative", () => {
    process.env.CODEPLANE_TEST_KEY = "0"
    expect(number("CODEPLANE_TEST_KEY")).toBeUndefined()
    process.env.CODEPLANE_TEST_KEY = "-5"
    expect(number("CODEPLANE_TEST_KEY")).toBeUndefined()
  })

  test("number() returns undefined for non-integer", () => {
    process.env.CODEPLANE_TEST_KEY = "1.5"
    expect(number("CODEPLANE_TEST_KEY")).toBeUndefined()
  })

  test("number() returns undefined when unset", () => {
    delete process.env.CODEPLANE_TEST_KEY
    expect(number("CODEPLANE_TEST_KEY")).toBeUndefined()
  })
})

describe("Flag dynamic getters", () => {
  test("CODEPLANE_PURE getter respects current env", () => {
    process.env.CODEPLANE_PURE = "true"
    expect(Flag.CODEPLANE_PURE).toBe(true)
    process.env.CODEPLANE_PURE = "false"
    expect(Flag.CODEPLANE_PURE).toBe(false)
    delete process.env.CODEPLANE_PURE
    expect(Flag.CODEPLANE_PURE).toBe(false)
  })

  test("CODEPLANE_DISABLE_PROJECT_CONFIG getter is dynamic", () => {
    process.env.CODEPLANE_DISABLE_PROJECT_CONFIG = "1"
    expect(Flag.CODEPLANE_DISABLE_PROJECT_CONFIG).toBe(true)
    delete process.env.CODEPLANE_DISABLE_PROJECT_CONFIG
    expect(Flag.CODEPLANE_DISABLE_PROJECT_CONFIG).toBe(false)
  })

  test("CODEPLANE_CONFIG_DIR getter is dynamic", () => {
    process.env.CODEPLANE_CONFIG_DIR = "/some/dir"
    expect(Flag.CODEPLANE_CONFIG_DIR).toBe("/some/dir")
  })

  test("CODEPLANE_CLIENT is dynamic at access time", () => {
    process.env.CODEPLANE_CLIENT = "tui"
    expect(Flag.CODEPLANE_CLIENT).toBe("tui")
    process.env.CODEPLANE_CLIENT = "desktop"
    expect(Flag.CODEPLANE_CLIENT).toBe("desktop")
  })

  test("CODEPLANE_CLIENT defaults to 'cli' when unset", () => {
    delete process.env.CODEPLANE_CLIENT
    expect(Flag.CODEPLANE_CLIENT).toBe("cli")
  })
})

describe("Flag static shape", () => {
  test("Flag is an object with expected keys", () => {
    expect("CODEPLANE_AUTO_SHARE" in Flag).toBe(true)
    expect("CODEPLANE_DISABLE_AUTOUPDATE" in Flag).toBe(true)
    expect("CODEPLANE_EXPERIMENTAL" in Flag).toBe(true)
  })
})
