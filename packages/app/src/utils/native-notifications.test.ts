import { describe, expect, test } from "bun:test"
import { desktopNativeNotificationEnabled, shouldShowInAppNotificationToast } from "./native-notifications"

describe("native notification toast suppression", () => {
  test("uses desktop native notifications only when desktop and enabled", () => {
    expect(desktopNativeNotificationEnabled({ desktop: true, enabled: true })).toBe(true)
    expect(desktopNativeNotificationEnabled({ desktop: true, enabled: false })).toBe(false)
    expect(desktopNativeNotificationEnabled({ desktop: false, enabled: true })).toBe(false)
    expect(desktopNativeNotificationEnabled({ enabled: true })).toBe(false)
  })

  test("suppresses in-app toasts when desktop native notifications are enabled", () => {
    expect(
      shouldShowInAppNotificationToast({
        desktopNativeNotificationEnabled: true,
        currentSessionTarget: false,
        childSessionTarget: false,
      }),
    ).toBe(false)
  })

  test("keeps existing active-session suppression without native notifications", () => {
    expect(
      shouldShowInAppNotificationToast({
        desktopNativeNotificationEnabled: false,
        currentSessionTarget: true,
        childSessionTarget: false,
      }),
    ).toBe(false)
    expect(
      shouldShowInAppNotificationToast({
        desktopNativeNotificationEnabled: false,
        currentSessionTarget: false,
        childSessionTarget: true,
      }),
    ).toBe(false)
  })

  test("shows in-app toasts only when no desktop native notification or active target suppresses them", () => {
    expect(
      shouldShowInAppNotificationToast({
        desktopNativeNotificationEnabled: false,
        currentSessionTarget: false,
        childSessionTarget: false,
      }),
    ).toBe(true)
  })
})
