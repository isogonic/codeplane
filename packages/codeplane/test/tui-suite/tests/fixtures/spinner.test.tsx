import { describe, expect, test } from "bun:test"
import { withHarness } from "../../harness"
import { SpinnerFixture } from "../../fixtures/spinner"

describe("tui-suite/fixtures/spinner", () => {
  test("renders the label", async () => {
    await withHarness(() => <SpinnerFixture label="Loading widgets..." />, async (h) => {
      expect(h.find("Loading widgets...")).not.toBeNull()
    })
  })

  test("frame advances over time", async () => {
    await withHarness(() => <SpinnerFixture intervalMs={20} />, async (h) => {
      const initial = h.text()
      await new Promise((r) => setTimeout(r, 80))
      await h.settle()
      const later = h.text()
      // We can't assert which braille char advanced (any is fine), but the frame should change.
      expect(later).not.toBe(initial)
    })
  })
})
