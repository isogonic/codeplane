export const CodeplaneVersion = "29.0.1"
export const CodeplaneReleasePrefix = "v"
export const CodeplaneDesktopReleaseSuffix = "-desktop"
export const CodeplaneMobileReleaseSuffix = "-mobile"

export function codeplaneReleaseTag(version = CodeplaneVersion) {
  return `${CodeplaneReleasePrefix}${version}`
}

export function codeplaneDesktopReleaseVersion(version = CodeplaneVersion) {
  return `${version}${CodeplaneDesktopReleaseSuffix}`
}

export function codeplaneDesktopReleaseTag(version = CodeplaneVersion) {
  return codeplaneReleaseTag(codeplaneDesktopReleaseVersion(version))
}

export function codeplaneMobileReleaseVersion(version = CodeplaneVersion) {
  return `${version}${CodeplaneMobileReleaseSuffix}`
}

/**
 * GitHub release tag for the mobile shell — `v<x.y.z>-mobile`. Mirrors
 * the `-desktop` shape so a single source release `v<x.y.z>` can spawn
 * platform-specific releases that carry the platform binaries (.ipa /
 * .apk / .aab) and offline web bundle.
 *
 * Note: the mobile shell's PRODUCTION update path is the App Store /
 * Play Store, NOT this GitHub release. The `-mobile` release exists for
 * sideloading, TestFlight builds, internal QA, and CI artefact storage
 * — exactly the same way the `-desktop` release isn't a substitute for
 * the in-app electron-updater on signed builds.
 */
export function codeplaneMobileReleaseTag(version = CodeplaneVersion) {
  return codeplaneReleaseTag(codeplaneMobileReleaseVersion(version))
}
