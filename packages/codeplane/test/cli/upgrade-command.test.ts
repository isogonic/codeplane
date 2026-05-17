import { describe, expect, test } from "bun:test"
import { normalizeUpgradeTarget } from "../../src/cli/cmd/upgrade"

describe("upgrade cli helpers", () => {
  test("normalizes lower and upper-case v prefixes", () => {
    expect(normalizeUpgradeTarget("v28.1.25")).toBe("28.1.25")
    expect(normalizeUpgradeTarget("V28.1.25")).toBe("28.1.25")
    expect(normalizeUpgradeTarget("28.1.25")).toBe("28.1.25")
  })
})
