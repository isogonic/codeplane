import { describe, expect, test } from "bun:test"
import { formatDuration } from "../src/util/format"

describe("formatDuration extreme - 1-3600 seconds", () => {
  for (let s = 1; s < 60; s++) {
    test(`s=${s}`, () => expect(formatDuration(s)).toBe(`${s}s`))
  }
  for (let s = 60; s < 3600; s += 5) {
    test(`s=${s} contains m`, () => expect(formatDuration(s)).toContain("m"))
  }
})

describe("formatDuration extreme - 1-100 hours", () => {
  for (let h = 1; h < 24; h++) {
    test(`h=${h}`, () => expect(formatDuration(h * 3600)).toBe(`${h}h`))
  }
})

describe("formatDuration extreme - many days", () => {
  for (let d = 2; d < 7; d++) {
    test(`d=${d}`, () => expect(formatDuration(d * 86400)).toBe(`~${d} days`))
  }
})

describe("formatDuration extreme - many weeks", () => {
  for (let w = 2; w <= 30; w++) {
    test(`w=${w}`, () => expect(formatDuration(w * 604800)).toBe(`~${w} weeks`))
  }
})

describe("formatDuration extreme - exact minutes", () => {
  for (let m = 1; m <= 59; m++) {
    test(`exactly ${m}m`, () => expect(formatDuration(m * 60)).toBe(`${m}m`))
  }
})

describe("formatDuration extreme - mixed minute+second values", () => {
  for (let m = 1; m <= 30; m++) {
    for (let s = 1; s <= 5; s++) {
      test(`${m}m ${s}s`, () =>
        expect(formatDuration(m * 60 + s)).toBe(`${m}m ${s}s`))
    }
  }
})

describe("formatDuration extreme - mixed hour+minute values", () => {
  for (let h = 1; h <= 12; h++) {
    for (let m = 1; m <= 5; m++) {
      test(`${h}h ${m}m`, () =>
        expect(formatDuration(h * 3600 + m * 60)).toBe(`${h}h ${m}m`))
    }
  }
})
