import { describe, expect, test } from "bun:test"
import { isSafeExternalHref } from "@/tui/ui/link"

describe("tui link safety", () => {
  test("allows only http and https external links", () => {
    expect(isSafeExternalHref("https://example.com/oauth")).toBe(true)
    expect(isSafeExternalHref("http://localhost:3000/auth")).toBe(true)
    expect(isSafeExternalHref("file:///Users/devin/.ssh/id_rsa")).toBe(false)
    expect(isSafeExternalHref("javascript:alert(1)")).toBe(false)
    expect(isSafeExternalHref("ssh://example.com")).toBe(false)
    expect(isSafeExternalHref("not a url")).toBe(false)
  })
})
