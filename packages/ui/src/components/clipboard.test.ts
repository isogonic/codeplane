import { afterEach, describe, expect, test } from "bun:test"
import { writeClipboardText } from "./clipboard"

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document")

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
  else Reflect.deleteProperty(globalThis, "navigator")
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument)
  else Reflect.deleteProperty(globalThis, "document")
})

describe("writeClipboardText", () => {
  test("uses the Clipboard API when available", async () => {
    let copied = ""
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async (value: string) => (copied = value) } },
    })

    expect(await writeClipboardText("hello")).toBe(true)
    expect(copied).toBe("hello")
  })

  test("falls back to execCommand when Clipboard API write fails", async () => {
    let selected = false
    let removed = false
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } },
    })
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: { append: () => {} },
        createElement: () => ({
          value: "",
          setAttribute: () => {},
          style: {},
          select: () => (selected = true),
          remove: () => (removed = true),
        }),
        execCommand: (command: string) => command === "copy",
      },
    })

    expect(await writeClipboardText("fallback")).toBe(true)
    expect(selected).toBe(true)
    expect(removed).toBe(true)
  })
})
