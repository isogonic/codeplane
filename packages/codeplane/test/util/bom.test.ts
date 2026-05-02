import { describe, expect, test } from "bun:test"
import { split, join } from "../../src/util/bom"

describe("BOM split", () => {
  test("returns text without BOM as-is", () => {
    expect(split("hello")).toEqual({ bom: false, text: "hello" })
  })

  test("removes BOM and reports presence", () => {
    expect(split("﻿hello")).toEqual({ bom: true, text: "hello" })
  })

  test("empty string", () => {
    expect(split("")).toEqual({ bom: false, text: "" })
  })

  test("BOM-only", () => {
    expect(split("﻿")).toEqual({ bom: true, text: "" })
  })

  test("multiple BOMs only strips first", () => {
    const r = split("﻿﻿x")
    expect(r.bom).toBe(true)
    expect(r.text).toBe("﻿x")
  })

  test("BOM in middle is preserved", () => {
    expect(split("a﻿b")).toEqual({ bom: false, text: "a﻿b" })
  })

  test("preserves multi-byte unicode after BOM", () => {
    expect(split("﻿héllo")).toEqual({ bom: true, text: "héllo" })
  })
})

describe("BOM join", () => {
  test("returns text without BOM when bom=false", () => {
    expect(join("hello", false)).toBe("hello")
  })

  test("prepends BOM when bom=true", () => {
    expect(join("hello", true)).toBe("﻿hello")
  })

  test("strips existing BOM before applying flag", () => {
    expect(join("﻿hello", true)).toBe("﻿hello")
    expect(join("﻿hello", false)).toBe("hello")
  })

  test("empty string with bom=true returns just BOM", () => {
    expect(join("", true)).toBe("﻿")
  })

  test("empty string with bom=false returns empty", () => {
    expect(join("", false)).toBe("")
  })

  test("split-join roundtrip preserves content (bom=true)", () => {
    const original = "﻿héllo world"
    const { bom, text } = split(original)
    expect(join(text, bom)).toBe(original)
  })

  test("split-join roundtrip preserves content (no bom)", () => {
    const original = "héllo world"
    const { bom, text } = split(original)
    expect(join(text, bom)).toBe(original)
  })
})
