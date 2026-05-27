import { describe, expect, test } from "bun:test"
import { createPacedValue } from "./message-part-pacing"

describe("message part pacing", () => {
  test("does not add an artificial typewriter delay to streamed text", () => {
    let value = ""
    const displayed = createPacedValue(() => value)

    value = "hello world"
    expect(displayed()).toBe("hello world")

    value = "hello world".repeat(100)
    expect(displayed()).toBe(value)
  })
})
