import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createInstanceStore } from "../src/instance-store"
import type { SavedInstance } from "../src/instance"

let tmp: string
let file: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "instance-store-param-"))
  file = path.join(tmp, "instances.json")
})

afterEach(async () => {
  await fs.rm(tmp, { force: true, recursive: true })
})

describe("instance-store - bulk save/list cycles", () => {
  for (let n = 1; n <= 50; n++) {
    test(`save and list ${n} instances`, async () => {
      const store = createInstanceStore(file)
      const items: SavedInstance[] = Array.from({ length: n }, (_, i) => ({
        id: `id-${i}`,
        url: `http://example.com:${i + 1000}`,
      }))
      for (const item of items) await store.save(item)
      expect(await store.list()).toEqual(items)
    })
  }
})

describe("instance-store - getLast is explicit", () => {
  for (let n = 1; n <= 30; n++) {
    test(`save does not select any of ${n} saved instances`, async () => {
      const store = createInstanceStore(file)
      for (let i = 0; i < n; i++) {
        await store.save({ id: `id-${i}`, url: `http://localhost:${i + 1000}` })
      }
      expect(await store.getLast()).toBeUndefined()
    })
  }
})

describe("instance-store - update existing in place by id", () => {
  for (let i = 0; i < 20; i++) {
    test(`update iteration ${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save({ id: "fixed", url: "http://x:1" })
      await store.save({ id: "fixed", url: `http://x:${i + 2}`, label: `label-${i}` })
      const items = await store.list()
      expect(items).toHaveLength(1)
      expect(items[0].url).toBe(`http://x:${i + 2}`)
      expect(items[0].label).toBe(`label-${i}`)
    })
  }
})

describe("instance-store - remove behavior", () => {
  for (let n = 2; n <= 10; n++) {
    test(`remove from a list of ${n} instances`, async () => {
      const store = createInstanceStore(file)
      for (let i = 0; i < n; i++) await store.save({ id: `id-${i}`, url: `http://x:${i + 1000}` })
      const removeID = `id-${Math.floor(n / 2)}`
      await store.remove(removeID)
      const list = await store.list()
      expect(list).toHaveLength(n - 1)
      expect(list.find((item) => item.id === removeID)).toBeUndefined()
    })
  }

  test("remove a non-existent id is a no-op", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://x" })
    await store.remove("ghost")
    expect(await store.list()).toEqual([{ id: "a", url: "http://x" }])
  })

  test("remove the last instance leaves the list empty", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "only", url: "http://x" })
    await store.setLast("only")
    await store.remove("only")
    expect(await store.list()).toEqual([])
    expect(await store.getLast()).toBeUndefined()
  })

  test("remove the last instance clears getLast instead of reassigning", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    await store.setLast("b")
    expect(await store.getLast()).toBe("b")
    await store.remove("b")
    expect(await store.getLast()).toBeUndefined()
  })

  test("remove a non-last instance preserves getLast", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    await store.setLast("b")
    expect(await store.getLast()).toBe("b")
    await store.remove("a")
    expect(await store.getLast()).toBe("b")
  })

  test("remove returns the resulting list", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    const result = await store.remove("a")
    expect(result.map((entry) => entry.id)).toEqual(["b"])
  })
})

describe("instance-store - setLast", () => {
  test("setLast assigns to a specific id", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    await store.setLast("a")
    expect(await store.getLast()).toBe("a")
  })

  test("setLast accepts undefined to clear", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.setLast(undefined)
    expect(await store.getLast()).toBeUndefined()
  })

  test("setLast does not modify instance list", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    const before = await store.list()
    await store.setLast("a")
    const after = await store.list()
    expect(after).toEqual(before)
  })

  test("setLast for a non-existent id still records it", async () => {
    const store = createInstanceStore(file)
    await store.setLast("ghost")
    expect(await store.getLast()).toBe("ghost")
  })

  test("setLast returns the value provided", async () => {
    const store = createInstanceStore(file)
    expect(await store.setLast("x")).toBe("x")
    expect(await store.setLast(undefined)).toBeUndefined()
  })
})

describe("instance-store - replace", () => {
  test("replace overwrites contents", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.replace({ instances: [{ id: "z", url: "http://z" }], lastInstanceID: "z" })
    expect(await store.list()).toEqual([{ id: "z", url: "http://z" }])
    expect(await store.getLast()).toBe("z")
  })

  test("replace defaults instances to empty array if not array", async () => {
    const store = createInstanceStore(file)
    const result = await store.replace({ instances: undefined as never, lastInstanceID: undefined })
    expect(result.instances).toEqual([])
  })

  test("replace returns normalized state", async () => {
    const store = createInstanceStore(file)
    const result = await store.replace({
      instances: [{ id: "a", url: "http://a" }],
      lastInstanceID: "a",
    })
    expect(result).toEqual({
      instances: [{ id: "a", url: "http://a" }],
      lastInstanceID: "a",
    })
  })
})

