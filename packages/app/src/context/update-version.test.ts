import { describe, expect, test } from "bun:test"
import { compareUpdateVersions, isUpdateNewer, normalizeUpdateStatus } from "./update-version"

describe("update version comparison", () => {
  test("does not treat the same version as an update", () => {
    expect(isUpdateNewer("28.21.3", "28.21.3")).toBe(false)
    expect(normalizeUpdateStatus({ current: "28.21.3", latest: "28.21.3", hasUpdate: true, method: "npm" }).hasUpdate).toBe(false)
  })

  test("treats desktop and base release tags for the same version as equal", () => {
    expect(compareUpdateVersions("28.21.3-desktop", "28.21.3")).toBe(0)
    expect(isUpdateNewer("28.21.3", "28.21.3-desktop")).toBe(false)
  })

  test("detects newer and older versions", () => {
    expect(isUpdateNewer("28.21.3", "28.21.4")).toBe(true)
    expect(isUpdateNewer("28.21.4", "28.21.3")).toBe(false)
  })

  test("does not offer release updates for dev or local builds", () => {
    expect(isUpdateNewer("dev", "28.21.4")).toBe(false)
    expect(isUpdateNewer("local", "28.21.4")).toBe(false)
  })
})
