import { describe, expect, test } from "bun:test"
import {
  systemPermissionGranted,
  systemPermissionNeedsRelaunch,
  systemPermissionReady,
} from "./desktop-permissions"

describe("desktop permission status", () => {
  test("treats legacy granted permissions as ready", () => {
    const permission = { key: "screen-recording", label: "Screen Recording", granted: true }

    expect(systemPermissionGranted(permission)).toBe(true)
    expect(systemPermissionReady(permission)).toBe(true)
    expect(systemPermissionNeedsRelaunch(permission)).toBe(false)
  })

  test("does not report a granted but inactive permission as ready", () => {
    const permission = {
      key: "screen-recording",
      label: "Screen Recording",
      granted: true,
      active: false,
      restartRequired: true,
    }

    expect(systemPermissionGranted(permission)).toBe(true)
    expect(systemPermissionReady(permission)).toBe(false)
    expect(systemPermissionNeedsRelaunch(permission)).toBe(true)
  })

  test("keeps missing permissions missing", () => {
    const permission = { key: "accessibility", label: "Accessibility", granted: false, active: false }

    expect(systemPermissionGranted(permission)).toBe(false)
    expect(systemPermissionReady(permission)).toBe(false)
    expect(systemPermissionNeedsRelaunch(permission)).toBe(false)
  })
})
