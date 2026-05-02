import { describe, expect, test } from "bun:test"
import {
  CodeplaneVersion,
  codeplaneDesktopReleaseTag,
  codeplaneDesktopReleaseVersion,
  codeplaneReleaseTag,
} from "../src/version"

describe("version mega - extensive bulk version tagging", () => {
  for (let major = 0; major < 10; major++) {
    for (let minor = 0; minor < 10; minor++) {
      const version = `${major}.${minor}.0`
      test(`tag for ${version}`, () =>
        expect(codeplaneReleaseTag(version)).toBe(`v${version}`))
      test(`desktop version for ${version}`, () =>
        expect(codeplaneDesktopReleaseVersion(version)).toBe(`${version}-desktop`))
      test(`desktop tag for ${version}`, () =>
        expect(codeplaneDesktopReleaseTag(version)).toBe(`v${version}-desktop`))
    }
  }
})

describe("version mega - default usage stable", () => {
  for (let i = 0; i < 50; i++) {
    test(`default tag #${i}`, () =>
      expect(codeplaneReleaseTag()).toBe(`v${CodeplaneVersion}`))
    test(`default desktop version #${i}`, () =>
      expect(codeplaneDesktopReleaseVersion()).toBe(`${CodeplaneVersion}-desktop`))
    test(`default desktop tag #${i}`, () =>
      expect(codeplaneDesktopReleaseTag()).toBe(`v${CodeplaneVersion}-desktop`))
  }
})

describe("version mega - prerelease combinations", () => {
  const prereleases = ["rc.0", "rc.1", "alpha.1", "beta.2", "next.3"]
  for (const tag of prereleases) {
    for (let i = 0; i < 10; i++) {
      const version = `1.${i}.0-${tag}`
      test(`tag for ${version}`, () =>
        expect(codeplaneReleaseTag(version)).toBe(`v${version}`))
    }
  }
})
