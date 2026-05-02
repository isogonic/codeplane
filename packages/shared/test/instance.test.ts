import { describe, expect, test } from "bun:test"
import { localInstanceUrl } from "../src/instance"

describe("localInstanceUrl", () => {
  test("prefixes id with local://", () => {
    expect(localInstanceUrl("123")).toBe("local://123")
  })

  test("works with empty id", () => {
    expect(localInstanceUrl("")).toBe("local://")
  })

  test("works with uuid-like id", () => {
    expect(localInstanceUrl("abc-def-123")).toBe("local://abc-def-123")
  })

  test("preserves special characters", () => {
    expect(localInstanceUrl("foo bar")).toBe("local://foo bar")
  })

  test("preserves unicode", () => {
    expect(localInstanceUrl("идентификатор")).toBe("local://идентификатор")
  })

  test("preserves slashes in id", () => {
    expect(localInstanceUrl("a/b")).toBe("local://a/b")
  })

  test("preserves colons in id", () => {
    expect(localInstanceUrl("foo:bar")).toBe("local://foo:bar")
  })

  test("returns string type", () => {
    expect(typeof localInstanceUrl("anything")).toBe("string")
  })
})
