import { describe, expect, test } from "bun:test"
import { Wildcard } from "../src/util"

describe("Wildcard.match mega - star patterns", () => {
  for (let i = 0; i < 100; i++) {
    test(`star matches "value-${i}"`, () =>
      expect(Wildcard.match(`value-${i}`, "*")).toBe(true))
  }
  for (let i = 0; i < 100; i++) {
    test(`prefix star matches "x${i}"`, () =>
      expect(Wildcard.match(`prefix-${i}`, "prefix-*")).toBe(true))
  }
  for (let i = 0; i < 100; i++) {
    test(`suffix star matches "${i}-suffix"`, () =>
      expect(Wildcard.match(`${i}-suffix`, "*-suffix")).toBe(true))
  }
})

describe("Wildcard.match mega - exact patterns", () => {
  for (let i = 0; i < 100; i++) {
    test(`exact "${i}"`, () => expect(Wildcard.match(`${i}`, `${i}`)).toBe(true))
  }
})

describe("Wildcard.match mega - extension patterns", () => {
  const exts = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "cpp", "h"]
  for (const ext of exts) {
    for (let i = 0; i < 30; i++) {
      test(`*.${ext} matches file${i}.${ext}`, () =>
        expect(Wildcard.match(`file${i}.${ext}`, `*.${ext}`)).toBe(true))
      test(`*.${ext} does not match file${i}.other`, () =>
        expect(Wildcard.match(`file${i}.other`, `*.${ext}`)).toBe(false))
    }
  }
})

describe("Wildcard.match mega - command patterns", () => {
  const cmds = ["ls", "cat", "grep", "git", "npm", "docker"]
  for (const cmd of cmds) {
    for (let i = 0; i < 20; i++) {
      test(`${cmd} * matches "${cmd} -arg${i}"`, () =>
        expect(Wildcard.match(`${cmd} -arg${i}`, `${cmd} *`)).toBe(true))
    }
  }
})

describe("Wildcard.all mega - dispatch tests", () => {
  for (let i = 0; i < 50; i++) {
    test(`dispatch by exact #${i}`, () => {
      const out = Wildcard.all(`key-${i}`, { [`key-${i}`]: i, "*": -1 })
      expect(out).toBe(i)
    })
  }
})

describe("Wildcard.allStructured mega", () => {
  for (let i = 0; i < 50; i++) {
    test(`head dispatch #${i}`, () => {
      const out = Wildcard.allStructured(
        { head: `head-${i}`, tail: [] },
        { [`head-${i}`]: `R-${i}` },
      )
      expect(out).toBe(`R-${i}`)
    })
  }
})
