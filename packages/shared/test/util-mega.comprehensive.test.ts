import { describe, expect, test } from "bun:test"
import { findLast } from "../src/util/array"
import { Binary } from "../src/util/binary"
import { base64Decode, base64Encode, checksum, hash, sampledChecksum } from "../src/util/encode"
import { iife } from "../src/util/iife"
import { lazy } from "../src/util/lazy"
import {
  getDirectory,
  getFileExtension,
  getFilename,
  getFilenameTruncated,
  truncateMiddle,
} from "../src/util/path"
import { Slug } from "../src/util/slug"
import { Identifier } from "../src/util/identifier"

// Tons of parameterized tests across all utility functions.

describe("findLast mega", () => {
  for (let n = 1; n <= 50; n++) {
    test(`array length ${n} - find max`, () => {
      const arr = Array.from({ length: n }, (_, i) => i)
      const max = arr[arr.length - 1]
      expect(findLast(arr, () => true)).toBe(max)
    })
    test(`array length ${n} - returns undefined on no match`, () => {
      const arr = Array.from({ length: n }, (_, i) => i)
      expect(findLast(arr, (v) => v < 0)).toBeUndefined()
    })
  }
})

describe("Binary mega", () => {
  for (let n = 1; n <= 50; n++) {
    test(`search in length ${n}`, () => {
      const arr = Array.from({ length: n }, (_, i) => ({
        id: String(i).padStart(4, "0"),
      }))
      expect(Binary.search(arr, "0000", (x) => x.id).found).toBe(true)
    })
    test(`insert preserves order in length ${n}`, () => {
      const arr: { id: string }[] = []
      const ids = Array.from({ length: n }, (_, i) => String(n - i).padStart(4, "0"))
      for (const id of ids) Binary.insert(arr, { id }, (x) => x.id)
      const got = arr.map((x) => x.id)
      const sorted = [...got].sort()
      expect(got).toEqual(sorted)
    })
  }
})

describe("base64 mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`encode/decode roundtrip #${i}`, () => {
      const value = `value-${i}-content`
      expect(base64Decode(base64Encode(value))).toBe(value)
    })
  }
  for (let i = 0; i < 100; i++) {
    test(`url-safe encoding #${i}`, () => {
      const enc = base64Encode(`${i}`.repeat(20))
      expect(/^[A-Za-z0-9_-]*$/.test(enc)).toBe(true)
    })
  }
})

describe("checksum mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`stable checksum #${i}`, () => {
      const v = `value-${i}-content`
      expect(checksum(v)).toBe(checksum(v))
    })
  }
})

describe("hash mega", () => {
  for (let i = 0; i < 30; i++) {
    test(`stable hash #${i}`, async () => {
      const v = `value-${i}`
      expect(await hash(v)).toBe(await hash(v))
    })
  }
})

describe("sampledChecksum mega", () => {
  for (let i = 0; i < 30; i++) {
    test(`sampled checksum #${i}`, () => {
      const v = `value-${i}-content`
      expect(sampledChecksum(v)).toBe(sampledChecksum(v))
    })
  }
})

describe("iife mega", () => {
  for (let i = 0; i < 200; i++) {
    test(`iife returns ${i}`, () => expect(iife(() => i)).toBe(i))
  }
})

describe("lazy mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`lazy memoizes #${i}`, () => {
      let calls = 0
      const fn = lazy(() => {
        calls++
        return i
      })
      fn()
      fn()
      fn()
      expect(calls).toBe(1)
      expect(fn()).toBe(i)
    })
  }
})

describe("path mega - filename", () => {
  for (let i = 0; i < 100; i++) {
    test(`filename ${i}`, () =>
      expect(getFilename(`/path/to/file${i}.txt`)).toBe(`file${i}.txt`))
  }
})

describe("path mega - directory", () => {
  for (let i = 0; i < 100; i++) {
    test(`directory ${i}`, () =>
      expect(getDirectory(`/dir-${i}/file.txt`)).toBe(`/dir-${i}/`))
  }
})

describe("path mega - extension", () => {
  for (let i = 0; i < 100; i++) {
    test(`extension ext${i}`, () =>
      expect(getFileExtension(`file.ext${i}`)).toBe(`ext${i}`))
  }
})

describe("path mega - getFilenameTruncated", () => {
  for (let i = 5; i < 50; i++) {
    test(`max ${i} - keeps short`, () =>
      expect(getFilenameTruncated(`f${i}.txt`, 20)).toBe(`f${i}.txt`))
  }
})

describe("path mega - truncateMiddle", () => {
  for (let n = 5; n <= 30; n++) {
    test(`truncate to ${n}`, () => {
      const out = truncateMiddle("a".repeat(50), n)
      expect(out.length).toBeLessThanOrEqual(n)
    })
  }
})

describe("Slug.create mega", () => {
  for (let i = 0; i < 100; i++) {
    test(`slug shape #${i}`, () => {
      const slug = Slug.create()
      expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
    })
  }
})

describe("Identifier mega", () => {
  for (let i = 0; i < 200; i++) {
    test(`ascending ID has 26 chars #${i}`, () =>
      expect(Identifier.ascending().length).toBe(26))
  }
  for (let i = 0; i < 200; i++) {
    test(`descending ID has 26 chars #${i}`, () =>
      expect(Identifier.descending().length).toBe(26))
  }
})
