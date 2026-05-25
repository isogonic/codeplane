import { describe, expect, test } from "bun:test"
import { readToolDirectoryLabel, readToolLineRange } from "./message-part-read"

describe("readToolLineRange", () => {
  test("formats a bounded read range", () => {
    expect(readToolLineRange({ offset: 1, limit: 2000 })).toBe("L1-2000")
    expect(readToolLineRange({ offset: 10, limit: 50 })).toBe("L10-59")
  })

  test("handles single-line and open-ended reads", () => {
    expect(readToolLineRange({ offset: 8, limit: 1 })).toBe("L8")
    expect(readToolLineRange({ offset: 8 })).toBe("L8+")
    expect(readToolLineRange({ limit: 25 })).toBe("L1-25")
  })

  test("skips invalid ranges", () => {
    expect(readToolLineRange({})).toBeUndefined()
    expect(readToolLineRange({ offset: 0, limit: 0 })).toBeUndefined()
    expect(readToolLineRange({ offset: "1", limit: "2000" })).toBeUndefined()
  })

  test("hides project-root directory markers", () => {
    expect(readToolDirectoryLabel("/")).toBe("")
    expect(readToolDirectoryLabel(".")).toBe("")
    expect(readToolDirectoryLabel("packages/ui/src/")).toBe("packages/ui/src")
    expect(readToolDirectoryLabel("packages/ui/src")).toBe("packages/ui/src")
  })
})
