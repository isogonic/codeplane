import { describe, expect, test } from "bun:test"
import { normalize, text } from "./session-diff"

describe("session-diff normalize", () => {
  test("normalizes legacy diff with before/after", () => {
    const diff = normalize({
      file: "a.ts",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
    })
    expect(diff.file).toBe("a.ts")
    expect(diff.patch.length).toBeGreaterThan(0)
  })

  test("preserves additions and deletions counts", () => {
    const diff = normalize({
      file: "a.ts",
      before: "x\n",
      after: "y\n",
      additions: 5,
      deletions: 4,
    })
    expect(diff.additions).toBe(5)
    expect(diff.deletions).toBe(4)
  })

  test("preserves status when provided", () => {
    const diff = normalize({
      file: "a.ts",
      before: "",
      after: "x\n",
      additions: 1,
      deletions: 0,
      status: "added",
    })
    expect(diff.status).toBe("added")
  })

  test("treats deleted file when after is empty", () => {
    const diff = normalize({
      file: "a.ts",
      before: "x\n",
      after: "",
      additions: 0,
      deletions: 1,
      status: "deleted",
    })
    expect(diff.status).toBe("deleted")
  })

  test("normalizes a unified patch", () => {
    const patch = `--- a.ts\n+++ a.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n`
    const diff = normalize({ file: "a.ts", patch, additions: 1, deletions: 1 })
    expect(diff.patch).toBe(patch)
  })

  test("provides fileDiff metadata", () => {
    const diff = normalize({ file: "a.ts", before: "x\n", after: "y\n", additions: 1, deletions: 1 })
    expect(diff.fileDiff).toBeDefined()
  })

  test("file name is preserved", () => {
    const diff = normalize({ file: "/abs/file.tsx", before: "", after: "", additions: 0, deletions: 0 })
    expect(diff.file).toBe("/abs/file.tsx")
  })
})

describe("session-diff text", () => {
  test("returns added lines", () => {
    const diff = normalize({ file: "a", before: "x\n", after: "y\n", additions: 1, deletions: 1 })
    expect(text(diff, "additions")).toBe("y\n")
  })

  test("returns deleted lines", () => {
    const diff = normalize({ file: "a", before: "x\n", after: "y\n", additions: 1, deletions: 1 })
    expect(text(diff, "deletions")).toBe("x\n")
  })

  test("multi-line additions", () => {
    const diff = normalize({ file: "a", before: "x\ny\n", after: "x\nz\nq\n", additions: 2, deletions: 1 })
    expect(text(diff, "additions").length).toBeGreaterThan(0)
  })

  test("returns string", () => {
    const diff = normalize({ file: "a", before: "", after: "", additions: 0, deletions: 0 })
    expect(typeof text(diff, "additions")).toBe("string")
    expect(typeof text(diff, "deletions")).toBe("string")
  })
})
