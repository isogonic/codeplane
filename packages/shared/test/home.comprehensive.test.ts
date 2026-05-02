import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { CodeplaneHome, legacyPaths, paths } from "../src/home"

const env = {
  CODEPLANE_HOME_DIR: process.env.CODEPLANE_HOME_DIR,
  CODEPLANE_DATA_DIR: process.env.CODEPLANE_DATA_DIR,
  CODEPLANE_CACHE_DIR: process.env.CODEPLANE_CACHE_DIR,
  CODEPLANE_STATE_DIR: process.env.CODEPLANE_STATE_DIR,
  CODEPLANE_BIN_DIR: process.env.CODEPLANE_BIN_DIR,
  CODEPLANE_LOG_DIR: process.env.CODEPLANE_LOG_DIR,
  CODEPLANE_TEST_HOME: process.env.CODEPLANE_TEST_HOME,
}

beforeEach(() => {
  delete process.env.CODEPLANE_HOME_DIR
  delete process.env.CODEPLANE_DATA_DIR
  delete process.env.CODEPLANE_CACHE_DIR
  delete process.env.CODEPLANE_STATE_DIR
  delete process.env.CODEPLANE_BIN_DIR
  delete process.env.CODEPLANE_LOG_DIR
  delete process.env.CODEPLANE_TEST_HOME
})

afterEach(() => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe("CodeplaneHome.paths", () => {
  test("returns object with expected keys", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    const result = paths()
    expect(Object.keys(result).sort()).toEqual(
      [
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
      ].sort(),
    )
  })

  test("CODEPLANE_HOME_DIR sets root", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().root).toBe("/tmp/test-home")
  })

  test("CODEPLANE_HOME_DIR is resolved (absolute already)", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(path.isAbsolute(paths().root)).toBe(true)
  })

  test("data falls back to root/data", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().data).toBe("/tmp/test-home/data")
  })

  test("CODEPLANE_DATA_DIR overrides data", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_DATA_DIR = "/var/data"
    expect(paths().data).toBe("/var/data")
  })

  test("CODEPLANE_CACHE_DIR overrides cache", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_CACHE_DIR = "/var/cache"
    expect(paths().cache).toBe("/var/cache")
  })

  test("CODEPLANE_STATE_DIR overrides state", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_STATE_DIR = "/var/state"
    expect(paths().state).toBe("/var/state")
  })

  test("CODEPLANE_BIN_DIR overrides bin", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_BIN_DIR = "/var/bin"
    expect(paths().bin).toBe("/var/bin")
  })

  test("CODEPLANE_LOG_DIR overrides log", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_LOG_DIR = "/var/log"
    expect(paths().log).toBe("/var/log")
  })

  test("agents is root/agents", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().agents).toBe("/tmp/test-home/agents")
  })

  test("commands is root/commands", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().commands).toBe("/tmp/test-home/commands")
  })

  test("plugins is root/plugins", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().plugins).toBe("/tmp/test-home/plugins")
  })

  test("skills is root/skills", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().skills).toBe("/tmp/test-home/skills")
  })

  test("instances is root/instances.json", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().instances).toBe("/tmp/test-home/instances.json")
  })

  test("local_server is root/local_server", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().local_server).toBe("/tmp/test-home/local_server")
  })

  test("local_server_binaries is root/local_server/binaries", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().local_server_binaries).toBe("/tmp/test-home/local_server/binaries")
  })

  test("config equals root", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths().config).toBe("/tmp/test-home")
  })

  test("home equals process homedir or CODEPLANE_TEST_HOME", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    process.env.CODEPLANE_TEST_HOME = "/tmp/test-real-home"
    expect(paths().home).toBe("/tmp/test-real-home")
  })

  test("CODEPLANE_TEST_HOME affects defaultRoot when CODEPLANE_HOME_DIR not set", () => {
    process.env.CODEPLANE_TEST_HOME = "/tmp/x-test-home"
    const root = paths().root
    expect(root.startsWith("/tmp/x-test-home")).toBe(true)
  })

  test("trims whitespace around env values", () => {
    process.env.CODEPLANE_HOME_DIR = "  /tmp/trimmed  "
    expect(paths().root).toBe("/tmp/trimmed")
  })

  test("empty env value falls back to default", () => {
    process.env.CODEPLANE_HOME_DIR = "  "
    process.env.CODEPLANE_TEST_HOME = "/tmp/fallback-home"
    const root = paths().root
    expect(root.startsWith("/tmp/fallback-home")).toBe(true)
  })

  test("data, cache, state, bin, log are absolute paths", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    const p = paths()
    expect(path.isAbsolute(p.data)).toBe(true)
    expect(path.isAbsolute(p.cache)).toBe(true)
    expect(path.isAbsolute(p.state)).toBe(true)
    expect(path.isAbsolute(p.bin)).toBe(true)
    expect(path.isAbsolute(p.log)).toBe(true)
  })

  test("repeated calls return equal paths", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/test-home"
    expect(paths()).toEqual(paths())
  })

  test("CodeplaneHome.paths === paths function", () => {
    expect(CodeplaneHome.paths).toBe(paths)
  })

  test("CodeplaneHome.legacyPaths === legacyPaths function", () => {
    expect(CodeplaneHome.legacyPaths).toBe(legacyPaths)
  })

  if (process.platform === "darwin") {
    test("default root on macOS uses Library/Application Support", () => {
      process.env.CODEPLANE_TEST_HOME = "/tmp/macos-home"
      expect(paths().root).toBe("/tmp/macos-home/Library/Application Support/Codeplane")
    })
  }

  if (process.platform === "linux") {
    test("default root on Linux uses XDG_CONFIG_HOME or .config", () => {
      process.env.CODEPLANE_TEST_HOME = "/tmp/linux-home"
      const root = paths().root
      // Most CI environments don't set XDG_CONFIG_HOME; both fallbacks end with Codeplane.
      expect(root.endsWith("Codeplane")).toBe(true)
    })
  }
})

describe("legacyPaths", () => {
  test("returns object with expected keys", () => {
    const result = legacyPaths()
    expect(Object.keys(result).sort()).toEqual(["cache", "config", "data", "state"])
  })

  test("paths are absolute strings", () => {
    const result = legacyPaths()
    expect(path.isAbsolute(result.cache)).toBe(true)
    expect(path.isAbsolute(result.config)).toBe(true)
    expect(path.isAbsolute(result.data)).toBe(true)
    expect(path.isAbsolute(result.state)).toBe(true)
  })

  test("all paths end in 'codeplane' (lowercase)", () => {
    const result = legacyPaths()
    for (const value of Object.values(result)) {
      expect(value.endsWith("codeplane")).toBe(true)
    }
  })

  test("paths can be different from new paths()", () => {
    process.env.CODEPLANE_HOME_DIR = "/tmp/explicit-home"
    const newPaths = paths()
    const legacy = legacyPaths()
    // legacy uses XDG, which is independent of CODEPLANE_HOME_DIR.
    expect(legacy.config).not.toBe(newPaths.config)
  })

  test("repeated calls return equal paths", () => {
    expect(legacyPaths()).toEqual(legacyPaths())
  })
})
