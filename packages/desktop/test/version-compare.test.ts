// The desktop main process has a tiny in-house compareVersions helper for
// the auto-updater. We can't import it directly because main.ts is bundled
// for Electron's main process, but the algorithm is small and we recreate
// it here to lock in the contract that the desktop relies on.
//
// If main.ts's compareVersions ever drifts, these tests stop matching the
// real behavior — keep this file in sync with the implementation.

import { describe, expect, test } from "bun:test"

function compareVersions(a: string, b: string) {
  const left = a
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  const right = b
    .trim()
    .replace(/^v/, "")
    .split(".")
    .map((value) => Number.parseInt(value, 10))
    .map((value) => (Number.isFinite(value) ? value : 0))
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const next = (left[i] ?? 0) - (right[i] ?? 0)
    if (next !== 0) return next
  }
  return 0
}

describe("desktop compareVersions - equal", () => {
  const equal = ["1.0.0", "27.4.2", "0.0.0", "100.200.300", "1.2.3"]
  for (const v of equal) {
    test(`${v} equals itself`, () => {
      expect(compareVersions(v, v)).toBe(0)
    })
  }

  test("v-prefix vs no v-prefix are equal", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0)
  })

  test("trimmed equals untrimmed", () => {
    expect(compareVersions("  1.2.3  ", "1.2.3")).toBe(0)
  })
})

describe("desktop compareVersions - greater", () => {
  const cases: Array<[string, string]> = [
    ["1.0.1", "1.0.0"],
    ["1.1.0", "1.0.0"],
    ["2.0.0", "1.0.0"],
    ["10.0.0", "9.0.0"],
    ["27.5.0", "27.4.2"],
    ["27.4.3", "27.4.2"],
    ["100.0.0", "99.99.99"],
    ["v2.0.0", "v1.0.0"],
    ["v1.0.0", "0.999.999"],
  ]
  for (const [a, b] of cases) {
    test(`${a} > ${b}`, () => {
      expect(compareVersions(a, b)).toBeGreaterThan(0)
    })
    test(`${b} < ${a}`, () => {
      expect(compareVersions(b, a)).toBeLessThan(0)
    })
  }
})

describe("desktop compareVersions - missing segments treated as 0", () => {
  test("1.0 == 1.0.0", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0)
  })
  test("1 == 1.0.0", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0)
  })
  test("1.0.0.0 == 1.0.0", () => {
    expect(compareVersions("1.0.0.0", "1.0.0")).toBe(0)
  })
  test("1.0.0.5 > 1.0.0", () => {
    expect(compareVersions("1.0.0.5", "1.0.0")).toBeGreaterThan(0)
  })
})

describe("desktop compareVersions - non-numeric segments treated as 0", () => {
  test("1.0.alpha == 1.0.0", () => {
    expect(compareVersions("1.0.alpha", "1.0.0")).toBe(0)
  })
  test("non-numeric across is 0.0.0", () => {
    expect(compareVersions("a.b.c", "0.0.0")).toBe(0)
  })
  test("partial numeric: 1.beta.0 == 1.0.0", () => {
    expect(compareVersions("1.beta.0", "1.0.0")).toBe(0)
  })
})

describe("desktop compareVersions - bulk patch comparisons", () => {
  for (let i = 0; i < 100; i++) {
    test(`bulk: 1.0.${i} cmp 1.0.0`, () => {
      const cmp = compareVersions(`1.0.${i}`, "1.0.0")
      if (i === 0) expect(cmp).toBe(0)
      else expect(cmp).toBeGreaterThan(0)
    })
    test(`bulk: 1.0.0 cmp 1.0.${i}`, () => {
      const cmp = compareVersions("1.0.0", `1.0.${i}`)
      if (i === 0) expect(cmp).toBe(0)
      else expect(cmp).toBeLessThan(0)
    })
  }
})

describe("desktop compareVersions - bulk minor", () => {
  for (let i = 0; i < 50; i++) {
    test(`bulk minor: 1.${i}.0 cmp 1.0.0`, () => {
      const cmp = compareVersions(`1.${i}.0`, "1.0.0")
      if (i === 0) expect(cmp).toBe(0)
      else expect(cmp).toBeGreaterThan(0)
    })
  }
})

describe("desktop compareVersions - bulk major", () => {
  for (let i = 0; i < 30; i++) {
    test(`bulk major: ${i}.0.0 cmp 0.0.0`, () => {
      const cmp = compareVersions(`${i}.0.0`, "0.0.0")
      if (i === 0) expect(cmp).toBe(0)
      else expect(cmp).toBeGreaterThan(0)
    })
  }
})

describe("desktop compareVersions - sign reversal", () => {
  const samples = [
    ["1.0.0", "2.0.0"],
    ["1.0.0", "1.0.1"],
    ["27.4.2", "27.5.0"],
    ["100.0.0", "99.9.9"],
  ]
  for (const [a, b] of samples) {
    test(`compareVersions(${a},${b}) === -compareVersions(${b},${a})`, () => {
      expect(Math.sign(compareVersions(a, b))).toBe(-Math.sign(compareVersions(b, a)))
    })
  }
})
