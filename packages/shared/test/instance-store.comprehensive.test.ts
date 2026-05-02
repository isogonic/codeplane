import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createInstanceStore } from "../src/instance-store"
import type { SavedInstance } from "../src/instance"

let tmp: string
let file: string
let storeDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "instance-store-"))
  storeDir = tmp
  file = path.join(storeDir, "instances.json")
})

afterEach(async () => {
  await fs.rm(tmp, { force: true, recursive: true })
})

const sample = (id: string, overrides: Partial<SavedInstance> = {}): SavedInstance => ({
  id,
  url: `http://localhost:${id}`,
  ...overrides,
})

describe("createInstanceStore basics", () => {
  test("returns object with file path", () => {
    const store = createInstanceStore(file)
    expect(store.file).toBe(file)
  })
  test("list returns empty for missing file", async () => {
    const store = createInstanceStore(file)
    expect(await store.list()).toEqual([])
  })
  test("getLast returns undefined for missing file", async () => {
    const store = createInstanceStore(file)
    expect(await store.getLast()).toBeUndefined()
  })
  test("getState returns empty array for missing file", async () => {
    const store = createInstanceStore(file)
    expect((await store.getState()).instances).toEqual([])
  })
  test("getState handles invalid JSON gracefully", async () => {
    await fs.writeFile(file, "not json")
    const store = createInstanceStore(file)
    expect(await store.list()).toEqual([])
  })
  test("getState handles empty file", async () => {
    await fs.writeFile(file, "")
    const store = createInstanceStore(file)
    expect(await store.list()).toEqual([])
  })
  test("getState normalizes non-array instances", async () => {
    await fs.writeFile(file, JSON.stringify({ instances: "garbage" }))
    const store = createInstanceStore(file)
    expect(await store.list()).toEqual([])
  })
  test("getState preserves valid lastInstanceID", async () => {
    await fs.writeFile(file, JSON.stringify({ instances: [], lastInstanceID: "x" }))
    const store = createInstanceStore(file)
    expect(await store.getLast()).toBe("x")
  })
})

describe("save", () => {
  test("save adds new instance", async () => {
    const store = createInstanceStore(file)
    const list = await store.save(sample("a"))
    expect(list).toHaveLength(1)
    expect(list[0]?.id).toBe("a")
  })
  test("save updates lastInstanceID", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    expect(await store.getLast()).toBe("a")
  })
  test("save replaces existing instance", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { label: "first" }))
    const list = await store.save(sample("a", { label: "second" }))
    expect(list).toHaveLength(1)
    expect(list[0]?.label).toBe("second")
  })
  test("save preserves ordering when replacing", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.save(sample("b"))
    await store.save(sample("a", { label: "updated" }))
    const list = await store.list()
    expect(list.map((i) => i.id)).toEqual(["a", "b"])
  })
  test("save many instances", async () => {
    const store = createInstanceStore(file)
    for (let i = 0; i < 10; i++) await store.save(sample(`i${i}`))
    expect((await store.list()).length).toBe(10)
  })
  test("save persists headers", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { headers: { Authorization: "Bearer x" } }))
    const list = await store.list()
    expect(list[0]?.headers?.Authorization).toBe("Bearer x")
  })
  test("save persists clientCertSubject", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { clientCertSubject: "CN=foo" }))
    expect((await store.list())[0]?.clientCertSubject).toBe("CN=foo")
  })
  test("save persists ignoreCertificateErrors", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { ignoreCertificateErrors: true }))
    expect((await store.list())[0]?.ignoreCertificateErrors).toBe(true)
  })
  test("save persists local config", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { local: { binaryVersion: "27.3.1" } }))
    expect((await store.list())[0]?.local?.binaryVersion).toBe("27.3.1")
  })
  test("save creates directory if needed", async () => {
    const subFile = path.join(tmp, "nested", "deep", "file.json")
    const store = createInstanceStore(subFile)
    await store.save(sample("a"))
    const stat = await fs.stat(subFile)
    expect(stat.isFile()).toBe(true)
  })
  test("save persists JSON file with trailing newline", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    const text = await fs.readFile(file, "utf8")
    expect(text.endsWith("\n")).toBe(true)
  })
})

describe("remove", () => {
  test("remove deletes existing instance", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    const list = await store.remove("a")
    expect(list).toHaveLength(0)
  })
  test("remove on missing id is no-op", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    const list = await store.remove("nope")
    expect(list).toHaveLength(1)
  })
  test("remove updates lastInstanceID when last is removed", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.save(sample("b"))
    await store.remove("b")
    expect(await store.getLast()).toBe("a")
  })
  test("remove leaves lastInstanceID untouched if not removed", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.save(sample("b"))
    await store.remove("a")
    expect(await store.getLast()).toBe("b")
  })
  test("remove last empties lastInstanceID", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("only"))
    await store.remove("only")
    expect(await store.getLast()).toBeUndefined()
  })
  test("remove preserves order of others", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.save(sample("b"))
    await store.save(sample("c"))
    await store.remove("b")
    expect((await store.list()).map((i) => i.id)).toEqual(["a", "c"])
  })
})

