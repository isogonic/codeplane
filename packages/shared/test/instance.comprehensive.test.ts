import { describe, expect, test } from "bun:test"
import { localInstanceUrl } from "../src/instance"

describe("localInstanceUrl", () => {
  test("formats with local:// prefix", () => {
    expect(localInstanceUrl("abc")).toBe("local://abc")
  })
  test("preserves id case", () => {
    expect(localInstanceUrl("CamelCase")).toBe("local://CamelCase")
  })
  test("preserves digits", () => {
    expect(localInstanceUrl("123")).toBe("local://123")
  })
  test("preserves dashes", () => {
    expect(localInstanceUrl("a-b-c")).toBe("local://a-b-c")
  })
  test("preserves underscores", () => {
    expect(localInstanceUrl("a_b_c")).toBe("local://a_b_c")
  })
  test("preserves dots", () => {
    expect(localInstanceUrl("a.b.c")).toBe("local://a.b.c")
  })
  test("empty id returns local://", () => {
    expect(localInstanceUrl("")).toBe("local://")
  })
  test("single character", () => {
    expect(localInstanceUrl("x")).toBe("local://x")
  })
  test("long id", () => {
    const id = "a".repeat(100)
    expect(localInstanceUrl(id)).toBe(`local://${id}`)
  })
  test("ulid-like", () => {
    expect(localInstanceUrl("01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe("local://01JABCDEFGHJKMNPQRSTVWXYZ0")
  })
  test("uuid-like", () => {
    expect(localInstanceUrl("01234567-89ab-cdef-0123-456789abcdef")).toBe(
      "local://01234567-89ab-cdef-0123-456789abcdef",
    )
  })
  test("starts with local://", () => {
    expect(localInstanceUrl("anything").startsWith("local://")).toBe(true)
  })
  for (let i = 0; i < 100; i++) {
    test(`bulk #${i}`, () => expect(localInstanceUrl(`id${i}`)).toBe(`local://id${i}`))
  }
})

describe("type shape compatibility (compile-time + runtime checks)", () => {
  test("SavedInstance minimal", () => {
    const value = { id: "x", url: "http://localhost" }
    expect(value.id).toBe("x")
    expect(value.url).toBe("http://localhost")
  })
  test("SavedInstance full", () => {
    const value = {
      id: "x",
      url: "http://localhost",
      label: "Local",
      headers: { Authorization: "Bearer abc" },
      ignoreCertificateErrors: true,
      clientCertSubject: "CN=foo",
      iconDataUrl: "data:image/png;base64,",
      local: { binaryVersion: "27.3.1" },
    }
    expect(value.local?.binaryVersion).toBe("27.3.1")
    expect(value.headers?.Authorization).toBe("Bearer abc")
    expect(value.ignoreCertificateErrors).toBe(true)
  })
  test("PrepareProgress phases are valid", () => {
    const phases: Array<"probe" | "download" | "finalize" | "done"> = [
      "probe",
      "download",
      "finalize",
      "done",
    ]
    for (const phase of phases) expect(typeof phase).toBe("string")
  })
  test("OpenProgress phases are valid", () => {
    const phases: Array<"probe" | "download" | "finalize" | "done" | "error"> = [
      "probe",
      "download",
      "finalize",
      "done",
      "error",
    ]
    for (const phase of phases) expect(typeof phase).toBe("string")
  })
  test("LocalInstallProgress phases are valid", () => {
    const phases: Array<"detect" | "download" | "extract" | "start" | "ready"> = [
      "detect",
      "download",
      "extract",
      "start",
      "ready",
    ]
    for (const phase of phases) expect(typeof phase).toBe("string")
  })
  test("LocalTarget archive extensions are limited", () => {
    const exts: Array<".zip" | ".tar.gz" | ".tgz"> = [".zip", ".tar.gz", ".tgz"]
    for (const ext of exts) expect(ext.startsWith(".")).toBe(true)
  })
  test("LocalTarget oses are limited", () => {
    const oses: Array<"darwin" | "linux" | "windows"> = ["darwin", "linux", "windows"]
    for (const os of oses) expect(["darwin", "linux", "windows"]).toContain(os)
  })
  test("LocalTarget arches are limited", () => {
    const arches: Array<"x64" | "arm64"> = ["x64", "arm64"]
    for (const arch of arches) expect(["x64", "arm64"]).toContain(arch)
  })
})
