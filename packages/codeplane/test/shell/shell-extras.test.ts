import { describe, expect, test } from "bun:test"
import { Shell } from "../../src/shell/shell"

const isWin = process.platform === "win32"

describe("Shell.name extra", () => {
  test("returns lowercase", () => {
    if (!isWin) expect(Shell.name("/bin/BASH")).toBe("bash")
  })

  test("strips path", () => {
    if (!isWin) expect(Shell.name("/usr/local/bin/zsh")).toBe("zsh")
  })

  test("plain name unchanged (lowercased)", () => {
    if (!isWin) expect(Shell.name("FISH")).toBe("fish")
  })
})

describe("Shell.login recognition", () => {
  test("recognizes bash", () => {
    if (!isWin) expect(Shell.login("/bin/bash")).toBe(true)
  })

  test("recognizes zsh", () => {
    if (!isWin) expect(Shell.login("/bin/zsh")).toBe(true)
  })

  test("recognizes fish", () => {
    if (!isWin) expect(Shell.login("/bin/fish")).toBe(true)
  })

  test("recognizes ksh", () => {
    if (!isWin) expect(Shell.login("/bin/ksh")).toBe(true)
  })

  test("recognizes sh", () => {
    if (!isWin) expect(Shell.login("/bin/sh")).toBe(true)
  })

  test("recognizes dash", () => {
    if (!isWin) expect(Shell.login("/bin/dash")).toBe(true)
  })

  test("rejects unknown shell", () => {
    if (!isWin) expect(Shell.login("/bin/unknown")).toBe(false)
  })

  test("rejects nu", () => {
    if (!isWin) expect(Shell.login("/usr/local/bin/nu")).toBe(false)
  })
})

describe("Shell.posix recognition", () => {
  test("recognizes bash as posix", () => {
    if (!isWin) expect(Shell.posix("/bin/bash")).toBe(true)
  })

  test("recognizes ksh as posix", () => {
    if (!isWin) expect(Shell.posix("/bin/ksh")).toBe(true)
  })

  test("recognizes sh as posix", () => {
    if (!isWin) expect(Shell.posix("/bin/sh")).toBe(true)
  })

  test("recognizes dash as posix", () => {
    if (!isWin) expect(Shell.posix("/bin/dash")).toBe(true)
  })

  test("does not recognize fish as posix", () => {
    if (!isWin) expect(Shell.posix("/bin/fish")).toBe(false)
  })

  test("rejects unknown", () => {
    if (!isWin) expect(Shell.posix("/usr/bin/foobar")).toBe(false)
  })
})

describe("Shell.preferred / acceptable / gitbash", () => {
  test("preferred returns a string", () => {
    expect(typeof Shell.preferred()).toBe("string")
  })

  test("acceptable returns a string", () => {
    expect(typeof Shell.acceptable()).toBe("string")
  })

  test("gitbash returns undefined on non-windows", () => {
    if (!isWin) expect(Shell.gitbash()).toBeUndefined()
  })
})
