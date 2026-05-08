import { describe, expect, test } from "bun:test"
import { ResumeBuffer } from "../../src/server/sse-resume-buffer"

describe("ResumeBuffer", () => {
  test("assigns monotonic ids starting at 1", () => {
    const buf = new ResumeBuffer(8)
    expect(buf.append("a")).toMatchObject({ id: 1, data: "a" })
    expect(buf.append("b")).toMatchObject({ id: 2, data: "b" })
    expect(buf.append("c")).toMatchObject({ id: 3, data: "c" })
  })

  test("rotates oldest events out at capacity", () => {
    const buf = new ResumeBuffer(3)
    buf.append("a")
    buf.append("b")
    buf.append("c")
    buf.append("d") // pushes 'a' out
    expect(buf.size).toBe(3)
    // 'a' (id 1) is gone; oldest should be 'b' (id 2)
    expect(buf.since(0)).toBeNull()
    expect(buf.since(1)).toEqual([
      { id: 2, data: "b" },
      { id: 3, data: "c" },
      { id: 4, data: "d" },
    ])
  })

  test("since(lastID) returns only events newer than lastID", () => {
    const buf = new ResumeBuffer(8)
    buf.append("a")
    buf.append("b")
    buf.append("c")
    expect(buf.since(1)).toEqual([
      { id: 2, data: "b" },
      { id: 3, data: "c" },
    ])
  })

  test("since matches client at the boundary id-1 of oldest", () => {
    // After rotation, oldest has id N. A client with Last-Event-ID = N-1
    // is exactly caught up to the boundary and should receive all
    // buffered events; anything older is unbridgeable.
    const buf = new ResumeBuffer(2)
    buf.append("a") // id 1
    buf.append("b") // id 2
    buf.append("c") // id 3 — pushes 'a' out
    expect(buf.since(1)).toEqual([
      { id: 2, data: "b" },
      { id: 3, data: "c" },
    ])
    expect(buf.since(0)).toBeNull()
  })

  test("since returns empty array when client is already caught up", () => {
    const buf = new ResumeBuffer(8)
    buf.append("a")
    buf.append("b")
    expect(buf.since(2)).toEqual([])
    expect(buf.since(99)).toEqual([])
  })

  test("since on empty buffer returns empty array, not null", () => {
    // Empty buffer means there is no rotation; the client just hasn't
    // missed anything yet. null is reserved for "definite gap."
    const buf = new ResumeBuffer(4)
    expect(buf.since(0)).toEqual([])
    expect(buf.since(100)).toEqual([])
  })

  test("nextId reflects monotonic counter after rotation", () => {
    const buf = new ResumeBuffer(2)
    buf.append("a")
    buf.append("b")
    buf.append("c")
    expect(buf.nextId).toBe(4) // next assignment will be id 4
    expect(buf.size).toBe(2)
  })

  test("rejects invalid capacity", () => {
    expect(() => new ResumeBuffer(0)).toThrow()
    expect(() => new ResumeBuffer(-1)).toThrow()
    expect(() => new ResumeBuffer(Number.NaN)).toThrow()
    expect(() => new ResumeBuffer(Infinity)).toThrow()
  })

  test("capacity 1 keeps only the latest event", () => {
    const buf = new ResumeBuffer(1)
    buf.append("a")
    buf.append("b")
    expect(buf.size).toBe(1)
    expect(buf.since(1)).toEqual([{ id: 2, data: "b" }])
    expect(buf.since(0)).toBeNull()
  })
})
