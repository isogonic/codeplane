import { describe, expect, test } from "bun:test"
import { Wildcard } from "../src/util"

describe("Wildcard.match extreme - every char", () => {
  for (let c = 65; c <= 122; c++) {
    const ch = String.fromCharCode(c)
    test(`exact ${ch}`, () => expect(Wildcard.match(ch, ch)).toBe(true))
    test(`star matches ${ch}`, () => expect(Wildcard.match(ch, "*")).toBe(true))
    test(`? matches ${ch}`, () => expect(Wildcard.match(ch, "?")).toBe(true))
  }
})

describe("Wildcard.match extreme - prefix matching", () => {
  for (const prefix of ["foo", "bar", "baz", "qux", "git", "npm", "ls", "cat"]) {
    for (let i = 0; i < 20; i++) {
      test(`${prefix}* matches ${prefix}-${i}`, () =>
        expect(Wildcard.match(`${prefix}-${i}`, `${prefix}*`)).toBe(true))
      test(`${prefix}* doesn't match other-${i}`, () =>
        expect(Wildcard.match(`other-${i}`, `${prefix}*`)).toBe(false))
    }
  }
})

describe("Wildcard.match extreme - suffix matching", () => {
  for (const suffix of [".txt", ".ts", ".js", ".json", ".yaml", ".md"]) {
    for (let i = 0; i < 20; i++) {
      test(`*${suffix} matches file${i}${suffix}`, () =>
        expect(Wildcard.match(`file${i}${suffix}`, `*${suffix}`)).toBe(true))
      test(`*${suffix} doesn't match file${i}.bin`, () =>
        expect(Wildcard.match(`file${i}.bin`, `*${suffix}`)).toBe(false))
    }
  }
})

describe("Wildcard.all extreme", () => {
  for (let i = 0; i < 100; i++) {
    test(`dispatch on key-${i}`, () => {
      const out = Wildcard.all(`key-${i}`, { [`key-${i}`]: i })
      expect(out).toBe(i)
    })
  }
})

describe("Wildcard.allStructured extreme", () => {
  for (let i = 0; i < 100; i++) {
    test(`dispatch head ${i}`, () => {
      const out = Wildcard.allStructured(
        { head: `git`, tail: [`tag-${i}`] },
        { [`git tag-${i}`]: `v${i}` },
      )
      expect(out).toBe(`v${i}`)
    })
  }
})
