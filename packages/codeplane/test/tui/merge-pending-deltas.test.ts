import { describe, expect, test } from "bun:test"
import { mergePendingDeltas } from "@/tui/context/sync"

// Locks the buffered-delta merge used when a part snapshot arrives AFTER some
// message.part.delta events were buffered (the session-open snapshot-vs-SSE
// race). Mirrors the web app's tested mergePendingDeltas semantics.
describe("mergePendingDeltas", () => {
  test("appends a buffered delta the snapshot predates (race) — text isn't lost", () => {
    const part = { id: "p1", messageID: "m1", type: "text", text: "hello" } as any
    const merged = mergePendingDeltas(part, { text: " world" }) as any
    expect(merged.text).toBe("hello world")
  })

  test("no-op when the snapshot already includes the buffered delta", () => {
    const part = { id: "p1", messageID: "m1", type: "text", text: "hello world" } as any
    const merged = mergePendingDeltas(part, { text: " world" }) as any
    expect(merged.text).toBe("hello world")
    // unchanged → returns the same reference
    expect(merged).toBe(part)
  })

  test("sets the field when the snapshot has none yet", () => {
    const part = { id: "p1", messageID: "m1", type: "text" } as any
    const merged = mergePendingDeltas(part, { text: "streamed" }) as any
    expect(merged.text).toBe("streamed")
  })

  test("ignores empty deltas and leaves non-string fields alone", () => {
    const part = { id: "p1", messageID: "m1", type: "text", text: "abc" } as any
    expect(mergePendingDeltas(part, { text: "" })).toBe(part)
  })

  test("merges multiple buffered fields independently", () => {
    const part = { id: "p1", messageID: "m1", type: "text", text: "a", extra: "x" } as any
    const merged = mergePendingDeltas(part, { text: "b", extra: "y" }) as any
    expect(merged.text).toBe("ab")
    expect(merged.extra).toBe("xy")
  })
})
