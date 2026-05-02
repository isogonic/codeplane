import { describe, expect, test } from "bun:test"
import type { FilePart } from "@codeplane-ai/sdk/v2"
import { attached, inline, kind } from "./message-file"

function file(part: Partial<FilePart> = {}): FilePart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "file",
    mime: "text/plain",
    url: "file:///repo/README.txt",
    filename: "README.txt",
    ...part,
  }
}

describe("attached additional cases", () => {
  test("data:image/png is attached", () => {
    expect(attached(file({ url: "data:image/png;base64,iVBOR" }))).toBe(true)
  })

  test("http url is not attached", () => {
    expect(attached(file({ url: "http://example.com/file.txt" }))).toBe(false)
  })

  test("https url is not attached", () => {
    expect(attached(file({ url: "https://example.com/file.txt" }))).toBe(false)
  })

  test("file:// url is not attached", () => {
    expect(attached(file({ url: "file:///abs/path" }))).toBe(false)
  })

  test("relative path url is not attached", () => {
    expect(attached(file({ url: "./local" }))).toBe(false)
  })
})

describe("inline additional cases", () => {
  test("inline returns false when no source", () => {
    expect(inline(file())).toBe(false)
  })

  test("inline returns false when source has no text range", () => {
    expect(inline(file({ source: { type: "file", path: "/x" } as any }))).toBe(false)
  })

  test("inline returns false when start is undefined but end set", () => {
    expect(
      inline(
        file({ source: { type: "file", path: "/x", text: { value: "x", end: 1 } as any } }),
      ),
    ).toBe(false)
  })

  test("inline returns false when end is undefined but start set", () => {
    expect(
      inline(
        file({ source: { type: "file", path: "/x", text: { value: "x", start: 0 } as any } }),
      ),
    ).toBe(false)
  })

  test("inline returns true with start=0,end=0", () => {
    expect(
      inline(
        file({ source: { type: "file", path: "/x", text: { value: "", start: 0, end: 0 } } }),
      ),
    ).toBe(true)
  })
})

describe("kind additional cases", () => {
  test("image/jpeg is image", () => {
    expect(kind(file({ mime: "image/jpeg" }))).toBe("image")
  })

  test("image/svg+xml is image", () => {
    expect(kind(file({ mime: "image/svg+xml" }))).toBe("image")
  })

  test("text/plain is file", () => {
    expect(kind(file({ mime: "text/plain" }))).toBe("file")
  })

  test("application/json is file", () => {
    expect(kind(file({ mime: "application/json" }))).toBe("file")
  })

  test("audio/mpeg is file", () => {
    expect(kind(file({ mime: "audio/mpeg" }))).toBe("file")
  })

  test("video/mp4 is file", () => {
    expect(kind(file({ mime: "video/mp4" }))).toBe("file")
  })

  test("empty mime is file", () => {
    expect(kind(file({ mime: "" }))).toBe("file")
  })
})
