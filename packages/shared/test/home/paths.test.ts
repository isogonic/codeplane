import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import { CodeplaneHome } from "../../src/home"

const keys = [
  "CODEPLANE_HOME_DIR",
  "CODEPLANE_DATA_DIR",
  "CODEPLANE_CACHE_DIR",
  "CODEPLANE_STATE_DIR",
  "CODEPLANE_BIN_DIR",
  "CODEPLANE_LOG_DIR",
  "CODEPLANE_GLOBAL_HOME_DIR",
] as const

const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

beforeEach(() => {
  for (const key of keys) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of keys) {
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("CodeplaneHome.paths", () => {
  test("derives all shared paths from a single Codeplane root", () => {
    const root = path.join(process.cwd(), "tmp", "Codeplane Root")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_DATA_DIR
    delete process.env.CODEPLANE_CACHE_DIR
    delete process.env.CODEPLANE_STATE_DIR
    delete process.env.CODEPLANE_BIN_DIR
    delete process.env.CODEPLANE_LOG_DIR

    const result = CodeplaneHome.paths()

    expect(result.root).toBe(path.resolve(root))
    expect(result.config).toBe(path.resolve(root))
    expect(result.instances).toBe(path.join(path.resolve(root), "instances.json"))
    expect(result.local_server).toBe(path.join(path.resolve(root), "local_server"))
    expect(result.local_server_binaries).toBe(path.join(path.resolve(root), "local_server", "binaries"))
    expect(result.skills).toBe(path.join(path.resolve(root), "skills"))
    expect(result.plugins).toBe(path.join(path.resolve(root), "plugins"))
  })

  test("respects per-process runtime directory overrides", () => {
    const root = path.join(process.cwd(), "tmp", "Codeplane Root")
    process.env.CODEPLANE_HOME_DIR = root
    process.env.CODEPLANE_DATA_DIR = path.join(root, "runtime-data")
    process.env.CODEPLANE_CACHE_DIR = path.join(root, "runtime-cache")
    process.env.CODEPLANE_STATE_DIR = path.join(root, "runtime-state")
    process.env.CODEPLANE_BIN_DIR = path.join(root, "runtime-bin")
    process.env.CODEPLANE_LOG_DIR = path.join(root, "runtime-log")

    const result = CodeplaneHome.paths()

    expect(result.data).toBe(path.resolve(path.join(root, "runtime-data")))
    expect(result.cache).toBe(path.resolve(path.join(root, "runtime-cache")))
    expect(result.state).toBe(path.resolve(path.join(root, "runtime-state")))
    expect(result.bin).toBe(path.resolve(path.join(root, "runtime-bin")))
    expect(result.log).toBe(path.resolve(path.join(root, "runtime-log")))
    expect(result.config).toBe(path.resolve(root))
  })
})

