import { describe, expect, test } from "bun:test"
import { withHarness } from "../../harness"
import { ErrorBoundaryFixture } from "../../fixtures/error-boundary"

describe("tui-suite/fixtures/error-boundary", () => {
  test("renders no-error initial state", async () => {
    await withHarness(() => <ErrorBoundaryFixture />, async (h) => {
      expect(h.find("no errors here")).not.toBeNull()
    })
  })

  test("'x' triggers boundary, 'r' recovers", async () => {
    await withHarness(() => <ErrorBoundaryFixture />, async (h) => {
      await h.press("x")
      expect(h.find("[error boundary]")).not.toBeNull()
      expect(h.find("intentional crash for fixture")).not.toBeNull()
      await h.press("r")
      expect(h.find("no errors here")).not.toBeNull()
    })
  })
})
