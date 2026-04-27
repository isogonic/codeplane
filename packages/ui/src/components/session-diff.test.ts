import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch } from "diff"
import { normalize, text } from "./session-diff"

describe("session diff", () => {
  test("keeps unified patch content", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const view = normalize(diff)

    expect(view.patch).toBe(diff.patch)
    expect(view.fileDiff.name).toBe("a.ts")
    expect(text(view, "deletions")).toBe("one\ntwo\n")
    expect(text(view, "additions")).toBe("one\nthree\n")
  })

  test("converts legacy content into a patch", () => {
    const diff = {
      file: "a.ts",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const view = normalize(diff)

    expect(view.patch).toContain("@@ -1,1 +1,1 @@")
    expect(text(view, "deletions")).toBe("one\n")
    expect(text(view, "additions")).toBe("two\n")
  })

  test("uses legacy content when patch has no renderable hunks", () => {
    const view = normalize({
      file: "a.ts",
      patch: "",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
      status: "modified",
    })

    expect(view.patch).toBe("")
    expect(text(view, "deletions")).toBe("one\n")
    expect(text(view, "additions")).toBe("two\n")
  })

  test("ignores no-newline markers from parsed patch hunks", () => {
    const view = normalize({
      file: "a.ts",
      patch: createTwoFilesPatch("a.ts", "a.ts", "one", "two"),
      additions: 1,
      deletions: 1,
      status: "modified",
    })

    expect(text(view, "deletions")).toBe("one")
    expect(text(view, "additions")).toBe("two")
  })

  test("keys file diff cache by file and patch", () => {
    const patch = createTwoFilesPatch("same.ts", "same.ts", "one\n", "two\n")

    normalize({
      file: "a.ts",
      patch,
      additions: 1,
      deletions: 1,
      status: "modified",
    })
    const view = normalize({
      file: "b.ts",
      patch,
      additions: 1,
      deletions: 1,
      status: "modified",
    })

    expect(view.fileDiff.name).toBe("b.ts")
  })
})
