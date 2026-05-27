import { describe, expect, test } from "bun:test"
import { refreshPromptInputLayout } from "@/tui/component/prompt"

type PromptLayoutInput = NonNullable<Parameters<typeof refreshPromptInputLayout>[0]>

function input(calls: string[], isDestroyed = false) {
  return {
    isDestroyed,
    getLayoutNode: () => ({
      markDirty: () => {
        calls.push("markDirty")
      },
    }),
    gotoBufferEnd: () => {
      calls.push("gotoBufferEnd")
      return true
    },
  } as unknown as PromptLayoutInput
}

function renderer(calls: string[]) {
  return {
    requestRender: () => calls.push("requestRender"),
  }
}

describe("refreshPromptInputLayout", () => {
  test("marks layout dirty, moves cursor, and requests render synchronously for appended text", () => {
    const calls: string[] = []
    const refreshed = refreshPromptInputLayout(input(calls), renderer(calls), { gotoEnd: true })

    expect(refreshed).toBe(true)
    expect(calls).toEqual(["markDirty", "gotoBufferEnd", "requestRender"])
  })

  test("marks layout dirty and requests render synchronously for pasted text", () => {
    const calls: string[] = []
    const refreshed = refreshPromptInputLayout(input(calls), renderer(calls))

    expect(refreshed).toBe(true)
    expect(calls).toEqual(["markDirty", "requestRender"])
  })

  test("does not touch destroyed inputs", () => {
    const calls: string[] = []
    const refreshed = refreshPromptInputLayout(input(calls, true), renderer(calls), { gotoEnd: true })

    expect(refreshed).toBe(false)
    expect(calls).toEqual([])
  })
})
