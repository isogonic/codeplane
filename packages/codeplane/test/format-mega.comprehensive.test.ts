import { describe, expect, test } from "bun:test"
import { formatDuration } from "../src/util/format"

describe("formatDuration mega - seconds", () => {
  for (let s = 1; s < 60; s++) {
    test(`s=${s}`, () => expect(formatDuration(s)).toBe(`${s}s`))
  }
})

describe("formatDuration mega - minutes", () => {
  for (let m = 1; m < 60; m++) {
    test(`exactly ${m}m`, () => expect(formatDuration(m * 60)).toBe(`${m}m`))
  }
})

describe("formatDuration mega - minutes + seconds", () => {
  for (let m = 1; m < 30; m++) {
    for (let s = 1; s < 5; s++) {
      test(`${m}m ${s}s`, () =>
        expect(formatDuration(m * 60 + s)).toBe(`${m}m ${s}s`))
    }
  }
})

describe("formatDuration mega - hours", () => {
  for (let h = 1; h < 24; h++) {
    test(`exactly ${h}h`, () => expect(formatDuration(h * 3600)).toBe(`${h}h`))
  }
})

describe("formatDuration mega - hours + minutes", () => {
  for (let h = 1; h < 12; h++) {
    for (let m = 1; m < 5; m++) {
      test(`${h}h ${m}m`, () =>
        expect(formatDuration(h * 3600 + m * 60)).toBe(`${h}h ${m}m`))
    }
  }
})

describe("formatDuration mega - days", () => {
  for (let d = 2; d < 7; d++) {
    test(`${d} days`, () => expect(formatDuration(d * 86400)).toBe(`~${d} days`))
  }
})

describe("formatDuration mega - weeks", () => {
  for (let w = 2; w <= 10; w++) {
    test(`${w} weeks`, () => expect(formatDuration(w * 604800)).toBe(`~${w} weeks`))
  }
})

describe("formatDuration mega - zero/negative", () => {
  for (let i = 0; i < 30; i++) {
    test(`negative ${-i} returns empty`, () => expect(formatDuration(-i)).toBe(""))
  }
})
