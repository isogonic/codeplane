import type { SystemPermissionStatus } from "@/context/platform"

export function systemPermissionGranted(permission: SystemPermissionStatus) {
  return permission.granted || permission.restartRequired === true
}

export function systemPermissionReady(permission: SystemPermissionStatus) {
  if (!systemPermissionGranted(permission)) return false
  if (permission.restartRequired) return false
  return permission.active !== false
}

export function systemPermissionNeedsRelaunch(permission: SystemPermissionStatus) {
  return systemPermissionGranted(permission) && !systemPermissionReady(permission)
}
