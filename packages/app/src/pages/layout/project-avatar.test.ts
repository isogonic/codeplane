import { describe, expect, test } from "bun:test"
import { getProjectAvatarSource } from "./project-avatar"

describe("getProjectAvatarSource", () => {
  test("uses only manually overridden project icons", () => {
    expect(getProjectAvatarSource({ override: "data:image/png;base64,manual" })).toBe("data:image/png;base64,manual")
    expect(getProjectAvatarSource({ url: "data:image/png;base64,discovered" })).toBeUndefined()
    expect(getProjectAvatarSource({ color: "pink" })).toBeUndefined()
  })
})
