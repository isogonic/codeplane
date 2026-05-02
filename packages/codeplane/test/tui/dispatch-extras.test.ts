import { describe, expect, test } from "bun:test"
import { resolveCliArgs } from "../../src/tui/dispatch"

describe("resolveCliArgs basic behavior", () => {
  test("returns help args unchanged", () => {
    expect(resolveCliArgs(["--help"])).toEqual(["--help"])
    expect(resolveCliArgs(["-h"])).toEqual(["-h"])
  })

  test("returns version args unchanged", () => {
    expect(resolveCliArgs(["--version"])).toEqual(["--version"])
    expect(resolveCliArgs(["-v"])).toEqual(["-v"])
  })

  test("returns subcommand args unchanged", () => {
    expect(resolveCliArgs(["serve", "--port", "8080"])).toEqual(["serve", "--port", "8080"])
  })

  test("prepends 'tui' when interactive and no subcommand", () => {
    expect(resolveCliArgs([], true)).toEqual(["tui"])
  })

  test("prepends 'web' when non-interactive and no subcommand", () => {
    expect(resolveCliArgs([], false)).toEqual(["web"])
  })

  test("prepends 'tui' even with global options", () => {
    expect(resolveCliArgs(["--pure"], true)).toEqual(["tui", "--pure"])
  })

  test("prepends 'web' with global options non-interactive", () => {
    expect(resolveCliArgs(["--print-logs"], false)).toEqual(["web", "--print-logs"])
  })

  test("--log-level skips next arg as value", () => {
    expect(resolveCliArgs(["--log-level", "debug"], true)).toEqual(["tui", "--log-level", "debug"])
  })

  test("after -- treats subsequent as args", () => {
    expect(resolveCliArgs(["--"], true)).toEqual(["tui", "--"])
  })

  test("dash-prefixed unknown options are skipped over", () => {
    expect(resolveCliArgs(["--unknown-flag"], true)).toEqual(["tui", "--unknown-flag"])
  })

  test("multiple global flags before subcommand", () => {
    expect(resolveCliArgs(["--pure", "--print-logs", "serve"])).toEqual([
      "--pure",
      "--print-logs",
      "serve",
    ])
  })

  test("help before subcommand returns unchanged", () => {
    expect(resolveCliArgs(["--help", "serve"])).toEqual(["--help", "serve"])
  })

  test("subcommand with positional after global value option", () => {
    expect(resolveCliArgs(["--log-level", "info", "serve"])).toEqual(["--log-level", "info", "serve"])
  })

  test("returns empty when no args and interactive", () => {
    expect(resolveCliArgs([], true)).toEqual(["tui"])
  })

  test("returns empty when no args and non-interactive", () => {
    expect(resolveCliArgs([], false)).toEqual(["web"])
  })

  test("subcommand 'tui' returns unchanged", () => {
    expect(resolveCliArgs(["tui"])).toEqual(["tui"])
  })

  test("subcommand 'web' returns unchanged", () => {
    expect(resolveCliArgs(["web"])).toEqual(["web"])
  })
})

describe("resolveCliArgs with -h shorthand", () => {
  test("-h alone passes through", () => {
    expect(resolveCliArgs(["-h"])).toEqual(["-h"])
  })

  test("-h with other args still passes through", () => {
    expect(resolveCliArgs(["-h", "--option"])).toEqual(["-h", "--option"])
  })
})

describe("resolveCliArgs with -v shorthand", () => {
  test("-v alone passes through", () => {
    expect(resolveCliArgs(["-v"])).toEqual(["-v"])
  })

  test("-v with other args still passes through", () => {
    expect(resolveCliArgs(["-v", "extra"])).toEqual(["-v", "extra"])
  })
})

describe("resolveCliArgs interactive default", () => {
  test("interactive default is correctly resolved", () => {
    const r = resolveCliArgs([])
    expect(["tui", "web"]).toContain(r[0])
  })
})
