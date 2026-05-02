import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInstanceStore } from "../../src/instance-store"

const temp: string[] = []

afterEach(async () => {
  await Promise.all(temp.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })))
})

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-instance-store-"))
  temp.push(dir)
  return {
    current: path.join(dir, "Codeplane", "instances.json"),
    legacy: path.join(dir, "legacy", "instances.json"),
  }
}

describe("instance-store", () => {
  test("migrates legacy instance state into the canonical registry", async () => {
    const files = await fixture()
    await fs.mkdir(path.dirname(files.legacy), { recursive: true })
    await fs.writeFile(
      files.legacy,
      `${JSON.stringify(
        {
          instances: [{ id: "local-1", url: "local://local-1", local: { binaryVersion: "27.3.0" } }],
          lastInstanceID: "local-1",
        },
        null,
        2,
      )}\n`,
    )

    const store = createInstanceStore(files.current)
    const state = await store.migrate(files.legacy)

    expect(state).toEqual({
      instances: [{ id: "local-1", url: "local://local-1", local: { binaryVersion: "27.3.0" } }],
      lastInstanceID: "local-1",
    })
    expect(await store.getState()).toEqual(state)
  })

  test("keeps canonical instance state when legacy data also exists", async () => {
    const files = await fixture()
    const store = createInstanceStore(files.current)

    await store.save({ id: "remote-1", url: "https://example.com", label: "Primary" })
    await fs.mkdir(path.dirname(files.legacy), { recursive: true })
    await fs.writeFile(
      files.legacy,
      `${JSON.stringify(
        {
          instances: [{ id: "remote-2", url: "https://legacy.example.com", label: "Legacy" }],
          lastInstanceID: "remote-2",
        },
        null,
        2,
      )}\n`,
    )

    await store.migrate(files.legacy)

    expect(await store.getState()).toEqual({
      instances: [{ id: "remote-1", url: "https://example.com", label: "Primary" }],
      lastInstanceID: "remote-1",
    })
  })
})
