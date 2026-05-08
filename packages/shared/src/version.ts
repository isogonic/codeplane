export const CodeplaneVersion = "28.0.2"
export const CodeplaneReleasePrefix = "v"
export const CodeplaneDesktopReleaseSuffix = "-desktop"

export function codeplaneReleaseTag(version = CodeplaneVersion) {
  return `${CodeplaneReleasePrefix}${version}`
}

export function codeplaneDesktopReleaseVersion(version = CodeplaneVersion) {
  return `${version}${CodeplaneDesktopReleaseSuffix}`
}

export function codeplaneDesktopReleaseTag(version = CodeplaneVersion) {
  return codeplaneReleaseTag(codeplaneDesktopReleaseVersion(version))
}
