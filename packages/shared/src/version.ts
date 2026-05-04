export const CodeplaneVersion = "27.4.40"
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
