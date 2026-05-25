import { describe, expect, test } from "bun:test"
import { hasRemoteAccessSettings, instanceEditorKind, localInstanceUrl } from "../src/instance"

describe("localInstanceUrl", () => {
  test("prefixes id with local://", () => {
    expect(localInstanceUrl("123")).toBe("local://123")
  })

  test("works with empty id", () => {
    expect(localInstanceUrl("")).toBe("local://")
  })

  test("works with uuid-like id", () => {
    expect(localInstanceUrl("abc-def-123")).toBe("local://abc-def-123")
  })

  test("preserves special characters", () => {
    expect(localInstanceUrl("foo bar")).toBe("local://foo bar")
  })

  test("preserves unicode", () => {
    expect(localInstanceUrl("идентификатор")).toBe("local://идентификатор")
  })

  test("preserves slashes in id", () => {
    expect(localInstanceUrl("a/b")).toBe("local://a/b")
  })

  test("preserves colons in id", () => {
    expect(localInstanceUrl("foo:bar")).toBe("local://foo:bar")
  })

  test("returns string type", () => {
    expect(typeof localInstanceUrl("anything")).toBe("string")
  })
})

describe("hasRemoteAccessSettings", () => {
  test("is false for a pure managed local instance", () => {
    expect(
      hasRemoteAccessSettings({
        id: "local",
        url: localInstanceUrl("local"),
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe(false)
  })

  test("is true when a managed local instance keeps a hosted url", () => {
    expect(
      hasRemoteAccessSettings({
        id: "local",
        url: "https://codeplane.example.com",
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe(true)
  })

  test("is true when a managed local instance has saved auth headers", () => {
    expect(
      hasRemoteAccessSettings({
        id: "local",
        url: localInstanceUrl("local"),
        headers: { Authorization: "Bearer token" },
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe(true)
  })

  test("is true when a managed local instance skips certificate verification", () => {
    expect(
      hasRemoteAccessSettings({
        id: "local",
        url: localInstanceUrl("local"),
        ignoreCertificateErrors: true,
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe(true)
  })

  test("is true when a managed local instance pins a client certificate", () => {
    expect(
      hasRemoteAccessSettings({
        id: "local",
        url: localInstanceUrl("local"),
        clientCertSubject: "CN=Codeplane",
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe(true)
  })
})

describe("instanceEditorKind", () => {
  test("uses the remote editor for remote instances", () => {
    expect(
      instanceEditorKind({
        id: "remote",
        url: "https://codeplane.example.com",
      }),
    ).toBe("remote")
  })

  test("uses the local editor for pure managed local instances", () => {
    expect(
      instanceEditorKind({
        id: "local",
        url: localInstanceUrl("local"),
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe("local")
  })

  test("uses the remote editor for managed local instances with remote access settings", () => {
    expect(
      instanceEditorKind({
        id: "local",
        url: "https://edge.example.com",
        headers: { Cookie: "session=abc" },
        local: { binaryVersion: "29.0.0" },
      }),
    ).toBe("remote")
  })
})
