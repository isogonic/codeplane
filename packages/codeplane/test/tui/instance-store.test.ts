import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createInstanceStore } from "../../src/tui/instance-store"

const temp: string[] = []

afterEach(async () => {
  await Promise.all(temp.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function store() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codeplane-tui-store-"))
  temp.push(dir)
  return createInstanceStore(path.join(dir, "instances.json"))
}

describe("tui.instance-store", () => {
  test("saves and lists instances", async () => {
    const target = await store()
    await target.save({
      id: "remote-1",
      url: "https://example.com",
      label: "Example",
    })

    expect(await target.list()).toEqual([
      {
        id: "remote-1",
        url: "https://example.com",
        label: "Example",
      },
    ])
    expect(await target.getLast()).toBe("remote-1")
  })

  test("updates existing instances in place", async () => {
    const target = await store()
    await target.save({
      id: "local-1",
      url: "http://127.0.0.1",
      label: "Local",
      local: {
        binaryVersion: "27.2.0",
      },
    })
    await target.save({
      id: "local-1",
      url: "http://127.0.0.1",
      label: "Local Updated",
      local: {
        binaryVersion: "27.1.2",
      },
    })

    expect(await target.list()).toEqual([
      {
        id: "local-1",
        url: "http://127.0.0.1",
        label: "Local Updated",
        local: {
          binaryVersion: "27.1.2",
        },
      },
    ])
  })

  test("removes instances and repairs the last selection", async () => {
    const target = await store()
    await target.save({ id: "a", url: "https://a.example.com" })
    await target.save({ id: "b", url: "https://b.example.com" })
    await target.remove("b")

    expect(await target.list()).toEqual([{ id: "a", url: "https://a.example.com" }])
    expect(await target.getLast()).toBe("a")
  })
})
