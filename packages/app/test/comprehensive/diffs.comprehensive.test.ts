import { describe, expect, test } from "bun:test"
import { diffs } from "../../src/utils/diffs"

const validDiff = (file: string, status?: "added" | "deleted" | "modified") => ({
  file,
  patch: "diff",
  additions: 1,
  deletions: 0,
  ...(status ? { status } : {}),
})

describe("diffs - extraction", () => {
  test("array of valid diffs", () => {
    const value = [validDiff("a.ts"), validDiff("b.ts")]
    expect(diffs(value)).toEqual(value)
  })
  test("array filtered to valid", () => {
    const value = [validDiff("a.ts"), { wrong: 1 }]
    expect(diffs(value)).toHaveLength(1)
  })
  test("single valid diff", () => {
    expect(diffs(validDiff("a.ts"))).toHaveLength(1)
  })
  test("invalid object returns empty", () => {
    expect(diffs({ wrong: 1 })).toEqual([])
  })
  test("primitive returns empty", () => {
    expect(diffs(42)).toEqual([])
  })
  test("undefined returns empty", () => {
    expect(diffs(undefined)).toEqual([])
  })
  test("null returns empty", () => {
    expect(diffs(null)).toEqual([])
  })
  test("object map of diffs", () => {
    const a = validDiff("a.ts")
    const b = validDiff("b.ts")
    const result = diffs({ a, b })
    expect(result).toContain(a)
    expect(result).toContain(b)
  })
  test("rejects diff with invalid status", () => {
    const bad = { ...validDiff("a.ts"), status: "weird" }
    expect(diffs(bad)).toEqual([])
  })
  test("accepts diff with status added", () => {
    expect(diffs(validDiff("a.ts", "added"))).toHaveLength(1)
  })
  test("accepts diff with status deleted", () => {
    expect(diffs(validDiff("a.ts", "deleted"))).toHaveLength(1)
  })
  test("accepts diff with status modified", () => {
    expect(diffs(validDiff("a.ts", "modified"))).toHaveLength(1)
  })
})

describe("diffs - bulk", () => {
  for (let n = 1; n <= 50; n++) {
    test(`bulk array of ${n} valid diffs`, () => {
      const value = Array.from({ length: n }, (_, i) => validDiff(`f${i}.ts`))
      expect(diffs(value)).toHaveLength(n)
    })
  }
  for (let n = 0; n < 20; n++) {
    test(`bulk diff for path ${n}`, () => {
      expect(diffs(validDiff(`p${n}.ts`))[0]?.file).toBe(`p${n}.ts`)
    })
  }
})
