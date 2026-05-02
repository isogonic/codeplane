import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { CodeplaneHome, paths, legacyPaths } from "../../src/home"

const keys = [
  "CODEPLANE_HOME_DIR",
  "CODEPLANE_DATA_DIR",
  "CODEPLANE_CACHE_DIR",
  "CODEPLANE_STATE_DIR",
  "CODEPLANE_BIN_DIR",
  "CODEPLANE_LOG_DIR",
  "CODEPLANE_TEST_HOME",
] as const

const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("CodeplaneHome.paths additional fields", () => {
  test("agents path is under root", () => {
    const root = path.join(os.tmpdir(), "Codeplane")
    process.env.CODEPLANE_HOME_DIR = root
    const r = CodeplaneHome.paths()
    expect(r.agents).toBe(path.join(path.resolve(root), "agents"))
  })

  test("commands path is under root", () => {
    const root = path.join(os.tmpdir(), "Codeplane")
    process.env.CODEPLANE_HOME_DIR = root
    const r = CodeplaneHome.paths()
    expect(r.commands).toBe(path.join(path.resolve(root), "commands"))
  })

  test("returns absolute paths", () => {
    const root = path.join(os.tmpdir(), "rel/path")
    process.env.CODEPLANE_HOME_DIR = root
    const r = CodeplaneHome.paths()
    expect(path.isAbsolute(r.root)).toBe(true)
    expect(path.isAbsolute(r.data)).toBe(true)
    expect(path.isAbsolute(r.cache)).toBe(true)
    expect(path.isAbsolute(r.state)).toBe(true)
    expect(path.isAbsolute(r.bin)).toBe(true)
    expect(path.isAbsolute(r.log)).toBe(true)
  })

  test("trims whitespace from env override values", () => {
    const root = "  " + path.join(os.tmpdir(), "trimmed") + "  "
    process.env.CODEPLANE_HOME_DIR = root
    const r = CodeplaneHome.paths()
    expect(r.root.includes(" ")).toBe(false)
  })

  test("treats empty env override as unset", () => {
    process.env.CODEPLANE_HOME_DIR = "   "
    const r = CodeplaneHome.paths()
    expect(r.root.length).toBeGreaterThan(0)
  })

  test("returned object has expected keys", () => {
    process.env.CODEPLANE_HOME_DIR = path.join(os.tmpdir(), "x")
    const r = CodeplaneHome.paths()
    const expected = [
      "agents",
      "bin",
      "cache",
      "commands",
      "config",
      "data",
      "home",
      "instances",
      "local_server",
      "local_server_binaries",
      "log",
      "plugins",
      "root",
      "skills",
      "state",
    ]
    for (const k of expected) {
      expect(k in r).toBe(true)
    }
  })

  test("legacyPaths returns object with expected keys", () => {
    const r = legacyPaths()
    expect(typeof r.cache).toBe("string")
    expect(typeof r.config).toBe("string")
    expect(typeof r.data).toBe("string")
    expect(typeof r.state).toBe("string")
  })

  test("legacyPaths uses 'codeplane' suffix lowercase", () => {
    const r = legacyPaths()
    expect(r.cache.toLowerCase().endsWith("codeplane")).toBe(true)
  })

  test("CODEPLANE_TEST_HOME overrides home", () => {
    const tmp = path.join(os.tmpdir(), "test-home")
    process.env.CODEPLANE_TEST_HOME = tmp
    delete process.env.CODEPLANE_HOME_DIR
    const r = CodeplaneHome.paths()
    expect(r.home).toBe(tmp)
  })

  test("data defaults to root/data when no override", () => {
    const root = path.join(os.tmpdir(), "abc-test")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_DATA_DIR
    expect(CodeplaneHome.paths().data).toBe(path.join(path.resolve(root), "data"))
  })

  test("cache defaults to root/cache when no override", () => {
    const root = path.join(os.tmpdir(), "abc-test")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_CACHE_DIR
    expect(CodeplaneHome.paths().cache).toBe(path.join(path.resolve(root), "cache"))
  })

  test("state defaults to root/state when no override", () => {
    const root = path.join(os.tmpdir(), "abc-test")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_STATE_DIR
    expect(CodeplaneHome.paths().state).toBe(path.join(path.resolve(root), "state"))
  })

  test("bin defaults to root/bin when no override", () => {
    const root = path.join(os.tmpdir(), "abc-test")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_BIN_DIR
    expect(CodeplaneHome.paths().bin).toBe(path.join(path.resolve(root), "bin"))
  })

  test("log defaults to root/log when no override", () => {
    const root = path.join(os.tmpdir(), "abc-test")
    process.env.CODEPLANE_HOME_DIR = root
    delete process.env.CODEPLANE_LOG_DIR
    expect(CodeplaneHome.paths().log).toBe(path.join(path.resolve(root), "log"))
  })

  test("paths === CodeplaneHome.paths", () => {
    expect(paths).toBe(CodeplaneHome.paths)
  })

  test("legacyPaths === CodeplaneHome.legacyPaths", () => {
    expect(legacyPaths).toBe(CodeplaneHome.legacyPaths)
  })
})
