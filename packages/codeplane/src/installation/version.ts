import semver from "semver"
import { CodeplaneDesktopReleaseSuffix } from "@codeplane-ai/shared/version"

declare global {
  const CODEPLANE_VERSION: string
  const CODEPLANE_CHANNEL: string
}

export const InstallationVersion = typeof CODEPLANE_VERSION === "string" ? CODEPLANE_VERSION : "local"
export const InstallationChannel = typeof CODEPLANE_CHANNEL === "string" ? CODEPLANE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
export const DesktopReleaseSuffix = CodeplaneDesktopReleaseSuffix

export function cleanVersion(input: string) {
  return input.trim().replace(/^v/, "")
}

export function isDesktopReleaseVersion(input: string) {
  return cleanVersion(input).endsWith(DesktopReleaseSuffix)
}

export function comparableVersion(input: string) {
  const clean = cleanVersion(input)
  return semver.valid(clean) ?? semver.coerce(clean)?.version
}

export function isSameVersion(current: string, target: string) {
  const currentComparable = comparableVersion(current)
  const targetComparable = comparableVersion(target)
  if (currentComparable && targetComparable) return semver.eq(currentComparable, targetComparable)
  return cleanVersion(current) === cleanVersion(target)
}

export function hasUpdate(current: string, latest: string) {
  if (isSameVersion(current, latest)) return false
  const currentComparable = comparableVersion(current)
  const latestComparable = comparableVersion(latest)
  if (currentComparable && latestComparable) return semver.gt(latestComparable, currentComparable)
  return cleanVersion(current) !== cleanVersion(latest)
}
