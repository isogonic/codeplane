import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDesktopLogger } from "../src/main/log"

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-log-"))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("createDesktopLogger", () => {
  test("returns logger with log and path methods", () => {
    const logger = createDesktopLogger(dir)
    expect(typeof logger.log).toBe("function")
    expect(typeof logger.path).toBe("function")
  })
  test("path returns expected file path", () => {
    const logger = createDesktopLogger(dir)
    expect(logger.path()).toBe(path.join(dir, "desktop.log"))
  })
  test("log writes to file", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { value: 1 })
    // Wait for the write to complete
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("event")
  })
  test("log includes timestamp", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("scope", "myevent")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("ts")
  })
  test("log includes pid", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("pid")
  })
  test("log includes scope", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("custom-scope", "event")
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("custom-scope")
  })
  test("creates directory if missing", async () => {
    const sub = path.join(dir, "nested", "deep")
    const logger = createDesktopLogger(sub)
    logger.log("scope", "event")
    await new Promise((r) => setTimeout(r, 50))
    const stat = await fs.stat(sub).catch(() => undefined)
    expect(stat?.isDirectory()).toBe(true)
  })
  test("handles circular references", async () => {
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj
    const logger = createDesktopLogger(dir)
    expect(() => logger.log("scope", "event", obj)).not.toThrow()
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("circular")
  })
  test("serializes Error objects", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", new Error("oops"))
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("oops")
  })
  test("serializes BigInt values", async () => {
    const logger = createDesktopLogger(dir)
    logger.log("scope", "event", { count: 42n })
    await new Promise((r) => setTimeout(r, 50))
    const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
    expect(text).toContain("42")
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk log scope-${i}`, async () => {
      const logger = createDesktopLogger(dir)
      logger.log(`scope-${i}`, `event-${i}`, { iteration: i })
      await new Promise((r) => setTimeout(r, 5))
      const text = await fs.readFile(path.join(dir, "desktop.log"), "utf8").catch(() => "")
      expect(text).toContain(`scope-${i}`)
    })
  }
})
