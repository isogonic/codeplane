import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

type PersistTestingType = typeof import("./persist").PersistTesting
type PersistModule = typeof import("./persist")

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  readonly events: string[] = []
  readonly calls = { get: 0, set: 0, remove: 0 }

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    this.calls.get += 1
    this.events.push(`get:${key}`)
    if (key.startsWith("codeplane.throw")) throw new Error("storage get failed")
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.calls.set += 1
    this.events.push(`set:${key}`)
    if (key.startsWith("codeplane.quota")) throw new DOMException("quota", "QuotaExceededError")
    if (key.startsWith("codeplane.throw")) throw new Error("storage set failed")
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.calls.remove += 1
    this.events.push(`remove:${key}`)
    if (key.startsWith("codeplane.throw")) throw new Error("storage remove failed")
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

let persistTesting: PersistTestingType
let persistMod: PersistModule

beforeAll(async () => {
  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "web" }),
  }))

  const mod = await import("./persist")
  persistMod = mod
  persistTesting = mod.PersistTesting
})

beforeEach(() => {
  storage.clear()
  storage.events.length = 0
  storage.calls.get = 0
  storage.calls.set = 0
  storage.calls.remove = 0
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

describe("persist localStorage resilience", () => {
  test("does not cache values as persisted when quota write and eviction fail", () => {
    const storageApi = persistTesting.localStorageWithPrefix("codeplane.quota.scope")
    storageApi.setItem("value", '{"value":1}')

    expect(storage.getItem("codeplane.quota.scope:value")).toBeNull()
    expect(storageApi.getItem("value")).toBeNull()
  })

  test("disables only the failing scope when storage throws", () => {
    const bad = persistTesting.localStorageWithPrefix("codeplane.throw.scope")
    bad.setItem("value", '{"value":1}')

    const before = storage.calls.set
    bad.setItem("value", '{"value":2}')
    expect(storage.calls.set).toBe(before)
    expect(bad.getItem("value")).toBeNull()

    const healthy = persistTesting.localStorageWithPrefix("codeplane.safe.scope")
    healthy.setItem("value", '{"value":3}')
    expect(storage.getItem("codeplane.safe.scope:value")).toBe('{"value":3}')
  })

  test("failing fallback scope does not poison direct storage scope", () => {
    const broken = persistTesting.localStorageWithPrefix("codeplane.throw.scope2")
    broken.setItem("value", '{"value":1}')

    const direct = persistTesting.localStorageDirect()
    direct.setItem("direct-value", '{"value":5}')

    expect(storage.getItem("direct-value")).toBe('{"value":5}')
  })

  test("normalizer rejects malformed JSON payloads", () => {
    const result = persistTesting.normalize({ value: "ok" }, '{"value":"\\x"}')
    expect(result).toBeUndefined()
  })

  test("workspace storage sanitizes Windows filename characters", () => {
    const result = persistTesting.workspaceStorage("C:\\Users\\foo")

    expect(result).toStartWith("codeplane.workspace.")
    expect(result.endsWith(".dat")).toBeTrue()
    expect(/[:\\/]/.test(result)).toBeFalse()
  })

  test("server workspace storage separates local and remote scopes", () => {
    const local = persistTesting.serverWorkspaceStorage({ key: "local", legacy: true }, "/repo")
    const remote = persistTesting.serverWorkspaceStorage({ key: "https://remote.example.com" }, "/repo")

    expect(local).not.toBe(remote)
    expect(local).not.toBe(persistTesting.workspaceStorage("/repo"))
    expect(remote).not.toBe(persistTesting.workspaceStorage("/repo"))
  })

  test("local-like server workspace imports unscoped workspace data", () => {
    const legacyStorage = persistTesting.workspaceStorage("/repo")
    const currentStorage = persistTesting.serverWorkspaceStorage({ key: "local", legacy: true }, "/repo")
    storage.setItem(`${legacyStorage}:workspace:prompt`, '{"value":"legacy"}')

    createRoot((dispose) => {
      const [state] = persistMod.persisted(
        persistMod.Persist.serverWorkspace({ key: "local", legacy: true }, "/repo", "prompt"),
        createStore({ value: "default" }),
      )

      expect(state.value).toBe("legacy")
      expect(storage.getItem(`${currentStorage}:workspace:prompt`)).toBe('{"value":"legacy"}')
      expect(storage.getItem(`${legacyStorage}:workspace:prompt`)).toBeNull()
      dispose()
    })
  })

  test("remote server workspace does not import unscoped workspace data", () => {
    const legacyStorage = persistTesting.workspaceStorage("/repo")
    const currentStorage = persistTesting.serverWorkspaceStorage({ key: "https://remote.example.com" }, "/repo")
    storage.setItem(`${legacyStorage}:workspace:prompt`, '{"value":"legacy"}')

    createRoot((dispose) => {
      const [state] = persistMod.persisted(
        persistMod.Persist.serverWorkspace({ key: "https://remote.example.com" }, "/repo", "prompt"),
        createStore({ value: "default" }),
      )

      expect(state.value).toBe("default")
      expect(storage.getItem(`${currentStorage}:workspace:prompt`)).toBeNull()
      expect(storage.getItem(`${legacyStorage}:workspace:prompt`)).toBe('{"value":"legacy"}')
      dispose()
    })
  })
})
