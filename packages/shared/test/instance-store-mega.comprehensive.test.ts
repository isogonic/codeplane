import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createInstanceStore } from "../src/instance-store"
import type { SavedInstance } from "../src/instance"

let tmp: string
let file: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "instance-store-mega-"))
  file = path.join(tmp, "instances.json")
})
afterEach(async () => {
  await fs.rm(tmp, { force: true, recursive: true })
})

const sample = (id: string, overrides: Partial<SavedInstance> = {}): SavedInstance => ({
  id,
  url: `http://localhost:${id}`,
  ...overrides,
})

describe("instance-store mega - save/list/get scenarios", () => {
  for (let i = 0; i < 60; i++) {
    test(`save and read back instance ${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save(sample(`bulk-${i}`, { label: `Label ${i}` }))
      const list = await store.list()
      expect(list[list.length - 1]?.label).toBe(`Label ${i}`)
    })
  }
  for (let i = 0; i < 60; i++) {
    test(`save many ids ${i}`, async () => {
      const store = createInstanceStore(file)
      const ids: string[] = []
      for (let j = 0; j < 5; j++) {
        ids.push(`id-${i}-${j}`)
        await store.save(sample(ids[j]!))
      }
      const list = await store.list()
      expect(list.map((x) => x.id)).toEqual(ids)
    })
  }
})

describe("instance-store mega - remove scenarios", () => {
  for (let i = 0; i < 30; i++) {
    test(`remove keeps remaining items #${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save(sample(`a-${i}`))
      await store.save(sample(`b-${i}`))
      await store.save(sample(`c-${i}`))
      await store.remove(`b-${i}`)
      const list = await store.list()
      expect(list.map((x) => x.id)).toEqual([`a-${i}`, `c-${i}`])
    })
  }
})

describe("instance-store mega - setLast / getLast", () => {
  for (let i = 0; i < 30; i++) {
    test(`setLast survives #${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save(sample(`x-${i}`))
      await store.setLast(`x-${i}`)
      expect(await store.getLast()).toBe(`x-${i}`)
    })
  }
})

describe("instance-store mega - replace", () => {
  for (let i = 0; i < 30; i++) {
    test(`replace clears + sets #${i}`, async () => {
      const store = createInstanceStore(file)
      await store.save(sample("original"))
      await store.replace({ instances: [sample(`new-${i}`)], lastInstanceID: `new-${i}` })
      expect((await store.list()).map((x) => x.id)).toEqual([`new-${i}`])
    })
  }
})

describe("instance-store mega - migration", () => {
  for (let i = 0; i < 20; i++) {
    test(`migrate when current empty #${i}`, async () => {
      const legacy = path.join(tmp, `legacy-${i}.json`)
      await fs.writeFile(
        legacy,
        JSON.stringify({ instances: [sample(`migrated-${i}`)], lastInstanceID: `migrated-${i}` }),
      )
      const store = createInstanceStore(path.join(tmp, `current-${i}.json`))
      const result = await store.migrate(legacy)
      expect(result.instances.map((x) => x.id)).toEqual([`migrated-${i}`])
    })
  }
})