describe("instance-store - migrate", () => {
  test("migrate from non-existent legacy file is a no-op", async () => {
    const store = createInstanceStore(file)
    const legacy = path.join(tmp, "ghost.json")
    await store.migrate(legacy)
    expect(await store.list()).toEqual([])
  })

  test("migrate copies legacy contents when current is empty", async () => {
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(
      legacy,
      JSON.stringify({
        instances: [{ id: "old", url: "http://old" }],
        lastInstanceID: "old",
      }),
    )
    const store = createInstanceStore(file)
    await store.migrate(legacy)
    expect(await store.list()).toEqual([{ id: "old", url: "http://old" }])
    expect(await store.getLast()).toBe("old")
  })

  test("migrate is a no-op when current already has data", async () => {
    const legacy = path.join(tmp, "legacy.json")
    await fs.writeFile(
      legacy,
      JSON.stringify({
        instances: [{ id: "old", url: "http://old" }],
        lastInstanceID: "old",
      }),
    )
    const store = createInstanceStore(file)
    await store.save({ id: "current", url: "http://c" })
    await store.migrate(legacy)
    expect((await store.list()).map((i) => i.id)).toEqual(["current"])
  })

  test("migrate refuses to migrate from itself", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "self", url: "http://x" })
    await store.migrate(file)
    expect(await store.list()).toEqual([{ id: "self", url: "http://x" }])
  })

  test("migrate ignores empty legacy file", async () => {
    const legacy = path.join(tmp, "empty-legacy.json")
    await fs.writeFile(legacy, JSON.stringify({ instances: [] }))
    const store = createInstanceStore(file)
    await store.migrate(legacy)
    expect(await store.list()).toEqual([])
  })
})

describe("instance-store - persistence and reads", () => {
  test("survives store recreation (file-backed)", async () => {
    const a = createInstanceStore(file)
    await a.save({ id: "x", url: "http://x" })
    const b = createInstanceStore(file)
    expect(await b.list()).toEqual([{ id: "x", url: "http://x" }])
  })

  test("two stores on the same file see each other's writes", async () => {
    const a = createInstanceStore(file)
    const b = createInstanceStore(file)
    await a.save({ id: "x", url: "http://x" })
    expect(await b.list()).toEqual([{ id: "x", url: "http://x" }])
  })

  test("returned save() value is the current list", async () => {
    const store = createInstanceStore(file)
    expect(await store.save({ id: "a", url: "http://a" })).toEqual([{ id: "a", url: "http://a" }])
  })

  test("save() is idempotent for the same input", async () => {
    const store = createInstanceStore(file)
    const inst = { id: "x", url: "http://x" }
    await store.save(inst)
    await store.save(inst)
    expect(await store.list()).toEqual([inst])
  })

  test("file format is JSON pretty-printed with trailing newline", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    const raw = await fs.readFile(file, "utf8")
    expect(raw.endsWith("\n")).toBe(true)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test("file format is valid JSON across all operations", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "a", url: "http://a" })
    await store.save({ id: "b", url: "http://b" })
    await store.remove("a")
    await store.setLast(undefined)
    await store.replace({ instances: [{ id: "c", url: "http://c" }], lastInstanceID: "c" })
    const raw = await fs.readFile(file, "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe("instance-store - rich SavedInstance fields preserved", () => {
  const fields: Array<[string, Partial<SavedInstance>]> = [
    ["url only", { url: "http://x" }],
    ["with label", { label: "Test Label" }],
    ["with headers", { headers: { Authorization: "Bearer x" } }],
    ["with multiple headers", { headers: { A: "1", B: "2", C: "3" } }],
    ["ignoreCertificateErrors true", { ignoreCertificateErrors: true }],
    ["ignoreCertificateErrors false", { ignoreCertificateErrors: false }],
    ["clientCertSubject", { clientCertSubject: "CN=Client" }],
    ["iconDataUrl", { iconDataUrl: "data:image/png;base64,xxx" }],
    ["local binary version", { local: { binaryVersion: "27.4.0" } }],
    [
      "all fields",
      {
        label: "Full",
        headers: { A: "1" },
        ignoreCertificateErrors: true,
        clientCertSubject: "CN=Full",
        iconDataUrl: "data:,",
        local: { binaryVersion: "1.0.0" },
      },
    ],
  ]
  for (let i = 0; i < fields.length; i++) {
    const [name, partial] = fields[i]
    test(`preserves field set ${i}: ${name}`, async () => {
      const store = createInstanceStore(file)
      const inst: SavedInstance = { id: `inst-${i}`, url: "http://x", ...partial }
      await store.save(inst)
      expect(await store.list()).toEqual([inst])
    })
  }
})

describe("instance-store - large instance IDs", () => {
  for (let len of [1, 10, 50, 100, 500, 1000]) {
    test(`id length ${len}`, async () => {
      const store = createInstanceStore(file)
      const id = "a".repeat(len)
      await store.save({ id, url: "http://x" })
      expect(await store.list()).toEqual([{ id, url: "http://x" }])
    })
  }
})

describe("instance-store - many concurrent reads", () => {
  test("100 concurrent list calls all return same data", async () => {
    const store = createInstanceStore(file)
    await store.save({ id: "x", url: "http://x" })
    const results = await Promise.all(Array.from({ length: 100 }, () => store.list()))
    for (const result of results) {
      expect(result).toEqual([{ id: "x", url: "http://x" }])
    }
  })
})
