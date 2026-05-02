import { describe, expect, test } from "bun:test"
import { scrollKey } from "./scroll-view"

const baseEvent = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

describe("scrollKey navigation mappings", () => {
  test("PageDown -> page-down", () => {
    expect(scrollKey({ ...baseEvent, key: "PageDown" })).toBe("page-down")
  })

  test("PageUp -> page-up", () => {
    expect(scrollKey({ ...baseEvent, key: "PageUp" })).toBe("page-up")
  })

  test("Home -> home", () => {
    expect(scrollKey({ ...baseEvent, key: "Home" })).toBe("home")
  })

  test("End -> end", () => {
    expect(scrollKey({ ...baseEvent, key: "End" })).toBe("end")
  })

  test("ArrowUp -> up", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowUp" })).toBe("up")
  })

  test("ArrowDown -> down", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowDown" })).toBe("down")
  })
})

describe("scrollKey ignores modifiers", () => {
  test("alt+ArrowUp", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowUp", altKey: true })).toBeUndefined()
  })

  test("ctrl+ArrowDown", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowDown", ctrlKey: true })).toBeUndefined()
  })

  test("meta+ArrowUp", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowUp", metaKey: true })).toBeUndefined()
  })

  test("shift+ArrowDown", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowDown", shiftKey: true })).toBeUndefined()
  })

  test("ctrl+shift+End", () => {
    expect(scrollKey({ ...baseEvent, key: "End", ctrlKey: true, shiftKey: true })).toBeUndefined()
  })
})

describe("scrollKey unknown keys", () => {
  test("returns undefined for letter keys", () => {
    expect(scrollKey({ ...baseEvent, key: "a" })).toBeUndefined()
  })

  test("returns undefined for Enter", () => {
    expect(scrollKey({ ...baseEvent, key: "Enter" })).toBeUndefined()
  })

  test("returns undefined for Escape", () => {
    expect(scrollKey({ ...baseEvent, key: "Escape" })).toBeUndefined()
  })

  test("returns undefined for empty key", () => {
    expect(scrollKey({ ...baseEvent, key: "" })).toBeUndefined()
  })

  test("returns undefined for ArrowLeft", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowLeft" })).toBeUndefined()
  })

  test("returns undefined for ArrowRight", () => {
    expect(scrollKey({ ...baseEvent, key: "ArrowRight" })).toBeUndefined()
  })

  test("returns undefined for digit", () => {
    expect(scrollKey({ ...baseEvent, key: "5" })).toBeUndefined()
  })

  test("returns undefined for space", () => {
    expect(scrollKey({ ...baseEvent, key: " " })).toBeUndefined()
  })
})

describe("scrollKey case sensitivity", () => {
  test("'pagedown' (lowercase) does not match", () => {
    expect(scrollKey({ ...baseEvent, key: "pagedown" })).toBeUndefined()
  })

  test("'arrowup' (lowercase) does not match", () => {
    expect(scrollKey({ ...baseEvent, key: "arrowup" })).toBeUndefined()
  })
})
