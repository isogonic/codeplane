import { describe, expect, test } from "bun:test"
import { resolveCliArgs } from "../../src/tui/dispatch"

describe("tui.dispatch", () => {
  test("routes bare interactive invocation to the TUI", () => {
    expect(resolveCliArgs([], true)).toEqual(["tui"])
  })

  test("routes bare non-interactive invocation to the web server", () => {
    expect(resolveCliArgs([], false)).toEqual(["web"])
  })

  test("preserves explicit subcommands", () => {
    expect(resolveCliArgs(["web"], true)).toEqual(["web"])
    expect(resolveCliArgs(["run", "hello"], true)).toEqual(["run", "hello"])
  })

  test("keeps help and version requests unchanged", () => {
    expect(resolveCliArgs(["--help"], true)).toEqual(["--help"])
    expect(resolveCliArgs(["-v"], true)).toEqual(["-v"])
  })

  test("routes bare global flags through the default command", () => {
    expect(resolveCliArgs(["--print-logs"], true)).toEqual(["tui", "--print-logs"])
    expect(resolveCliArgs(["--log-level", "DEBUG"], false)).toEqual(["web", "--log-level", "DEBUG"])
  })

  test("routes bare session shortcut to the TUI", () => {
    expect(resolveCliArgs(["-s", "ses_abc"], true)).toEqual(["tui", "-s", "ses_abc"])
    expect(resolveCliArgs(["--session", "ses_abc"], false)).toEqual(["tui", "--session", "ses_abc"])
  })

  test("routes bare instance session shortcut to the TUI", () => {
    expect(resolveCliArgs(["--instance", "local", "-s", "ses_abc"], false)).toEqual([
      "tui",
      "--instance",
      "local",
      "-s",
      "ses_abc",
    ])
  })
})
