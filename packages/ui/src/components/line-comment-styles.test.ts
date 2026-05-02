import { describe, expect, test } from "bun:test"
import { lineCommentStyles, installLineCommentStyles } from "./line-comment-styles"

describe("lineCommentStyles", () => {
  test("is a non-empty string", () => {
    expect(typeof lineCommentStyles).toBe("string")
    expect(lineCommentStyles.length).toBeGreaterThan(0)
  })

  test("contains base CSS rules", () => {
    expect(lineCommentStyles).toContain("[data-component=\"line-comment\"]")
  })

  test("contains line-comment-button selector", () => {
    expect(lineCommentStyles).toContain("[data-slot=\"line-comment-button\"]")
  })

  test("contains line-comment-popover selector", () => {
    expect(lineCommentStyles).toContain("[data-slot=\"line-comment-popover\"]")
  })

  test("contains data-inline modifier", () => {
    expect(lineCommentStyles).toContain("[data-inline]")
  })

  test("contains data-variant modifier", () => {
    expect(lineCommentStyles).toContain("[data-variant=")
  })

  test("uses CSS custom properties (var())", () => {
    expect(lineCommentStyles).toContain("var(--")
  })

  test("contains z-index custom property", () => {
    expect(lineCommentStyles).toContain("--line-comment-z")
  })

  test("contains add variant styles", () => {
    expect(lineCommentStyles).toContain("[data-variant=\"add\"]")
  })

  test("contains editor variant styles", () => {
    expect(lineCommentStyles).toContain("[data-variant=\"editor\"]")
  })

  test("contains primary action variant", () => {
    expect(lineCommentStyles).toContain("[data-variant=\"primary\"]")
  })

  test("contains ghost action variant", () => {
    expect(lineCommentStyles).toContain("[data-variant=\"ghost\"]")
  })

  test("contains :disabled state", () => {
    expect(lineCommentStyles).toContain(":disabled")
  })

  test("contains focus-visible state", () => {
    expect(lineCommentStyles).toContain(":focus-visible")
  })
})

describe("installLineCommentStyles", () => {
  test("does not throw without document", () => {
    expect(() => installLineCommentStyles()).not.toThrow()
  })

  test("idempotent (no error on second call)", () => {
    installLineCommentStyles()
    expect(() => installLineCommentStyles()).not.toThrow()
  })
})
