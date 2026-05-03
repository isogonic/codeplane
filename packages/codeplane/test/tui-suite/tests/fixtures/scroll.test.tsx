import { describe, expect, test } from "bun:test"
import { withHarness } from "../../harness"
import { ScrollFixture } from "../../fixtures/scroll"

describe("tui-suite/fixtures/scroll", () => {
  test("renders initial 1-10 of 100", async () => {
    await withHarness(() => <ScrollFixture />, async (h) => {
      expect(h.find("showing 1-10 of 100")).not.toBeNull()
      expect(h.find("item 001")).not.toBeNull()
      expect(h.find("item 010")).not.toBeNull()
      expect(h.find("item 011")).toBeNull()
    })
  })

  test("down arrow advances offset by 1", async () => {
    await withHarness(() => <ScrollFixture />, async (h) => {
      await h.press("down")
      expect(h.find("item 002")).not.toBeNull()
      expect(h.find("item 011")).not.toBeNull()
    })
  })

  test("end jumps to bottom, home returns to top", async () => {
    await withHarness(() => <ScrollFixture />, async (h) => {
      await h.press("end")
      expect(h.find("showing 91-100 of 100")).not.toBeNull()
      await h.press("home")
      expect(h.find("showing 1-10 of 100")).not.toBeNull()
    })
  })

  test("page-down advances by visible window", async () => {
    await withHarness(() => <ScrollFixture />, async (h) => {
      await h.press("pagedown")
      expect(h.find("item 011")).not.toBeNull()
    })
  })

  test("custom count is reflected", async () => {
    await withHarness(() => <ScrollFixture count={20} />, async (h) => {
      expect(h.find("showing 1-10 of 20")).not.toBeNull()
    })
  })
})
