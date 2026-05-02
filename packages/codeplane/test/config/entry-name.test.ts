import { describe, expect, test } from "bun:test"
import { configEntryNameFromPath } from "../../src/config/entry-name"

describe("configEntryNameFromPath", () => {
  test("strips extension", () => {
    expect(configEntryNameFromPath("/x/y/file.ts", [])).toBe("file")
  })

  test("strips json extension", () => {
    expect(configEntryNameFromPath("config.json", [])).toBe("config")
  })

  test("strips multiple-character extension", () => {
    expect(configEntryNameFromPath("file.toml", [])).toBe("file")
  })

  test("returns basename when no search roots match", () => {
    expect(configEntryNameFromPath("/a/b/file.ts", ["/x/y"])).toBe("file")
  })

  test("slices after matching search root", () => {
    expect(configEntryNameFromPath("/x/y/foo/bar.ts", ["/y/"])).toBe("foo/bar")
  })

  test("normalizes Windows backslashes when search root matches", () => {
    expect(configEntryNameFromPath("C:\\x\\file.ts", ["/x/"])).toBe("file")
  })

  test("falls back to basename for non-matching root (unix path)", () => {
    expect(configEntryNameFromPath("/path/to/file.ts", ["/agents/"])).toBe("file")
  })

  test("works with no extension", () => {
    expect(configEntryNameFromPath("/path/to/README", [])).toBe("README")
  })

  test("preserves directory structure after match", () => {
    expect(configEntryNameFromPath("/a/agents/sub/x.toml", ["/agents/"])).toBe("sub/x")
  })

  test("handles dot prefix without extension", () => {
    expect(configEntryNameFromPath(".hidden", [])).toBe(".hidden")
  })

  test("multiple search roots match first", () => {
    expect(configEntryNameFromPath("/a/agents/x.ts", ["/agents/", "/skills/"])).toBe("x")
  })

  test("nothing matches falls back to basename", () => {
    expect(configEntryNameFromPath("/abc/def.json", ["/zz/", "/aa/"])).toBe("def")
  })
})
