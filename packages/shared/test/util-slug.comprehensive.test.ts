import { describe, expect, test } from "bun:test"
import { Slug } from "../src/util/slug"

describe("Slug.create", () => {
  test("returns a string", () => {
    expect(typeof Slug.create()).toBe("string")
  })
  test("contains a single dash", () => {
    expect(Slug.create().split("-")).toHaveLength(2)
  })
  test("uses lower-case adjective and noun", () => {
    const slug = Slug.create()
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
  })
  test("first part is from adjective list", () => {
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
    for (let i = 0; i < 30; i++) {
      const [adj] = Slug.create().split("-")
      expect(adjectives.has(adj!)).toBe(true)
    }
  })
  test("second part is from noun list", () => {
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
    for (let i = 0; i < 30; i++) {
      const noun = Slug.create().split("-")[1]
      expect(nouns.has(noun!)).toBe(true)
    }
  })
  for (let i = 0; i < 100; i++) {
    test(`bulk slug shape #${i}`, () => {
      const slug = Slug.create()
      expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
      expect(slug.length).toBeGreaterThan(3)
    })
  }
})
