import { describe, expect, test } from "bun:test"
import {
  createLocalInstanceManager,
  findListeningPort,
  resolveLocalTarget,
  type LocalInstanceManager,
} from "../src/main/local-instance"

describe("desktop local-instance re-exports", () => {
  test("findListeningPort is the shared implementation (not undefined)", () => {
    expect(typeof findListeningPort).toBe("function")
  })

  test("createLocalInstanceManager is exported", () => {
    expect(typeof createLocalInstanceManager).toBe("function")
  })

  test("resolveLocalTarget is exported", () => {
    expect(typeof resolveLocalTarget).toBe("function")
  })
})

describe("findListeningPort - all wording variants", () => {
  const cases: Array<[string, number | undefined]> = [
    ["", undefined],
    ["nothing here", undefined],
    ["random log line\n", undefined],
    ["listening on http://127.0.0.1:1234\n", 1234],
    ["listening on https://0.0.0.0:443", 443],
    ["Listening on http://localhost:8080", 8080],
    ["LISTENING ON http://127.0.0.1:1234", 1234],
    ["listening on HTTP://127.0.0.1:1234", 1234],
    ["listening at http://127.0.0.1:9999", 9999],
    ["Listening at https://0.0.0.0:65500", 65500],
    ["server started on http://127.0.0.1:5000", 5000],
    ["server started at http://127.0.0.1:5000", 5000],
    ["Server Started On https://example.com:1234", 1234],
    ["server ready on http://127.0.0.1:7777", 7777],
    ["server ready at https://localhost:7777", 7777],
    ["listening on http://127.0.0.1:1\n", 1],
    ["listening on http://127.0.0.1:65535\n", 65535],
    ["prefix\nlistening on http://127.0.0.1:4321\nsuffix", 4321],
    ["multi-line\nlistening on http://localhost:42\nmore lines", 42],
    // IPv6 hosts contain `:` in the bracket form, so the regex doesn't match — that's by design.
    ["listening on http://[::1]:8080", undefined],
    // Negative cases
    ["just listening", undefined],
    ["http://127.0.0.1:1234", undefined],
    ["server is up at port 1234", undefined],
    ["listening on : (no port)", undefined],
    ["listening on http://127.0.0.1:abc", undefined],
    ["listening on http://127.0.0.1:0", undefined],
    ["listening on http://127.0.0.1:-1", undefined],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [input, expected] = cases[i]
    test(`findListeningPort ${i}: ${JSON.stringify(input.slice(0, 40))}`, () => {
      expect(findListeningPort(input)).toBe(expected)
    })
  }

  test("returns first matching port even if multiple lines exist", () => {
    const text = "listening on http://127.0.0.1:1000\nlistening on http://127.0.0.1:2000"
    expect(findListeningPort(text)).toBe(1000)
  })

  test("works on long buffer with port at the end", () => {
    const padding = "x".repeat(10_000) + "\n"
    expect(findListeningPort(padding + "listening on http://127.0.0.1:5555")).toBe(5555)
  })

  test("works for fragment patterns mid-line", () => {
    expect(findListeningPort("starting up... listening on http://127.0.0.1:9090 ...ready"))
      .toBe(9090)
  })
})

describe("resolveLocalTarget - shape", () => {
  test("returns a target object with the expected fields", () => {
    const t = resolveLocalTarget()
    expect(typeof t.archiveName).toBe("string")
    expect(typeof t.archiveExt).toBe("string")
    expect(typeof t.binaryName).toBe("string")
    expect(typeof t.os).toBe("string")
    expect(typeof t.arch).toBe("string")
    expect(typeof t.packageName).toBe("string")
  })

  test("os is one of darwin/linux/windows", () => {
    expect(["darwin", "linux", "windows"]).toContain(resolveLocalTarget().os)
  })

  test("arch is one of x64/arm64", () => {
    expect(["x64", "arm64"]).toContain(resolveLocalTarget().arch)
  })

  test("archiveExt is .tgz", () => {
    expect(resolveLocalTarget().archiveExt).toBe(".tgz")
  })

  test("archiveName ends with .tgz", () => {
    expect(resolveLocalTarget().archiveName).toMatch(/\.tgz$/)
  })

  test("binaryName matches platform", () => {
    const t = resolveLocalTarget()
    if (t.os === "windows") expect(t.binaryName).toBe("codeplane.exe")
    else expect(t.binaryName).toBe("codeplane")
  })

  test("packageName starts with codeplane-", () => {
    expect(resolveLocalTarget().packageName).toMatch(/^codeplane-/)
  })

  test("packageName includes os and arch", () => {
    const t = resolveLocalTarget()
    expect(t.packageName).toContain(t.os)
    expect(t.packageName).toContain(t.arch)
  })

  test("archiveName equals packageName + .tgz", () => {
    const t = resolveLocalTarget()
    expect(t.archiveName).toBe(`${t.packageName}.tgz`)
  })

  test("repeated calls are stable", () => {
    const a = resolveLocalTarget()
    const b = resolveLocalTarget()
    expect(a).toEqual(b)
  })
})

