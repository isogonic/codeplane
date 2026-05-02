import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const env = { ...process.env }

afterEach(() => {
  process.env = { ...env }
})

beforeEach(() => {
  process.env = { ...env }
})

describe("Flag truthy/falsy parsing", () => {
  test("CODEPLANE_AUTO_SHARE=true returns true", async () => {
    process.env.CODEPLANE_AUTO_SHARE = "true"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_AUTO_SHARE).toBe(true)
  })

  test("CODEPLANE_DISABLE_AUTOUPDATE=1 returns true", async () => {
    process.env.CODEPLANE_DISABLE_AUTOUPDATE = "1"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_DISABLE_AUTOUPDATE).toBe(true)
  })

  test("CODEPLANE_DISABLE_PRUNE=false returns false", async () => {
    process.env.CODEPLANE_DISABLE_PRUNE = "false"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_DISABLE_PRUNE).toBe(false)
  })

  test("CODEPLANE_DISABLE_PRUNE unset returns false", async () => {
    delete process.env.CODEPLANE_DISABLE_PRUNE
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_DISABLE_PRUNE).toBe(false)
  })

  test("CODEPLANE_CONFIG passes value through", async () => {
    process.env.CODEPLANE_CONFIG = "/path/to/config.json"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_CONFIG).toBe("/path/to/config.json")
  })

  test("CODEPLANE_CLIENT defaults to 'cli' when unset", async () => {
    delete process.env.CODEPLANE_CLIENT
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_CLIENT).toBe("cli")
  })

  test("CODEPLANE_CLIENT is dynamic at access time", async () => {
    process.env.CODEPLANE_CLIENT = "tui"
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_CLIENT).toBe("tui")
    process.env.CODEPLANE_CLIENT = "desktop"
    expect(Flag.CODEPLANE_CLIENT).toBe("desktop")
  })

  test("CODEPLANE_PURE getter respects current env", async () => {
    const { Flag } = await import("../../src/flag/flag")
    process.env.CODEPLANE_PURE = "true"
    expect(Flag.CODEPLANE_PURE).toBe(true)
    process.env.CODEPLANE_PURE = "false"
    expect(Flag.CODEPLANE_PURE).toBe(false)
    delete process.env.CODEPLANE_PURE
    expect(Flag.CODEPLANE_PURE).toBe(false)
  })

  test("CODEPLANE_DISABLE_PROJECT_CONFIG getter is dynamic", async () => {
    const { Flag } = await import("../../src/flag/flag")
    process.env.CODEPLANE_DISABLE_PROJECT_CONFIG = "1"
    expect(Flag.CODEPLANE_DISABLE_PROJECT_CONFIG).toBe(true)
    delete process.env.CODEPLANE_DISABLE_PROJECT_CONFIG
    expect(Flag.CODEPLANE_DISABLE_PROJECT_CONFIG).toBe(false)
  })

  test("CODEPLANE_CONFIG_DIR getter is dynamic", async () => {
    const { Flag } = await import("../../src/flag/flag")
    process.env.CODEPLANE_CONFIG_DIR = "/some/dir"
    expect(Flag.CODEPLANE_CONFIG_DIR).toBe("/some/dir")
  })

  test("Flag is an object with expected keys", async () => {
    const { Flag } = await import("../../src/flag/flag")
    expect("CODEPLANE_AUTO_SHARE" in Flag).toBe(true)
    expect("CODEPLANE_DISABLE_AUTOUPDATE" in Flag).toBe(true)
    expect("CODEPLANE_EXPERIMENTAL" in Flag).toBe(true)
  })

  test("invalid truthy values return false", async () => {
    process.env.CODEPLANE_AUTO_HEAP_SNAPSHOT = "yes"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_AUTO_HEAP_SNAPSHOT).toBe(false)
  })

  test("uppercase TRUE is parsed", async () => {
    process.env.CODEPLANE_DISABLE_MODELS_FETCH = "TRUE"
    delete require.cache[require.resolve("../../src/flag/flag")]
    const { Flag } = await import("../../src/flag/flag")
    expect(Flag.CODEPLANE_DISABLE_MODELS_FETCH).toBe(true)
  })
})
