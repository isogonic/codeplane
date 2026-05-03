import { describe, expect, test } from "bun:test"
import { mount, withHarness, parseChord, KeyCodes, diffFrames, frameToText } from "../harness"
import { ListFixture } from "../fixtures/list"
import { InputFixture } from "../fixtures/input"
import { DialogFixture } from "../fixtures/dialog"

describe("tui-suite/harness", () => {
  test("mount + frame() returns a sized snapshot", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const f = h.frame()
      expect(f.cols).toBeGreaterThan(0)
      expect(f.rows).toBeGreaterThan(0)
      expect(f.lines.length).toBe(f.rows)
      expect(typeof f.text).toBe("string")
    })
  })

  test("find() locates rendered text and returns row/col", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const found = h.find("Alpha")
      expect(found).not.toBeNull()
      expect(found!.row).toBeGreaterThanOrEqual(0)
      expect(found!.col).toBeGreaterThanOrEqual(0)
    })
  })

  test("findAll returns every match", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const all = h.findAll(/[A-E]\w+/)
      expect(all.length).toBeGreaterThanOrEqual(5)
    })
  })

  test("press('down') advances list selection", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      // Initial state: cursor on "Alpha"
      expect(h.find("▸ Alpha")).not.toBeNull()
      await h.press("down")
      expect(h.find("▸ Bravo")).not.toBeNull()
      await h.press("down")
      expect(h.find("▸ Charlie")).not.toBeNull()
    })
  })

  test("press('up') backs off, clamped at top", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      await h.press("up")
      expect(h.find("▸ Alpha")).not.toBeNull()
    })
  })

  test("press('end') jumps to last, press('home') to first", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      await h.press("end")
      expect(h.find("▸ Echo")).not.toBeNull()
      await h.press("home")
      expect(h.find("▸ Alpha")).not.toBeNull()
    })
  })

  test("press('enter') selects highlighted item", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      await h.pressSeq(["down", "down", "enter"])
      expect(h.find("Selected: Charlie")).not.toBeNull()
    })
  })

  test("type() pushes characters into focused input", async () => {
    await withHarness(() => <InputFixture />, async (h) => {
      await h.type("hello")
      expect(h.find("hello")).not.toBeNull()
    })
  })

  test("type + enter submits and clears input", async () => {
    await withHarness(() => <InputFixture />, async (h) => {
      await h.type("first")
      await h.press("enter")
      expect(h.find("History (1)")).not.toBeNull()
      expect(h.find("first")).not.toBeNull()
    })
  })

  test("dialog opens on 'o', confirms on 'y'", async () => {
    await withHarness(() => <DialogFixture />, async (h) => {
      expect(h.find("Status: pending")).not.toBeNull()
      await h.press("o")
      expect(h.find("Are you sure?")).not.toBeNull()
      await h.press("y")
      expect(h.find("Status: CONFIRMED")).not.toBeNull()
    })
  })

  test("dialog closes on Escape without confirming", async () => {
    await withHarness(() => <DialogFixture />, async (h) => {
      await h.press("o")
      expect(h.find("Are you sure?")).not.toBeNull()
      await h.press("escape")
      expect(h.find("Are you sure?")).toBeNull()
      expect(h.find("Status: pending")).not.toBeNull()
    })
  })

  test("waitForText resolves once content appears", async () => {
    const h = await mount(() => <ListFixture />)
    try {
      await h.waitForText("Echo", 1000)
    } finally {
      await h.unmount()
    }
  })

  test("resize(width, height) updates frame dims", async () => {
    await withHarness(
      () => <ListFixture />,
      async (h) => {
        await h.resize(40, 15)
        const f = h.frame()
        expect(f.cols).toBe(40)
        expect(f.rows).toBe(15)
      },
      { width: 100, height: 30 },
    )
  })

  test("unmount() is idempotent", async () => {
    const h = await mount(() => <ListFixture />)
    await h.unmount()
    await h.unmount() // should not throw
  })
})

describe("tui-suite/keys", () => {
  test("parseChord parses simple key", () => {
    expect(parseChord("a")).toEqual({ key: "a", modifiers: {} })
  })
  test("parseChord parses ctrl+a", () => {
    expect(parseChord("ctrl+a")).toEqual({ key: "a", modifiers: { ctrl: true } })
  })
  test("parseChord parses shift+tab", () => {
    expect(parseChord("shift+tab")).toEqual({ key: "TAB", modifiers: { shift: true } })
  })
  test("parseChord parses arrow names", () => {
    expect(parseChord("up").key).toBe("ARROW_UP")
    expect(parseChord("down").key).toBe("ARROW_DOWN")
    expect(parseChord("left").key).toBe("ARROW_LEFT")
    expect(parseChord("right").key).toBe("ARROW_RIGHT")
  })
  test("parseChord parses cmd as super", () => {
    expect(parseChord("cmd+k")).toEqual({ key: "k", modifiers: { super: true } })
  })
  test("parseChord recognizes function keys", () => {
    expect(parseChord("f5").key).toBe("F5")
  })
  test("KeyCodes constants are stable", () => {
    expect(KeyCodes.ARROW_UP).toBe("[A")
    expect(KeyCodes.RETURN).toBe("\r")
  })
})

describe("tui-suite/snapshot", () => {
  test("diffFrames returns empty for identical input", () => {
    expect(diffFrames("a\nb", "a\nb")).toBe("")
  })
  test("diffFrames reports differing rows", () => {
    const out = diffFrames("a\nb\nc", "a\nB\nc")
    expect(out).toContain("@ row 1")
    expect(out).toContain("- b")
    expect(out).toContain("+ B")
  })
  test("frameToText returns frame.text", async () => {
    await withHarness(() => <ListFixture />, async (h) => {
      const f = h.frame()
      expect(frameToText(f)).toBe(f.text)
    })
  })
})
