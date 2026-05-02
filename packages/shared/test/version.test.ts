import { describe, expect, test } from "bun:test"
import {
  CodeplaneVersion,
  CodeplaneReleasePrefix,
  CodeplaneDesktopReleaseSuffix,
  codeplaneReleaseTag,
  codeplaneDesktopReleaseVersion,
  codeplaneDesktopReleaseTag,
} from "../src/version"

describe("CodeplaneVersion", () => {
  test("is a non-empty string", () => {
    expect(typeof CodeplaneVersion).toBe("string")
    expect(CodeplaneVersion.length).toBeGreaterThan(0)
  })

  test("looks like semver-style version", () => {
    expect(CodeplaneVersion).toMatch(/^\d+\.\d+\.\d+(-.*)?$/)
  })
})

describe("CodeplaneReleasePrefix", () => {
  test("equals 'v'", () => {
    expect(CodeplaneReleasePrefix).toBe("v")
  })
})

describe("CodeplaneDesktopReleaseSuffix", () => {
  test("equals '-desktop'", () => {
    expect(CodeplaneDesktopReleaseSuffix).toBe("-desktop")
  })
})

describe("codeplaneReleaseTag", () => {
  test("uses default version when omitted", () => {
    expect(codeplaneReleaseTag()).toBe(`v${CodeplaneVersion}`)
  })

  test("uses provided version", () => {
    expect(codeplaneReleaseTag("1.2.3")).toBe("v1.2.3")
  })

  test("preserves prerelease tags", () => {
    expect(codeplaneReleaseTag("1.2.3-beta.1")).toBe("v1.2.3-beta.1")
  })

  test("supports zero version", () => {
    expect(codeplaneReleaseTag("0.0.0")).toBe("v0.0.0")
  })

  test("returned value starts with 'v'", () => {
    expect(codeplaneReleaseTag("99.99.99").startsWith("v")).toBe(true)
  })
})

describe("codeplaneDesktopReleaseVersion", () => {
  test("appends '-desktop' to default version", () => {
    expect(codeplaneDesktopReleaseVersion()).toBe(`${CodeplaneVersion}-desktop`)
  })

  test("appends '-desktop' to provided version", () => {
    expect(codeplaneDesktopReleaseVersion("1.2.3")).toBe("1.2.3-desktop")
  })

  test("preserves trailing characters in input", () => {
    expect(codeplaneDesktopReleaseVersion("1.0.0-beta")).toBe("1.0.0-beta-desktop")
  })

  test("output ends with '-desktop'", () => {
    expect(codeplaneDesktopReleaseVersion("0.0.0").endsWith("-desktop")).toBe(true)
  })
})

describe("codeplaneDesktopReleaseTag", () => {
  test("returns v<version>-desktop using default", () => {
    expect(codeplaneDesktopReleaseTag()).toBe(`v${CodeplaneVersion}-desktop`)
  })

  test("returns v<version>-desktop with custom", () => {
    expect(codeplaneDesktopReleaseTag("1.2.3")).toBe("v1.2.3-desktop")
  })

  test("starts with 'v'", () => {
    expect(codeplaneDesktopReleaseTag("9.9.9").startsWith("v")).toBe(true)
  })

  test("ends with '-desktop'", () => {
    expect(codeplaneDesktopReleaseTag("9.9.9").endsWith("-desktop")).toBe(true)
  })

  test("composes prefix + version + suffix", () => {
    expect(codeplaneDesktopReleaseTag("3.4.5")).toBe(`${CodeplaneReleasePrefix}3.4.5${CodeplaneDesktopReleaseSuffix}`)
  })
})
