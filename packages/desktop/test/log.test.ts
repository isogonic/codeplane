import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDesktopLogger } from "../src/main/log"

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-desktop-log-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe("createDesktopLogger - basic shape", () => {
  test("returns log() and path()", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    expect(typeof logger.log).toBe("function")
    expect(typeof logger.path).toBe("function")
    expect(logger.path()).toBe(path.join(dir, "desktop.log"))
  })

  test("path() is stable across calls", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    expect(logger.path()).toBe(logger.path())
  })

  test("path() uses provided directory verbatim", async () => {
    const dir = await makeTempDir()
    const sub = path.join(dir, "nested", "deeper")
    const logger = createDesktopLogger(sub)
    expect(logger.path()).toBe(path.join(sub, "desktop.log"))
  })
})

describe("createDesktopLogger - writes to disk", () => {
  test("creates the log directory if missing", async () => {
    const dir = await makeTempDir()
    const sub = path.join(dir, "logs", "deep")
    const logger = createDesktopLogger(sub)
    logger.log("scope", "event")
    // Wait for the queued write
    await new Promise((r) => setTimeout(r, 50))
    const stat = await fs.stat(sub)
    expect(stat.isDirectory()).toBe(true)
  })

  test("writes a single JSON line for one event", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("a", "b")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    expect(text.endsWith("\n")).toBe(true)
    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.scope).toBe("a")
    expect(entry.event).toBe("b")
  })

  test("includes ISO timestamp", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(typeof entry.ts).toBe("string")
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // Date.parse must succeed
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false)
  })

  test("includes pid", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("a", "b")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.pid).toBe(process.pid)
  })

  test("includes data when provided", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { a: 1, b: "two" })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toEqual({ a: 1, b: "two" })
  })

  test("omits data when undefined", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect("data" in entry).toBe(false)
  })

  test("appends multiple entries in order", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("s", "first")
    logger.log("s", "second")
    logger.log("s", "third")
    await new Promise((r) => setTimeout(r, 100))
    const text = await fs.readFile(logger.path(), "utf8")
    const lines = text.trim().split("\n").map((l) => JSON.parse(l))
    expect(lines).toHaveLength(3)
    expect(lines[0].event).toBe("first")
    expect(lines[1].event).toBe("second")
    expect(lines[2].event).toBe("third")
  })
})

describe("createDesktopLogger - serialization edge cases", () => {
  test("Error objects serialized to {name, message, stack}", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    const err = new Error("boom")
    logger.log("scope", "event", { err })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.err).toEqual({
      name: "Error",
      message: "boom",
      stack: err.stack,
    })
  })

  test("Custom error subclass serialized via name property", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    class MyError extends Error {
      constructor(m: string) {
        super(m)
        this.name = "MyError"
      }
    }
    logger.log("scope", "event", new MyError("bad"))
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.name).toBe("MyError")
    expect(entry.data.message).toBe("bad")
  })

  test("BigInt serialized as string", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { big: 1234567890123456789n })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.big).toBe("1234567890123456789")
  })

  test("Circular references replaced with [circular]", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    logger.log("scope", "event", obj)
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.a).toBe(1)
    expect(entry.data.self).toBe("[circular]")
  })

  test("Nested circular reference handled", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    const a: Record<string, unknown> = {}
    const b: Record<string, unknown> = { a }
    a.b = b
    logger.log("scope", "event", { a })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.a.b.a).toBe("[circular]")
  })

  test("Array values pass through", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", [1, "two", true])
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toEqual([1, "two", true])
  })

  test("nested objects and arrays serialize", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { list: [{ id: 1 }, { id: 2 }] })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data.list).toEqual([{ id: 1 }, { id: 2 }])
  })

  test("null data is preserved", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", null)
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toBeNull()
  })

  test("string data preserved", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", "plain text")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toBe("plain text")
  })

  test("number data preserved", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", 42)
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toBe(42)
  })

  test("boolean data preserved", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", true)
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(logger.path(), "utf8")
    const entry = JSON.parse(text.trim())
    expect(entry.data).toBe(true)
  })
})

describe("createDesktopLogger - many writes ordered correctly", () => {
  test("100 sequential log calls all write in order", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    for (let i = 0; i < 100; i++) {
      logger.log("scope", `event-${i}`, { i })
    }
    await new Promise((r) => setTimeout(r, 200))
    const text = await fs.readFile(logger.path(), "utf8")
    const lines = text.trim().split("\n").map((l) => JSON.parse(l))
    expect(lines).toHaveLength(100)
    for (let i = 0; i < 100; i++) {
      expect(lines[i].event).toBe(`event-${i}`)
      expect(lines[i].data.i).toBe(i)
    }
  })

  test("two loggers share the file safely if they point to same dir", async () => {
    const dir = await makeTempDir()
    const a = createDesktopLogger(dir)
    const b = createDesktopLogger(dir)
    expect(a.path()).toBe(b.path())
    a.log("a", "1")
    b.log("b", "1")
    a.log("a", "2")
    b.log("b", "2")
    await new Promise((r) => setTimeout(r, 100))
    const text = await fs.readFile(a.path(), "utf8")
    const lines = text.trim().split("\n").map((l) => JSON.parse(l))
    expect(lines).toHaveLength(4)
  })
})

describe("createDesktopLogger - resilient to fs errors", () => {
  test("does not throw synchronously on log()", async () => {
    const dir = await makeTempDir()
    // Make the dir read-only so writes silently fail; logger must not crash.
    const logger = createDesktopLogger(dir)
    await fs.chmod(dir, 0o400)
    try {
      expect(() => logger.log("scope", "event")).not.toThrow()
      logger.log("scope", "after")
      // Give the queued write a chance to run/fail; nothing should be unhandled.
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      await fs.chmod(dir, 0o700)
    }
  })

  test("returns same path even if write would fail", async () => {
    const dir = await makeTempDir()
    const logger = createDesktopLogger(dir)
    expect(logger.path()).toBe(path.join(dir, "desktop.log"))
  })
})