describe("createLocalInstanceManager - manager surface", () => {
  test("returns the expected method set", () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    const manager: LocalInstanceManager = m
    expect(typeof manager.download).toBe("function")
    expect(typeof manager.start).toBe("function")
    expect(typeof manager.stop).toBe("function")
    expect(typeof manager.stopAll).toBe("function")
    expect(typeof manager.restart).toBe("function")
    expect(typeof manager.isInstalled).toBe("function")
    expect(typeof manager.isRunning).toBe("function")
    expect(typeof manager.getRunning).toBe("function")
    expect(typeof manager.listRunning).toBe("function")
    expect(typeof manager.removeData).toBe("function")
    expect(typeof manager.uninstall).toBe("function")
    expect(typeof manager.status).toBe("function")
    expect(typeof manager.resolveTarget).toBe("function")
    expect(manager.target).toBeDefined()
  })

  test("isRunning returns false for unknown ids", () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    expect(m.isRunning("never-started")).toBe(false)
    expect(m.isRunning("")).toBe(false)
    expect(m.isRunning("anything-id-12345")).toBe(false)
  })

  test("getRunning returns undefined for unknown ids", () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    expect(m.getRunning("never")).toBeUndefined()
    expect(m.getRunning("")).toBeUndefined()
  })

  test("listRunning returns an empty array initially", () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    expect(m.listRunning()).toEqual([])
  })

  test("isInstalled returns false when no binary exists", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries-nonexistent-9999",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    expect(await m.isInstalled("99.0.0")).toBe(false)
  })

  test("status reports installed=false when binary missing", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries-nonexistent-9999",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    const s = await m.status("99.0.0")
    expect(s.installed).toBe(false)
    expect(s.binaryVersion).toBe("99.0.0")
    expect(typeof s.binaryPath).toBe("string")
    expect(typeof s.archive).toBe("string")
  })

  test("stopAll on a fresh manager is a no-op", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    await expect(m.stopAll()).resolves.toBeUndefined()
  })

  test("stop on unknown id is a no-op", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    await expect(m.stop("ghost")).resolves.toBeUndefined()
  })

  test("removeData of a nonexistent id is a no-op", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-removeData-data-xyz",
    })
    await expect(m.removeData("ghost")).resolves.toBeUndefined()
  })

  test("uninstall of nonexistent version is a no-op", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-uninstall-bin",
      configDir: "/tmp/codeplane-test-uninstall-cfg",
      dataDir: "/tmp/codeplane-test-uninstall-data",
    })
    await expect(m.uninstall("0.0.0")).resolves.toBeUndefined()
  })

  test("resolveTarget returns the same shape as resolveLocalTarget", async () => {
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
    })
    const a = await m.resolveTarget()
    const b = resolveLocalTarget()
    expect(a).toEqual(b)
  })

  test("log callback is invoked at expected moments (stop on missing id)", async () => {
    const events: string[] = []
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-binaries",
      configDir: "/tmp/codeplane-test-config",
      dataDir: "/tmp/codeplane-test-data",
      log: (event) => events.push(event),
    })
    await m.stopAll()
    // stopAll always logs.
    expect(events).toContain("local.stopAll")
  })

  test("uninstall logs once", async () => {
    const events: string[] = []
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-uninstall-bin",
      configDir: "/tmp/codeplane-test-uninstall-cfg",
      dataDir: "/tmp/codeplane-test-uninstall-data",
      log: (event) => events.push(event),
    })
    await m.uninstall("99.0.0")
    expect(events.filter((e) => e === "local.uninstall")).toHaveLength(1)
  })

  test("removeData logs once", async () => {
    const events: string[] = []
    const m = createLocalInstanceManager({
      binariesDir: "/tmp/codeplane-test-removeData-bin",
      configDir: "/tmp/codeplane-test-removeData-cfg",
      dataDir: "/tmp/codeplane-test-removeData-data",
      log: (event) => events.push(event),
    })
    await m.removeData("ghost")
    expect(events.filter((e) => e === "local.remove-data")).toHaveLength(1)
  })
})
