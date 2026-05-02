import { describe, expect, test } from "bun:test"
import { patchFile, patchFiles } from "./apply-patch-file"

describe("patchFile invalid inputs", () => {
  test("returns undefined for null", () => {
    expect(patchFile(null)).toBeUndefined()
  })

  test("returns undefined for undefined", () => {
    expect(patchFile(undefined)).toBeUndefined()
  })

  test("returns undefined for primitive", () => {
    expect(patchFile("string")).toBeUndefined()
    expect(patchFile(42)).toBeUndefined()
    expect(patchFile(true)).toBeUndefined()
  })

  test("returns undefined when missing type", () => {
    expect(patchFile({ filePath: "/a", relativePath: "a", patch: "..." })).toBeUndefined()
  })

  test("returns undefined when type is invalid", () => {
    expect(patchFile({ filePath: "/a", relativePath: "a", type: "badtype", patch: "..." })).toBeUndefined()
  })

  test("returns undefined when missing filePath", () => {
    expect(patchFile({ relativePath: "a", type: "update", patch: "..." })).toBeUndefined()
  })

  test("returns undefined when no patch/before/after", () => {
    expect(patchFile({ filePath: "/a", relativePath: "a", type: "update" })).toBeUndefined()
  })

  test("relativePath defaults to filePath", () => {
    const f = patchFile({ filePath: "x.ts", type: "add", before: "", after: "x" })
    expect(f?.relativePath).toBe("x.ts")
  })

  test("accepts diff field as alternative to patch", () => {
    const f = patchFile({ filePath: "x.ts", relativePath: "x.ts", type: "update", diff: "@@" })
    expect(f).toBeDefined()
  })

  test("supports kind=add", () => {
    const f = patchFile({ filePath: "x.ts", relativePath: "x.ts", type: "add", before: "", after: "x" })
    expect(f?.type).toBe("add")
  })

  test("supports kind=update", () => {
    const f = patchFile({ filePath: "x.ts", relativePath: "x.ts", type: "update", before: "x", after: "y" })
    expect(f?.type).toBe("update")
  })

  test("supports kind=delete", () => {
    const f = patchFile({ filePath: "x.ts", relativePath: "x.ts", type: "delete", before: "x", after: "" })
    expect(f?.type).toBe("delete")
  })

  test("supports kind=move", () => {
    const f = patchFile({
      filePath: "x.ts",
      relativePath: "x.ts",
      type: "move",
      movePath: "y.ts",
      before: "",
      after: "",
    })
    expect(f?.type).toBe("move")
    expect(f?.movePath).toBe("y.ts")
  })

  test("defaults additions/deletions to 0", () => {
    const f = patchFile({ filePath: "x.ts", relativePath: "x.ts", type: "update", before: "x", after: "y" })
    expect(f?.additions).toBe(0)
    expect(f?.deletions).toBe(0)
  })

  test("preserves additions/deletions counts", () => {
    const f = patchFile({
      filePath: "x.ts",
      relativePath: "x.ts",
      type: "update",
      before: "x",
      after: "y",
      additions: 3,
      deletions: 2,
    })
    expect(f?.additions).toBe(3)
    expect(f?.deletions).toBe(2)
  })

  test("ignores non-string movePath", () => {
    const f = patchFile({
      filePath: "x.ts",
      relativePath: "x.ts",
      type: "update",
      before: "x",
      after: "y",
      movePath: 42 as unknown as string,
    })
    expect(f?.movePath).toBeUndefined()
  })

  test("ignores non-number additions/deletions", () => {
    const f = patchFile({
      filePath: "x.ts",
      relativePath: "x.ts",
      type: "update",
      before: "x",
      after: "y",
      additions: "3" as unknown as number,
      deletions: "2" as unknown as number,
    })
    expect(f?.additions).toBe(0)
    expect(f?.deletions).toBe(0)
  })
})

describe("patchFiles", () => {
  test("returns empty array for non-array", () => {
    expect(patchFiles({})).toEqual([])
    expect(patchFiles(null)).toEqual([])
    expect(patchFiles(undefined)).toEqual([])
    expect(patchFiles("foo")).toEqual([])
  })

  test("returns empty array for empty array", () => {
    expect(patchFiles([])).toEqual([])
  })

  test("filters out invalid entries", () => {
    const result = patchFiles([
      { filePath: "x.ts", relativePath: "x.ts", type: "update", before: "a", after: "b" },
      { invalid: true },
      null,
      "not an object",
    ])
    expect(result.length).toBe(1)
  })

  test("returns array of valid entries", () => {
    const result = patchFiles([
      { filePath: "a.ts", relativePath: "a.ts", type: "update", before: "1", after: "2" },
      { filePath: "b.ts", relativePath: "b.ts", type: "add", before: "", after: "x" },
    ])
    expect(result.length).toBe(2)
  })

  test("preserves order", () => {
    const result = patchFiles([
      { filePath: "a.ts", relativePath: "a.ts", type: "update", before: "1", after: "2" },
      { filePath: "b.ts", relativePath: "b.ts", type: "delete", before: "x", after: "" },
      { filePath: "c.ts", relativePath: "c.ts", type: "add", before: "", after: "z" },
    ])
    expect(result.map((f) => f.filePath)).toEqual(["a.ts", "b.ts", "c.ts"])
  })
})
