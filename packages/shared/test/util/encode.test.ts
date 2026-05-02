import { describe, expect, test } from "bun:test"
import { base64Encode, base64Decode, hash, checksum, sampledChecksum } from "../../src/util/encode"

describe("base64Encode", () => {
  test("encodes empty string", () => {
    expect(base64Encode("")).toBe("")
  })

  test("encodes simple ASCII", () => {
    expect(base64Encode("hello")).toBe("aGVsbG8")
  })

  test("encodes single character", () => {
    expect(base64Encode("a")).toBe("YQ")
  })

  test("encodes two characters", () => {
    expect(base64Encode("ab")).toBe("YWI")
  })

  test("encodes three characters (no padding needed)", () => {
    expect(base64Encode("abc")).toBe("YWJj")
  })

  test("strips standard base64 padding", () => {
    expect(base64Encode("a")).not.toContain("=")
    expect(base64Encode("ab")).not.toContain("=")
  })

  test("uses URL-safe characters", () => {
    const out = base64Encode("ÿÿÿ")
    expect(out).not.toContain("+")
    expect(out).not.toContain("/")
  })

  test("encodes unicode (UTF-8)", () => {
    expect(base64Encode("héllo")).toBe("aMOpbGxv")
  })

  test("encodes emoji", () => {
    expect(base64Encode("🚀")).toBe("8J-agA")
  })

  test("encodes longer text", () => {
    expect(base64Encode("The quick brown fox")).toBe("VGhlIHF1aWNrIGJyb3duIGZveA")
  })

  test("encodes whitespace and special chars", () => {
    const v = base64Encode(" \t\n!@#$%^&*()")
    expect(typeof v).toBe("string")
    expect(v.length).toBeGreaterThan(0)
  })

  test("does not contain padding characters", () => {
    for (const s of ["a", "ab", "abc", "abcd", "abcde"]) {
      expect(base64Encode(s)).not.toMatch(/=/)
    }
  })

  test("output is roundtrippable through base64Decode", () => {
    for (const s of ["", "a", "héllo", "🚀", "with\nnewline"]) {
      expect(base64Decode(base64Encode(s))).toBe(s)
    }
  })
})

describe("base64Decode", () => {
  test("decodes empty string", () => {
    expect(base64Decode("")).toBe("")
  })

  test("decodes simple ASCII", () => {
    expect(base64Decode("aGVsbG8")).toBe("hello")
  })

  test("decodes URL-safe (- and _)", () => {
    const encoded = base64Encode("ÿÿÿ")
    expect(base64Decode(encoded)).toBe("ÿÿÿ")
  })

  test("decodes unicode", () => {
    expect(base64Decode("aMOpbGxv")).toBe("héllo")
  })

  test("decodes emoji", () => {
    expect(base64Decode("8J-agA")).toBe("🚀")
  })

  test("roundtrip empty and short strings", () => {
    for (const s of ["", "a", "ab", "abc", "abcd"]) {
      expect(base64Decode(base64Encode(s))).toBe(s)
    }
  })

  test("roundtrip longer strings", () => {
    const long = "x".repeat(1000)
    expect(base64Decode(base64Encode(long))).toBe(long)
  })

  test("roundtrip with all printable ASCII", () => {
    let s = ""
    for (let i = 32; i < 127; i++) s += String.fromCharCode(i)
    expect(base64Decode(base64Encode(s))).toBe(s)
  })
})

