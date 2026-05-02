import { describe, expect, test } from "bun:test"
import {
  CodeplaneDesktopReleaseSuffix,
  CodeplaneReleasePrefix,
  CodeplaneVersion,
  codeplaneDesktopReleaseTag,
  codeplaneDesktopReleaseVersion,
  codeplaneReleaseTag,
} from "../src/version"

describe("constants", () => {
  test("version is a non-empty string", () => {
    expect(typeof CodeplaneVersion).toBe("string")
    expect(CodeplaneVersion.length).toBeGreaterThan(0)
  })
  test("version matches semver-like pattern", () => {
    expect(CodeplaneVersion).toMatch(/^\d+\.\d+\.\d+/)
  })
  test("release prefix is v", () => {
    expect(CodeplaneReleasePrefix).toBe("v")
  })
  test("desktop suffix is -desktop", () => {
    expect(CodeplaneDesktopReleaseSuffix).toBe("-desktop")
  })
  test("version has exactly two dots in the major.minor.patch", () => {
    const before = CodeplaneVersion.split("-")[0]!
    expect(before.split(".")).toHaveLength(3)
  })
  test("constants are exported as expected types", () => {
    expect(typeof CodeplaneReleasePrefix).toBe("string")
    expect(typeof CodeplaneDesktopReleaseSuffix).toBe("string")
  })
})

describe("codeplaneReleaseTag", () => {
  test("default uses CodeplaneVersion", () => {
    expect(codeplaneReleaseTag()).toBe(`v${CodeplaneVersion}`)
  })
  test("starts with v prefix", () => {
    expect(codeplaneReleaseTag()).toMatch(/^v/)
  })
  test("with explicit version", () => {
    expect(codeplaneReleaseTag("1.0.0")).toBe("v1.0.0")
  })
  test("with prerelease", () => {
    expect(codeplaneReleaseTag("1.2.3-rc.0")).toBe("v1.2.3-rc.0")
  })
  test("with empty string still prepends v", () => {
    expect(codeplaneReleaseTag("")).toBe("v")
  })
  test("with high version numbers", () => {
    expect(codeplaneReleaseTag("99.99.99")).toBe("v99.99.99")
  })
  test("with single zero version", () => {
    expect(codeplaneReleaseTag("0.0.0")).toBe("v0.0.0")
  })
  test("with build metadata", () => {
    expect(codeplaneReleaseTag("1.2.3+build.456")).toBe("v1.2.3+build.456")
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk version ${i}`, () =>
      expect(codeplaneReleaseTag(`${i}.${i}.${i}`)).toBe(`v${i}.${i}.${i}`))
  }
})

describe("codeplaneDesktopReleaseVersion", () => {
  test("default appends -desktop", () => {
    expect(codeplaneDesktopReleaseVersion()).toBe(`${CodeplaneVersion}-desktop`)
  })
  test("with explicit version", () => {
    expect(codeplaneDesktopReleaseVersion("1.2.3")).toBe("1.2.3-desktop")
  })
  test("preserves prerelease before suffix", () => {
    expect(codeplaneDesktopReleaseVersion("1.2.3-rc.0")).toBe("1.2.3-rc.0-desktop")
  })
  test("appends to empty", () => {
    expect(codeplaneDesktopReleaseVersion("")).toBe("-desktop")
  })
  test("ends with -desktop", () => {
    expect(codeplaneDesktopReleaseVersion("4.5.6").endsWith("-desktop")).toBe(true)
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk desktop version ${i}`, () =>
      expect(codeplaneDesktopReleaseVersion(`${i}.${i}.${i}`)).toBe(`${i}.${i}.${i}-desktop`))
  }
})

describe("codeplaneDesktopReleaseTag", () => {
  test("default produces v<version>-desktop", () => {
    expect(codeplaneDesktopReleaseTag()).toBe(`v${CodeplaneVersion}-desktop`)
  })
  test("with explicit version", () => {
    expect(codeplaneDesktopReleaseTag("1.0.0")).toBe("v1.0.0-desktop")
  })
  test("starts with v", () => {
    expect(codeplaneDesktopReleaseTag("9.9.9")).toMatch(/^v/)
  })
  test("ends with -desktop", () => {
    expect(codeplaneDesktopReleaseTag("9.9.9").endsWith("-desktop")).toBe(true)
  })
  test("contains the version", () => {
    expect(codeplaneDesktopReleaseTag("3.4.5")).toContain("3.4.5")
  })
  test("composes correctly", () => {
    const v = "10.20.30"
    expect(codeplaneDesktopReleaseTag(v)).toBe(`${codeplaneReleaseTag(codeplaneDesktopReleaseVersion(v))}`)
  })
  for (let i = 0; i < 50; i++) {
    test(`bulk desktop tag ${i}`, () =>
      expect(codeplaneDesktopReleaseTag(`${i}.${i}.${i}`)).toBe(`v${i}.${i}.${i}-desktop`))
  }
})

describe("composition consistency", () => {
  const versions = ["1.0.0", "2.5.10", "27.3.1", "0.0.1", "100.200.300"]
  for (const v of versions) {
    test(`${v} composes through both functions correctly`, () => {
      const desktop = codeplaneDesktopReleaseVersion(v)
      const tag = codeplaneReleaseTag(desktop)
      expect(tag).toBe(codeplaneDesktopReleaseTag(v))
    })
  }
})
