import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDesktopLogger } from "../src/main/log"

const tempDirs: string[] = []
async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-log-param-"))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function readEntries(file: string) {
  const text = await fs.readFile(file, "utf8")
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

describe("createDesktopLogger - many scopes and events", () => {
  const scopes = ["main", "window", "ipc", "auth", "instance", "updater", "renderer", "local"]
  const events = ["start", "ready", "click", "error", "close", "open"]
  for (const scope of scopes) {
    for (const event of events) {
      test(`scope ${scope} event ${event} written correctly`, async () => {
        const dir = await makeTempDir()
        const logger = createDesktopLogger(dir)
        logger.log(scope, event)
        await new Promise((r) => setTimeout(r, 30))
        const entries = await readEntries(logger.path())
        expect(entries).toHaveLength(1)
        expect(entries[0].scope).toBe(scope)
        expect(entries[0].event).toBe(event)
      })
    }
  }
})

describe("createDesktopLogger - data variants", () => {
  const variants: Array<[string, unknown]> = [
    ["string data", "hello"],
    ["empty string", ""],
    ["number", 42],
    ["zero", 0],
    ["negative number", -1],
    ["true", true],
    ["false", false],
    ["null", null],
    ["empty array", []],
    ["empty object", {}],
    ["nested object", { a: { b: { c: 1 } } }],
    ["array of strings", ["a", "b", "c"]],
    ["array of numbers", [1, 2, 3]],
    ["array of mixed", ["a", 1, true, null]],
    ["object with arrays", { items: [1, 2, 3] }],
    ["object with mixed types", { id: "x", count: 1, active: true }],
    ["unicode string", "hello 🌍 нiхай 中文"],
    ["string with newlines", "line1\nline2\nline3"],
    ["string with tabs", "a\tb\tc"],
    ["string with quotes", 'a "b" c'],
    ["very long string", "x".repeat(1000)],
  ]
  for (let i = 0; i < variants.length; i++) {
    const [name, data] = variants[i]
    test(`data variant ${i}: ${name}`, async () => {
      const dir = await makeTempDir()
      const logger = createDesktopLogger(dir)
      logger.log("scope", "event", data)
      await new Promise((r) => setTimeout(r, 30))
      const entries = await readEntries(logger.path())
      expect(entries).toHaveLength(1)
      expect(entries[0].data).toEqual(data as never)
    })
  }
})

describe("createDesktopLogger - timestamps are monotonic-ish", () => {
  test("entries logged sequentially have non-decreasing timestamps", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    for (let i = 0; i < 20; i++) logger.log("scope", `event-${i}`)
    await new Promise((r) => setTimeout(r, 80))
    const entries = await readEntries(logger.path())
    expect(entries).toHaveLength(20)
    for (let i = 1; i < entries.length; i++) {
      expect(Date.parse(entries[i].ts)).toBeGreaterThanOrEqual(Date.parse(entries[i - 1].ts))
    }
  })
})

describe("createDesktopLogger - multiple loggers in same dir", () => {
  test("two loggers append in arrival order", async () => {
    const dir = await makeTempDir()
    const a = createDesktopLogger(dir)
    const b = createDesktopLogger(dir)
    a.log("a", "1")
    b.log("b", "1")
    a.log("a", "2")
    b.log("b", "2")
    a.log("a", "3")
    await new Promise((r) => setTimeout(r, 100))
    const entries = await readEntries(a.path())
    expect(entries).toHaveLength(5)
  })
})

describe("createDesktopLogger - special errors", () => {
  test("TypeError serialized correctly", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", new TypeError("type error"))
    await new Promise((r) => setTimeout(r, 30))
    const entries = await readEntries(logger.path())
    expect(entries[0].data.name).toBe("TypeError")
    expect(entries[0].data.message).toBe("type error")
  })

  test("RangeError serialized correctly", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", new RangeError("out of range"))
    await new Promise((r) => setTimeout(r, 30))
    const entries = await readEntries(logger.path())
    expect(entries[0].data.name).toBe("RangeError")
  })

  test("Error nested in object", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { wrapped: { error: new Error("nested") } })
    await new Promise((r) => setTimeout(r, 30))
    const entries = await readEntries(logger.path())
    expect(entries[0].data.wrapped.error.name).toBe("Error")
    expect(entries[0].data.wrapped.error.message).toBe("nested")
  })

  test("Error inside array", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", [new Error("a"), new Error("b")])
    await new Promise((r) => setTimeout(r, 30))
    const entries = await readEntries(logger.path())
    expect(entries[0].data).toHaveLength(2)
    expect(entries[0].data[0].message).toBe("a")
    expect(entries[0].data[1].message).toBe("b")
  })
})

describe("createDesktopLogger - bigints", () => {
  const bigints: Array<bigint> = [
    0n,
    1n,
    -1n,
    100n,
    9007199254740993n,
    -9007199254740993n,
    123456789012345678901234567890n,
  ]
  for (let i = 0; i < bigints.length; i++) {
    const value = bigints[i]
    test(`bigint ${i}: ${value}`, async () => {
      const dir = await makeTempDir()
      const logger = createDesktopLogger(dir)
      logger.log("scope", "event", { value })
      await new Promise((r) => setTimeout(r, 30))
      const entries = await readEntries(logger.path())
      expect(entries[0].data.value).toBe(value.toString())
    })
  }
})
