import { describe, expect, test } from "bun:test"
import { resolveCliArgs } from "../../src/tui/dispatch"

describe("resolveCliArgs - bare invocations", () => {
  const cases: Array<[string[], boolean, string[]]> = [
    [[], true, ["tui"]],
    [[], false, ["web"]],
  ]
  for (let i = 0; i < cases.length; i++) {
    const [args, interactive, expected] = cases[i]
    test(`bare ${i}: args=${JSON.stringify(args)} interactive=${interactive}`, () => {
      expect(resolveCliArgs(args, interactive)).toEqual(expected)
    })
  }
})

describe("resolveCliArgs - explicit subcommands stay untouched", () => {
  const subcommands = [
    "tui",
    "web",
    "run",
    "serve",
    "auth",
    "agent",
    "config",
    "init",
    "doctor",
    "version",
    "github",
    "stats",
    "bench",
  ]
  for (const cmd of subcommands) {
    test(`subcommand "${cmd}" interactive=true preserved`, () => {
      expect(resolveCliArgs([cmd], true)).toEqual([cmd])
    })
    test(`subcommand "${cmd}" interactive=false preserved`, () => {
      expect(resolveCliArgs([cmd], false)).toEqual([cmd])
    })
    test(`subcommand "${cmd}" with arg preserved`, () => {
      expect(resolveCliArgs([cmd, "abc"], true)).toEqual([cmd, "abc"])
    })
    test(`subcommand "${cmd}" with multiple args preserved`, () => {
      expect(resolveCliArgs([cmd, "a", "b", "c"], false)).toEqual([cmd, "a", "b", "c"])
    })
  }
})

describe("resolveCliArgs - help/version pass-through", () => {
  const helpAndVersion = ["-h", "--help", "-v", "--version"]
  for (const flag of helpAndVersion) {
    test(`flag "${flag}" interactive=true preserved`, () => {
      expect(resolveCliArgs([flag], true)).toEqual([flag])
    })
    test(`flag "${flag}" interactive=false preserved`, () => {
      expect(resolveCliArgs([flag], false)).toEqual([flag])
    })
    test(`flag "${flag}" with extra args preserved`, () => {
      expect(resolveCliArgs([flag, "extra"], true)).toEqual([flag, "extra"])
    })
    test(`flag "${flag}" mid-args still triggers display-only path`, () => {
      expect(resolveCliArgs(["--print-logs", flag], true)).toEqual(["--print-logs", flag])
    })
  }
})

describe("resolveCliArgs - global flag-only invocations", () => {
  const globalFlags = ["--print-logs", "--pure"]
  for (const flag of globalFlags) {
    test(`bare global flag "${flag}" interactive=true → tui`, () => {
      expect(resolveCliArgs([flag], true)).toEqual(["tui", flag])
    })
    test(`bare global flag "${flag}" interactive=false → web`, () => {
      expect(resolveCliArgs([flag], false)).toEqual(["web", flag])
    })
    test(`combo: --pure + --print-logs interactive=true → tui`, () => {
      expect(resolveCliArgs(["--pure", "--print-logs"], true)).toEqual(["tui", "--pure", "--print-logs"])
    })
    test(`combo: --print-logs + --pure interactive=false → web`, () => {
      expect(resolveCliArgs(["--print-logs", "--pure"], false)).toEqual([
        "web",
        "--print-logs",
        "--pure",
      ])
    })
  }
})

describe("resolveCliArgs - global value flags consume the next arg", () => {
  const valueArgs = ["DEBUG", "INFO", "WARN", "ERROR", "TRACE", "trace", "debug"]
  for (const v of valueArgs) {
    test(`--log-level ${v} interactive=true → tui`, () => {
      expect(resolveCliArgs(["--log-level", v], true)).toEqual(["tui", "--log-level", v])
    })
    test(`--log-level ${v} interactive=false → web`, () => {
      expect(resolveCliArgs(["--log-level", v], false)).toEqual(["web", "--log-level", v])
    })
  }

  test("non-flag value following --log-level is treated as its value, not subcommand", () => {
    // The arg after --log-level is consumed even if it doesn't start with -.
    expect(resolveCliArgs(["--log-level", "INFO"], true)).toEqual(["tui", "--log-level", "INFO"])
  })

  test("subcommand after --log-level value is preserved", () => {
    expect(resolveCliArgs(["--log-level", "INFO", "run"], true)).toEqual([
      "--log-level",
      "INFO",
      "run",
    ])
  })

  test("subcommand before --log-level still preserved", () => {
    expect(resolveCliArgs(["run", "--log-level", "INFO"], true)).toEqual([
      "run",
      "--log-level",
      "INFO",
    ])
  })
})

describe("resolveCliArgs - `--` separator", () => {
  test("bare -- (no subcommand before) is not a subcommand", () => {
    expect(resolveCliArgs(["--"], true)).toEqual(["tui", "--"])
  })

  test("bare -- non-interactive uses web", () => {
    expect(resolveCliArgs(["--"], false)).toEqual(["web", "--"])
  })

  test("global flag then -- still defaults", () => {
    expect(resolveCliArgs(["--print-logs", "--"], true)).toEqual(["tui", "--print-logs", "--"])
  })

  test("subcommand before -- is a subcommand", () => {
    expect(resolveCliArgs(["run", "--", "echo", "hi"], true)).toEqual(["run", "--", "echo", "hi"])
  })
})

describe("resolveCliArgs - unknown options are not subcommands", () => {
  const unknownFlags = ["--unknown", "--foo", "-x", "--no-color", "--verbose"]
  for (const f of unknownFlags) {
    test(`single unknown flag "${f}" interactive=true → tui`, () => {
      expect(resolveCliArgs([f], true)).toEqual(["tui", f])
    })
    test(`single unknown flag "${f}" interactive=false → web`, () => {
      expect(resolveCliArgs([f], false)).toEqual(["web", f])
    })
  }
})

describe("resolveCliArgs - arg ordering", () => {
  test("subcommand at start preserved", () => {
    expect(resolveCliArgs(["run", "--print-logs"], true)).toEqual(["run", "--print-logs"])
  })

  test("subcommand after global flags preserved", () => {
    expect(resolveCliArgs(["--print-logs", "run"], true)).toEqual(["--print-logs", "run"])
  })

  test("subcommand after global flag and value flag preserved", () => {
    expect(resolveCliArgs(["--print-logs", "--log-level", "INFO", "run"], true)).toEqual([
      "--print-logs",
      "--log-level",
      "INFO",
      "run",
    ])
  })
})

describe("resolveCliArgs - interactive defaults to TTY check", () => {
  // Just verify the function accepts no second arg without throwing.
  test("calling without explicit interactive is allowed", () => {
    const result = resolveCliArgs([], undefined as unknown as boolean)
    expect(Array.isArray(result)).toBe(true)
  })
})