describe("hash", () => {
  test("returns hex string of expected length for SHA-256", async () => {
    const result = await hash("hello")
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  test("same input produces same hash", async () => {
    expect(await hash("hello")).toBe(await hash("hello"))
  })

  test("different inputs produce different hashes", async () => {
    expect(await hash("hello")).not.toBe(await hash("world"))
  })

  test("empty string produces SHA-256 of empty string", async () => {
    expect(await hash("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  })

  test("known SHA-256 value", async () => {
    expect(await hash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  })

  test("supports SHA-1 algorithm", async () => {
    const result = await hash("hello", "SHA-1")
    expect(result).toMatch(/^[0-9a-f]{40}$/)
  })

  test("SHA-1 known value", async () => {
    expect(await hash("abc", "SHA-1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d")
  })

  test("supports SHA-512 algorithm", async () => {
    const result = await hash("hello", "SHA-512")
    expect(result).toMatch(/^[0-9a-f]{128}$/)
  })

  test("supports SHA-384 algorithm", async () => {
    const result = await hash("hello", "SHA-384")
    expect(result).toMatch(/^[0-9a-f]{96}$/)
  })

  test("hashes unicode correctly", async () => {
    const result = await hash("héllo")
    expect(result.length).toBe(64)
  })
})

describe("checksum", () => {
  test("returns undefined for empty string", () => {
    expect(checksum("")).toBeUndefined()
  })

  test("returns string for non-empty input", () => {
    const result = checksum("hello")
    expect(typeof result).toBe("string")
    expect(result!.length).toBeGreaterThan(0)
  })

  test("same input returns same value", () => {
    expect(checksum("hello")).toBe(checksum("hello"))
  })

  test("different inputs return different values", () => {
    expect(checksum("hello")).not.toBe(checksum("world"))
  })

  test("returns base36 encoded value", () => {
    const result = checksum("hello")
    expect(result).toMatch(/^[0-9a-z]+$/)
  })

  test("single char checksum", () => {
    expect(checksum("a")).toBeDefined()
  })

  test("very long input", () => {
    expect(checksum("x".repeat(10000))).toBeDefined()
  })

  test("unicode strings", () => {
    expect(checksum("héllo")).toBeDefined()
  })

  test("all chars from 0-127", () => {
    let s = ""
    for (let i = 0; i < 128; i++) s += String.fromCharCode(i)
    expect(checksum(s)).toBeDefined()
  })

  test("subtle changes produce different checksums", () => {
    expect(checksum("hello")).not.toBe(checksum("hellp"))
    expect(checksum("hello")).not.toBe(checksum("hellos"))
  })

  test("repeats produce different checksums", () => {
    expect(checksum("aaaa")).not.toBe(checksum("aaab"))
  })
})

describe("sampledChecksum", () => {
  test("returns undefined for empty string", () => {
    expect(sampledChecksum("")).toBeUndefined()
  })

  test("returns checksum for short input", () => {
    expect(sampledChecksum("hello")).toBe(checksum("hello"))
  })

  test("returns sampled checksum for long input", () => {
    const long = "x".repeat(1_000_000)
    const result = sampledChecksum(long)
    expect(result).toBeDefined()
    expect(result).toContain(":")
  })

  test("starts with content length for sampled inputs", () => {
    const long = "y".repeat(600_000)
    const result = sampledChecksum(long)
    expect(result!.startsWith("600000:")).toBe(true)
  })

  test("respects custom limit", () => {
    const result = sampledChecksum("x".repeat(100), 50)
    expect(result).toContain(":")
  })

  test("equal long content gives same sampled checksum", () => {
    const long = "z".repeat(1_000_000)
    expect(sampledChecksum(long)).toBe(sampledChecksum(long))
  })

  test("different long content gives different sampled checksum", () => {
    const a = "a".repeat(600_000)
    const b = "b".repeat(600_000)
    expect(sampledChecksum(a)).not.toBe(sampledChecksum(b))
  })

  test("at-limit boundary uses non-sampled checksum", () => {
    const limit = 1000
    const at = "x".repeat(limit)
    const result = sampledChecksum(at, limit)
    expect(result).toBe(checksum(at))
  })

  test("just above limit uses sampled", () => {
    const limit = 1000
    const result = sampledChecksum("x".repeat(limit + 1), limit)
    expect(result).toContain(":")
  })
})