describe("setLast", () => {
  test("setLast sets to a valid id", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.setLast("a")
    expect(await store.getLast()).toBe("a")
  })
  test("setLast can be cleared with undefined", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.setLast(undefined)
    expect(await store.getLast()).toBeUndefined()
  })
  test("setLast does not affect instances", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.save(sample("b"))
    await store.setLast(undefined)
    expect((await store.list()).length).toBe(2)
  })
  test("setLast returns the value", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    expect(await store.setLast("a")).toBe("a")
  })
  test("setLast undefined returns undefined", async () => {
    const store = createInstanceStore(file)
    expect(await store.setLast(undefined)).toBeUndefined()
  })
})

describe("replace", () => {
  test("replace overwrites all state", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.replace({ instances: [sample("z")], lastInstanceID: "z" })
    expect((await store.list()).map((i) => i.id)).toEqual(["z"])
  })
  test("replace with empty array clears", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    await store.replace({ instances: [] })
    expect(await store.list()).toEqual([])
  })
  test("replace defaults to empty when given non-array", async () => {
    const store = createInstanceStore(file)
    // @ts-expect-error testing non-array input
    await store.replace({ instances: 123 })
    expect(await store.list()).toEqual([])
  })
  test("replace preserves lastInstanceID", async () => {
    const store = createInstanceStore(file)
    await store.replace({ instances: [sample("a")], lastInstanceID: "a" })
    expect(await store.getLast()).toBe("a")
  })
  test("replace returns normalized state", async () => {
    const store = createInstanceStore(file)
    const result = await store.replace({
      instances: [sample("a")],
      lastInstanceID: "a",
    })
    expect(result.instances).toHaveLength(1)
    expect(result.lastInstanceID).toBe("a")
  })
})

describe("migrate", () => {
  test("returns current when not empty", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a"))
    const result = await store.migrate(path.join(tmp, "legacy.json"))
    expect(result.instances).toHaveLength(1)
  })
  test("returns current when legacy file equals current file", async () => {
    const store = createInstanceStore(file)
    const result = await store.migrate(file)
    expect(result.instances).toEqual([])
  })
  test("imports legacy file when current is empty", async () => {
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(
      legacy,
      JSON.stringify({ instances: [sample("legacy-a")], lastInstanceID: "legacy-a" }),
    )
    const store = createInstanceStore(file)
    const result = await store.migrate(legacy)
    expect(result.instances.map((i) => i.id)).toEqual(["legacy-a"])
    expect(result.lastInstanceID).toBe("legacy-a")
  })
  test("ignores empty legacy", async () => {
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(legacy, JSON.stringify({ instances: [] }))
    const store = createInstanceStore(file)
    const result = await store.migrate(legacy)
    expect(result.instances).toEqual([])
  })
  test("migrate writes to new file", async () => {
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(legacy, JSON.stringify({ instances: [sample("x")] }))
    const store = createInstanceStore(file)
    await store.migrate(legacy)
    const written = JSON.parse(await fs.readFile(file, "utf8"))
    expect(written.instances).toHaveLength(1)
  })
  test("does not migrate when only lastInstanceID is present in current", async () => {
    const store = createInstanceStore(file)
    await store.setLast("x")
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(legacy, JSON.stringify({ instances: [sample("a")] }))
    const result = await store.migrate(legacy)
    expect(result.instances).toEqual([])
  })
  test("migrate with missing legacy file returns empty current", async () => {
    const legacy = path.join(tmp, "missing.json")
    const store = createInstanceStore(file)
    const result = await store.migrate(legacy)
    expect(result.instances).toEqual([])
  })
})

describe("bulk save round-trip", () => {
  for (let i = 0; i < 50; i++) {
    test(`save and read back instance ${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save(sample(`bulk-${i}`, { label: `Label ${i}` }))
      const list = await store.list()
      expect(list[list.length - 1]?.label).toBe(`Label ${i}`)
    })
  }
})

describe("edge cases", () => {
  test("very long id", async () => {
    const store = createInstanceStore(file)
    const longId = "a".repeat(500)
    await store.save(sample(longId))
    expect((await store.list())[0]?.id).toBe(longId)
  })
  test("unicode label", async () => {
    const store = createInstanceStore(file)
    await store.save(sample("a", { label: "テスト 🚀" }))
    expect((await store.list())[0]?.label).toBe("テスト 🚀")
  })
  test("very long URL", async () => {
    const store = createInstanceStore(file)
    const longUrl = `http://example.com/${"x".repeat(1000)}`
    await store.save(sample("a", { url: longUrl }))
    expect((await store.list())[0]?.url).toBe(longUrl)
  })
  test("preserves many headers", async () => {
    const store = createInstanceStore(file)
    const headers: Record<string, string> = {}
    for (let i = 0; i < 50; i++) headers[`H${i}`] = `V${i}`
    await store.save(sample("a", { headers }))
    expect(Object.keys((await store.list())[0]?.headers ?? {})).toHaveLength(50)
  })
  test("data url icon stored verbatim", async () => {
    const store = createInstanceStore(file)
    const icon = "data:image/png;base64," + "x".repeat(200)
    await store.save(sample("a", { iconDataUrl: icon }))
    expect((await store.list())[0]?.iconDataUrl).toBe(icon)
  })
})

describe("stress: serial saves", () => {
  test("100 sequential saves end with correct last", async () => {
    const store = createInstanceStore(file)
    for (let i = 0; i < 100; i++) await store.save(sample(`x${i}`))
    expect((await store.list()).length).toBe(100)
    expect(await store.getLast()).toBe("x99")
  })
})
