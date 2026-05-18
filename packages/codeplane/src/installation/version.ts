import semver from "semver"
import { CodeplaneDesktopReleaseSuffix, CodeplaneMobileReleaseSuffix } from "@codeplane-ai/shared/version"

declare global {
  const CODEPLANE_VERSION: string
  const CODEPLANE_CHANNEL: string
}

export const InstallationVersion = typeof CODEPLANE_VERSION === "string" ? CODEPLANE_VERSION : "local"
export const InstallationChannel = typeof CODEPLANE_CHANNEL === "string" ? CODEPLANE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
export const DesktopReleaseSuffix = CodeplaneDesktopReleaseSuffix
export const MobileReleaseSuffix = CodeplaneMobileReleaseSuffix

export function cleanVersion(input: string) {
  return input.trim().replace(/^[vV]/, "")
}

export function isDesktopReleaseVersion(input: string) {
  const clean = cleanVersion(input)
  if (!clean.endsWith(DesktopReleaseSuffix)) return false
  return Boolean(semver.valid(clean.slice(0, -DesktopReleaseSuffix.length)))
}

export function isMobileReleaseVersion(input: string) {
  const clean = cleanVersion(input)
  if (!clean.endsWith(MobileReleaseSuffix)) return false
  return Boolean(semver.valid(clean.slice(0, -MobileReleaseSuffix.length)))
}

/**
 * Platform-specific release tags (`v<x.y.z>-desktop`, `v<x.y.z>-mobile`)
 * carry binaries for ONE platform only and MUST NOT be considered as
 * upgrade targets for the generic CLI / web / TUI / server install. The
 * release picker filters them out and the upgrade impl rejects them up
 * front so a stale `-mobile` tag can't get coerced to its base version
 * by `semver.coerce` and surface as an "available update".
 *
 * Bug this prevents (reported by a user on a 28.0.1 desktop install):
 *   "Version 28.0.6-mobile ist verfügbar. Du nutzt 28.0.1."
 * The mobile release contains iOS / Android artefacts only — installing
 * it onto a desktop, server, or CLI install would have no chance of
 * working.
 */
export function isPlatformReleaseVersion(input: string) {
  return isDesktopReleaseVersion(input) || isMobileReleaseVersion(input)
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
