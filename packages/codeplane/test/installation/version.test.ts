import { describe, expect, test } from "bun:test"
import {
  cleanVersion,
  isDesktopReleaseVersion,
  isMobileReleaseVersion,
  isPlatformReleaseVersion,
  comparableVersion,
  isSameVersion,
  hasUpdate,
  InstallationVersion,
  InstallationChannel,
  InstallationLocal,
  DesktopReleaseSuffix,
  MobileReleaseSuffix,
} from "../../src/installation/version"

describe("cleanVersion", () => {
  test("strips leading v", () => {
    expect(cleanVersion("v1.2.3")).toBe("1.2.3")
  })

  test("strips leading uppercase V", () => {
    expect(cleanVersion("V1.2.3")).toBe("1.2.3")
  })

  test("trims whitespace", () => {
    expect(cleanVersion("  1.2.3  ")).toBe("1.2.3")
  })

  test("trims and strips together", () => {
    expect(cleanVersion("  v1.2.3  ")).toBe("1.2.3")
  })

  test("returns input unchanged when no v prefix", () => {
    expect(cleanVersion("1.2.3")).toBe("1.2.3")
  })

  test("only strips first v", () => {
    expect(cleanVersion("vv1.2.3")).toBe("v1.2.3")
  })

  test("returns empty for empty input", () => {
    expect(cleanVersion("")).toBe("")
  })

  test("preserves prerelease tags", () => {
    expect(cleanVersion("v1.2.3-beta.1")).toBe("1.2.3-beta.1")
  })
})

describe("isDesktopReleaseVersion", () => {
  test("returns true when suffix matches", () => {
    expect(isDesktopReleaseVersion("1.2.3-desktop")).toBe(true)
  })

  test("returns true with leading v", () => {
    expect(isDesktopReleaseVersion("v1.2.3-desktop")).toBe(true)
  })

  test("returns false when no suffix", () => {
    expect(isDesktopReleaseVersion("1.2.3")).toBe(false)
  })

  test("returns false for mobile suffix", () => {
    expect(isDesktopReleaseVersion("1.2.3-mobile")).toBe(false)
  })

  test("returns false when suffix not at end", () => {
    expect(isDesktopReleaseVersion("1.2.3-desktop-rc")).toBe(false)
  })

  test("DesktopReleaseSuffix is '-desktop'", () => {
    expect(DesktopReleaseSuffix).toBe("-desktop")
  })
})

describe("isMobileReleaseVersion", () => {
  test("returns true when suffix matches", () => {
    expect(isMobileReleaseVersion("1.2.3-mobile")).toBe(true)
  })

  test("returns true with leading v", () => {
    expect(isMobileReleaseVersion("v1.2.3-mobile")).toBe(true)
  })

  test("returns false when no suffix", () => {
    expect(isMobileReleaseVersion("1.2.3")).toBe(false)
  })

  test("returns false for desktop suffix", () => {
    expect(isMobileReleaseVersion("1.2.3-desktop")).toBe(false)
  })

  test("returns false when suffix not at end", () => {
    expect(isMobileReleaseVersion("1.2.3-mobile-rc")).toBe(false)
  })

  test("MobileReleaseSuffix is '-mobile'", () => {
    expect(MobileReleaseSuffix).toBe("-mobile")
  })
})

describe("isPlatformReleaseVersion", () => {
  // Combined gate the release-picker uses to filter out BOTH `-desktop`
  // and `-mobile` tags. The bug this prevents (28.0.6-mobile getting
  // semver-coerced to 28.0.6 and surfaced as an "available update" on a
  // 28.0.1 desktop install) goes through this exact predicate.
  test("returns true for desktop tag", () => {
    expect(isPlatformReleaseVersion("v1.2.3-desktop")).toBe(true)
  })

  test("returns true for mobile tag", () => {
    expect(isPlatformReleaseVersion("v1.2.3-mobile")).toBe(true)
  })

  test("returns false for canonical tag", () => {
    expect(isPlatformReleaseVersion("v1.2.3")).toBe(false)
  })

  test("returns false for empty input", () => {
    expect(isPlatformReleaseVersion("")).toBe(false)
  })
})

describe("comparableVersion", () => {
  test("returns valid semver as-is", () => {
    expect(comparableVersion("1.2.3")).toBe("1.2.3")
  })

  test("strips v prefix before comparison", () => {
    expect(comparableVersion("v1.2.3")).toBe("1.2.3")
  })

  test("coerces partial version", () => {
    expect(comparableVersion("1")).toBe("1.0.0")
    expect(comparableVersion("1.2")).toBe("1.2.0")
  })

  test("returns undefined for non-version", () => {
    expect(comparableVersion("not-a-version")).toBeUndefined()
  })

  test("preserves prerelease", () => {
    expect(comparableVersion("1.2.3-beta")).toBe("1.2.3-beta")
  })
})

describe("isSameVersion", () => {
  test("same version returns true", () => {
    expect(isSameVersion("1.2.3", "1.2.3")).toBe(true)
  })

  test("different version returns false", () => {
    expect(isSameVersion("1.2.3", "1.2.4")).toBe(false)
  })

  test("v-prefixed equal returns true", () => {
    expect(isSameVersion("v1.2.3", "1.2.3")).toBe(true)
  })

  test("whitespace differences ignored", () => {
    expect(isSameVersion("  1.2.3  ", "1.2.3")).toBe(true)
  })

  test("non-version strings compare as strings", () => {
    expect(isSameVersion("local", "local")).toBe(true)
    expect(isSameVersion("local", "dev")).toBe(false)
  })

  test("partial version coerces and compares", () => {
    expect(isSameVersion("1", "1.0.0")).toBe(true)
  })

  test("empty strings considered same", () => {
    expect(isSameVersion("", "")).toBe(true)
  })
})

describe("hasUpdate", () => {
  test("returns false for same version", () => {
    expect(hasUpdate("1.2.3", "1.2.3")).toBe(false)
  })

  test("returns true for newer version", () => {
    expect(hasUpdate("1.2.3", "1.2.4")).toBe(true)
  })

  test("returns false when current is newer", () => {
    expect(hasUpdate("1.2.4", "1.2.3")).toBe(false)
  })

  test("ignores v prefix", () => {
    expect(hasUpdate("v1.2.3", "v1.2.4")).toBe(true)
  })

  test("major version bump", () => {
    expect(hasUpdate("1.2.3", "2.0.0")).toBe(true)
  })

  test("minor version bump", () => {
    expect(hasUpdate("1.2.3", "1.3.0")).toBe(true)
  })

  test("patch version bump", () => {
    expect(hasUpdate("1.2.3", "1.2.4")).toBe(true)
  })

  test("non-versions compared as strings", () => {
    expect(hasUpdate("local", "local")).toBe(false)
    expect(hasUpdate("dev", "release")).toBe(true)
  })
})

describe("InstallationVersion / Channel", () => {
  test("InstallationVersion is a string", () => {
    expect(typeof InstallationVersion).toBe("string")
  })

  test("InstallationChannel is a string", () => {
    expect(typeof InstallationChannel).toBe("string")
  })

  test("InstallationLocal flag matches channel == local", () => {
    expect(InstallationLocal).toBe(InstallationChannel === "local")
  })
})
