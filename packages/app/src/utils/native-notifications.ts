export function desktopNativeNotificationEnabled(input: { desktop?: boolean; enabled: boolean }) {
  return input.desktop === true && input.enabled
}

export function shouldShowInAppNotificationToast(input: {
  desktopNativeNotificationEnabled: boolean
  currentSessionTarget: boolean
  childSessionTarget: boolean
}) {
  if (input.desktopNativeNotificationEnabled) return false
  if (input.currentSessionTarget) return false
  if (input.childSessionTarget) return false
  return true
}
