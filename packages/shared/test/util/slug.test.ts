import { describe, expect, test } from "bun:test"
import { Slug } from "../../src/util/slug"

describe("Slug.create", () => {
  test("returns a string", () => {
    expect(typeof Slug.create()).toBe("string")
  })

  test("contains a hyphen separator", () => {
    expect(Slug.create()).toContain("-")
  })

  test("has exactly two parts joined by dash", () => {
    const parts = Slug.create().split("-")
    expect(parts.length).toBe(2)
  })

  test("first part is lowercase", () => {
    const [adj] = Slug.create().split("-")
    expect(adj).toBe(adj.toLowerCase())
  })

  test("second part is lowercase", () => {
    const [, noun] = Slug.create().split("-")
    expect(noun).toBe(noun.toLowerCase())
  })

  test("only contains a-z", () => {
    expect(Slug.create()).toMatch(/^[a-z]+-[a-z]+$/)
  })

  test("repeated calls produce slugs of same shape", () => {
    for (let i = 0; i < 50; i++) {
      expect(Slug.create()).toMatch(/^[a-z]+-[a-z]+$/)
    }
  })

  test("known adjectives appear in output", () => {
    const adjectives = new Set([
      "brave",
      "calm",
      "clever",
      "cosmic",
      "crisp",
      "curious",
      "eager",
      "gentle",
      "glowing",
      "happy",
      "hidden",
      "jolly",
      "kind",
      "lucky",
      "mighty",
      "misty",
      "neon",
      "nimble",
      "playful",
      "proud",
      "quick",
      "quiet",
      "shiny",
      "silent",
      "stellar",
      "sunny",
      "swift",
      "tidy",
      "witty",
    ])
    for (let i = 0; i < 100; i++) {
      const [adj] = Slug.create().split("-")
      expect(adjectives.has(adj)).toBe(true)
    }
  })

  test("known nouns appear in output", () => {
    const nouns = new Set([
      "cabin",
      "cactus",
      "canyon",
      "circuit",
      "comet",
      "eagle",
      "engine",
      "falcon",
      "forest",
      "garden",
      "harbor",
      "island",
      "knight",
      "lagoon",
      "meadow",
      "moon",
      "mountain",
      "nebula",
      "orchid",
      "otter",
      "panda",
      "pixel",
      "planet",
      "river",
      "rocket",
      "sailor",
      "squid",
      "star",
      "tiger",
      "wizard",
      "wolf",
    ])
    for (let i = 0; i < 100; i++) {
      const [, noun] = Slug.create().split("-")
      expect(nouns.has(noun)).toBe(true)
    }
  })

  test("over many runs produces variety", () => {
    const results = new Set<string>()
    for (let i = 0; i < 200; i++) {
      results.add(Slug.create())
    }
    expect(results.size).toBeGreaterThan(10)
  })
})
