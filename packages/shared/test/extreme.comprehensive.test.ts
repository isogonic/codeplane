import { describe, expect, test } from "bun:test"
import { findLast } from "../src/util/array"
import { Binary } from "../src/util/binary"
import { base64Decode, base64Encode, checksum } from "../src/util/encode"
import { iife } from "../src/util/iife"
import { lazy } from "../src/util/lazy"
import { Identifier } from "../src/util/identifier"
import { Slug } from "../src/util/slug"
import {
  getDirectory,
  getFileExtension,
  getFilename,
  getFilenameTruncated,
  truncateMiddle,
} from "../src/util/path"
import { formatHeaders, parseHeaders } from "../src/headers"
import { localInstanceUrl } from "../src/instance"
import { codeplaneDesktopReleaseTag, codeplaneReleaseTag } from "../src/version"

// Massive bulk-parameterized tests targeting basically every utility function
// across many input variants.

describe("EXTREME - findLast across hundreds of arrays", () => {
  for (let n = 1; n <= 200; n++) {
    test(`length ${n} max`, () => {
      const arr = Array.from({ length: n }, (_, i) => i)
      expect(findLast(arr, () => true)).toBe(n - 1)
    })
  }
})

describe("EXTREME - Binary search across hundreds", () => {
  for (let n = 1; n <= 100; n++) {
    test(`search end of length ${n}`, () => {
      const arr = Array.from({ length: n }, (_, i) => ({
        id: String(i).padStart(4, "0"),
      }))
      const target = String(n - 1).padStart(4, "0")
      expect(Binary.search(arr, target, (x) => x.id).found).toBe(true)
    })
  }
  for (let n = 1; n <= 100; n++) {
    test(`search beyond end of length ${n}`, () => {
      const arr = Array.from({ length: n }, (_, i) => ({
        id: String(i).padStart(4, "0"),
      }))
      const target = "9999"
      const result = Binary.search(arr, target, (x) => x.id)
      expect(result.found).toBe(false)
    })
  }
})

describe("EXTREME - base64 round trips with many lengths", () => {
  for (let len = 0; len < 200; len++) {
    test(`length ${len}`, () => {
      const value = "a".repeat(len)
      expect(base64Decode(base64Encode(value))).toBe(value)
    })
  }
})

describe("EXTREME - checksum stability", () => {
  for (let i = 0; i < 200; i++) {
    test(`stable checksum #${i}`, () => {
      const v = `value-${i}`
      expect(checksum(v)).toBe(checksum(v))
    })
  }
})

describe("EXTREME - iife", () => {
  for (let i = 0; i < 300; i++) {
    test(`iife #${i}`, () => expect(iife(() => i * 2)).toBe(i * 2))
  }
})

describe("EXTREME - lazy", () => {
  for (let i = 0; i < 200; i++) {
    test(`lazy memo #${i}`, () => {
      let calls = 0
      const fn = lazy(() => {
        calls++
        return i
      })
      fn()
      fn()
      fn()
      fn()
      fn()
      expect(calls).toBe(1)
      expect(fn()).toBe(i)
    })
  }
})

describe("EXTREME - Identifier uniqueness", () => {
  for (let i = 0; i < 300; i++) {
    test(`ascending id #${i}`, () => {
      const id = Identifier.ascending()
      expect(id.length).toBe(26)
      expect(id).toMatch(/^[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    })
  }
  for (let i = 0; i < 300; i++) {
    test(`descending id #${i}`, () => {
      const id = Identifier.descending()
      expect(id.length).toBe(26)
    })
  }
})

describe("EXTREME - Slug", () => {
  for (let i = 0; i < 200; i++) {
    test(`slug shape #${i}`, () => {
      expect(Slug.create()).toMatch(/^[a-z]+-[a-z]+$/)
    })
  }
})

describe("EXTREME - filename / dir / ext", () => {
  for (let i = 0; i < 200; i++) {
    test(`filename ${i}`, () =>
      expect(getFilename(`/foo/bar/file${i}.txt`)).toBe(`file${i}.txt`))
    test(`directory ${i}`, () =>
      expect(getDirectory(`/path${i}/file.txt`)).toBe(`/path${i}/`))
    test(`extension ${i}`, () =>
      expect(getFileExtension(`file.ext${i}`)).toBe(`ext${i}`))
  }
})

describe("EXTREME - filename truncated", () => {
  for (let n = 5; n < 50; n++) {
    test(`max length ${n} short stays`, () =>
      expect(getFilenameTruncated("a.txt", n)).toBe("a.txt"))
  }
})

describe("EXTREME - truncateMiddle", () => {
  for (let n = 5; n < 100; n++) {
    test(`max length ${n} long`, () => {
      const out = truncateMiddle("a".repeat(200), n)
      expect(out.length).toBeLessThanOrEqual(n)
    })
  }
})

describe("EXTREME - parseHeaders synthesized", () => {
  for (let i = 0; i < 300; i++) {
    test(`header H${i}: V${i}`, () =>
      expect(parseHeaders(`H${i}: V${i}`)).toEqual({ [`H${i}`]: `V${i}` }))
  }
})

describe("EXTREME - formatHeaders", () => {
  for (let i = 0; i < 300; i++) {
    test(`format H${i}`, () =>
      expect(formatHeaders({ [`H${i}`]: `V${i}` })).toBe(`H${i}: V${i}`))
  }
})

describe("EXTREME - localInstanceUrl", () => {
  for (let i = 0; i < 300; i++) {
    test(`localInstanceUrl id ${i}`, () =>
      expect(localInstanceUrl(`id-${i}`)).toBe(`local://id-${i}`))
  }
})

describe("EXTREME - codeplaneReleaseTag", () => {
  for (let major = 0; major < 30; major++) {
    for (let minor = 0; minor < 5; minor++) {
      const v = `${major}.${minor}.0`
      test(`tag ${v}`, () => expect(codeplaneReleaseTag(v)).toBe(`v${v}`))
    }
  }
})

describe("EXTREME - codeplaneDesktopReleaseTag", () => {
  for (let major = 0; major < 30; major++) {
    for (let minor = 0; minor < 5; minor++) {
      const v = `${major}.${minor}.0`
      test(`desktop tag ${v}`, () =>
        expect(codeplaneDesktopReleaseTag(v)).toBe(`v${v}-desktop`))
    }
  }
})
