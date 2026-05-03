import { describe, expect, test } from "bun:test"
import { withHarness, frameToText, frameToAnsi, frameToHtml, trimFrame, diffFrames } from "../harness"
import { ListFixture } from "../fixtures/list"

describe("tui-suite/snapshot serializers", () => {
  test("frameToText returns frame.text", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const f = h.frame()
      expect(frameToText(f)).toBe(f.text)
    })
  })

  test("trimFrame strips trailing whitespace per row", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const f = h.frame()
      const trimmed = trimFrame(f)
      for (const row of trimmed.split("\n")) {
        expect(row).toBe(row.replace(/\s+$/, ""))
      }
    })
  })

  test("frameToAnsi includes the rendered text content", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const ansi = frameToAnsi(h.frame())
      expect(ansi).toContain("Alpha")
      expect(ansi).toContain("Bravo")
      // ANSI escape sequences begin with ESC [
      expect(/\[/.test(ansi)).toBe(true)
    })
  })

  test("frameToHtml renders <span> per styled run", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const html = frameToHtml(h.frame())
      expect(html).toContain("<span")
      expect(html).toContain("Alpha")
      expect(html).toContain("color:rgba(")
    })
  })

  test("diffFrames is empty when frames are stable across no-op", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const a = trimFrame(h.frame())
      await h.settle()
      const b = trimFrame(h.frame())
      expect(diffFrames(a, b)).toBe("")
    })
  })

  test("diffFrames shows changed rows after navigation", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const a = trimFrame(h.frame())
      await h.press("down")
      const b = trimFrame(h.frame())
      const d = diffFrames(a, b)
      expect(d.length).toBeGreaterThan(0)
      expect(d).toContain("@ row")
    })
  })
})
