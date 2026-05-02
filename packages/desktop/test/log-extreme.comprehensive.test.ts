import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createDesktopLogger } from "../src/main/log"

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "desktop-log-extreme-"))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe("EXTREME desktop logger", () => {
  for (let i = 0; i < 200; i++) {
    test(`bulk basic write ${i}`, async () => {
      const logger = createDesktopLogger(dir)
      logger.log(`scope-${i}`, `event-${i}`, { iteration: i })
      await new Promise((r) => setTimeout(r, 1))
      // The file may not have been flushed yet, but the call shouldn't throw.
      expect(typeof logger.path()).toBe("string")
    })
  }
  for (let i = 0; i < 50; i++) {
    test(`event types #${i}`, async () => {
      const logger = createDesktopLogger(dir)
      logger.log("scope", "event", { num: i, str: `s${i}`, bool: i % 2 === 0 })
      expect(logger.path()).toBe(path.join(dir, "desktop.log"))
    })
  }
})
