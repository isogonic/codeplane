import { describe, expect, test } from "bun:test"
import { Wildcard } from "../src/util"

describe("Wildcard.match - exact patterns", () => {
  test("exact string matches itself", () => expect(Wildcard.match("hello", "hello")).toBe(true))
  test("different strings do not match", () =>
    expect(Wildcard.match("hello", "world")).toBe(false))
  test("empty pattern matches empty", () => expect(Wildcard.match("", "")).toBe(true))
  test("empty pattern does not match non-empty", () =>
    expect(Wildcard.match("a", "")).toBe(false))
  test("longer string than pattern", () =>
    expect(Wildcard.match("hello world", "hello")).toBe(false))
})

describe("Wildcard.match - star wildcard", () => {
  test("star matches anything", () => expect(Wildcard.match("anything", "*")).toBe(true))
  test("star matches empty", () => expect(Wildcard.match("", "*")).toBe(true))
  test("star prefix", () =>
    expect(Wildcard.match("xfoo", "*foo")).toBe(true))
  test("star suffix", () =>
    expect(Wildcard.match("foox", "foo*")).toBe(true))
  test("star middle", () =>
    expect(Wildcard.match("fooxbar", "foo*bar")).toBe(true))
  test("multiple stars", () =>
    expect(Wildcard.match("foobarbaz", "*bar*")).toBe(true))
  test("star does not match across separators", () =>
    expect(Wildcard.match("file.txt", "*.txt")).toBe(true))
  test("star wildcard mid path", () =>
    expect(Wildcard.match("a/b/c", "a/*/c")).toBe(true))
})

describe("Wildcard.match - question mark", () => {
  test("? matches single char", () => expect(Wildcard.match("a", "?")).toBe(true))
  test("? does not match empty", () => expect(Wildcard.match("", "?")).toBe(false))
  test("? does not match two chars", () => expect(Wildcard.match("ab", "?")).toBe(false))
  test("? in middle", () => expect(Wildcard.match("abc", "a?c")).toBe(true))
  test("multiple ?", () => expect(Wildcard.match("abc", "???")).toBe(true))
  test("?? matches exactly two", () =>
    expect(Wildcard.match("a", "??")).toBe(false))
})

describe("Wildcard.match - real-world patterns", () => {
  test("ls command", () => expect(Wildcard.match("ls", "ls *")).toBe(true))
  test("ls with args", () => expect(Wildcard.match("ls -la", "ls *")).toBe(true))
  test("git command prefix", () =>
    expect(Wildcard.match("git status", "git *")).toBe(true))
  test("file extension", () =>
    expect(Wildcard.match("file.test.ts", "*.test.ts")).toBe(true))
  test("path glob", () =>
    expect(Wildcard.match("src/utils/file.ts", "*ts")).toBe(true))
  test("npm command", () =>
    expect(Wildcard.match("npm run test", "npm *")).toBe(true))
  test("docker command", () =>
    expect(Wildcard.match("docker ps -a", "docker *")).toBe(true))
})

describe("Wildcard.match - cross-platform paths", () => {
  test("normalizes backslashes to slashes", () =>
    expect(Wildcard.match("a\\b\\c", "a/b/c")).toBe(true))
  test("forward slash matches forward slash", () =>
    expect(Wildcard.match("a/b/c", "a/b/c")).toBe(true))
  test("normalized in pattern too", () =>
    expect(Wildcard.match("a/b", "a\\b")).toBe(true))
})

describe("Wildcard.all", () => {
  test("returns matched value", () =>
    expect(Wildcard.all("foo", { foo: "bar" })).toBe("bar"))
  test("returns later match (sorted by length asc)", () =>
    expect(Wildcard.all("foo", { foo: 1, "*": 2 })).toBe(1))
  test("longer specific pattern wins", () =>
    expect(Wildcard.all("foobar", { "*": 1, foobar: 2 })).toBe(2))
  test("undefined when no match", () =>
    expect(Wildcard.all("foo", { bar: 1 })).toBeUndefined())
  test("returns matched value when no patterns conflict", () => {
    const result = Wildcard.all("fo1", { fo1: "a", fo2: "b" })
    expect(result).toBe("a")
  })
  test("works with empty patterns object", () =>
    expect(Wildcard.all("foo", {})).toBeUndefined())
  for (let i = 0; i < 20; i++) {
    test(`bulk Wildcard.all #${i}`, () => {
      const patterns = { [`pattern${i}`]: i, "*": "fallback" }
      expect(Wildcard.all(`pattern${i}`, patterns)).toBe(i)
    })
  }
})

describe("Wildcard.allStructured", () => {
  test("matches head only", () =>
    expect(Wildcard.allStructured({ head: "git", tail: [] }, { git: "OK" })).toBe("OK"))
  test("matches head with tail", () =>
    expect(
      Wildcard.allStructured({ head: "git", tail: ["push"] }, { "git push": "PUSH" }),
    ).toBe("PUSH"))
  test("does not match wrong head", () =>
    expect(Wildcard.allStructured({ head: "ls", tail: [] }, { git: "X" })).toBeUndefined())
  test("wildcard in head matches anything", () =>
    expect(Wildcard.allStructured({ head: "anything", tail: [] }, { "*": "any" })).toBe("any"))
  test("wildcard in tail allows skip", () =>
    expect(
      Wildcard.allStructured({ head: "git", tail: ["push", "origin"] }, { "git * origin": "go" }),
    ).toBe("go"))
})
