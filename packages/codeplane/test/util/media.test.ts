import { describe, expect, test } from "bun:test"
import { isPdfAttachment, isMedia, isImageAttachment, sniffAttachmentMime } from "../../src/util/media"

describe("isPdfAttachment", () => {
  test("returns true for application/pdf", () => {
    expect(isPdfAttachment("application/pdf")).toBe(true)
  })

  test("returns false for non-pdf", () => {
    expect(isPdfAttachment("image/png")).toBe(false)
    expect(isPdfAttachment("text/plain")).toBe(false)
    expect(isPdfAttachment("")).toBe(false)
  })

  test("case-sensitive", () => {
    expect(isPdfAttachment("Application/PDF")).toBe(false)
  })
})

describe("isMedia", () => {
  test("returns true for image types", () => {
    expect(isMedia("image/png")).toBe(true)
    expect(isMedia("image/jpeg")).toBe(true)
    expect(isMedia("image/gif")).toBe(true)
    expect(isMedia("image/webp")).toBe(true)
  })

  test("returns true for pdf", () => {
    expect(isMedia("application/pdf")).toBe(true)
  })

  test("returns false for video", () => {
    expect(isMedia("video/mp4")).toBe(false)
  })

  test("returns false for audio", () => {
    expect(isMedia("audio/mpeg")).toBe(false)
  })

  test("returns false for text", () => {
    expect(isMedia("text/plain")).toBe(false)
  })

  test("returns false for empty string", () => {
    expect(isMedia("")).toBe(false)
  })
})

describe("isImageAttachment", () => {
  test("returns true for jpeg/png/gif", () => {
    expect(isImageAttachment("image/jpeg")).toBe(true)
    expect(isImageAttachment("image/png")).toBe(true)
    expect(isImageAttachment("image/gif")).toBe(true)
  })

  test("returns false for SVG", () => {
    expect(isImageAttachment("image/svg+xml")).toBe(false)
  })

  test("returns false for fastbidsheet", () => {
    expect(isImageAttachment("image/vnd.fastbidsheet")).toBe(false)
  })

  test("returns false for pdf", () => {
    expect(isImageAttachment("application/pdf")).toBe(false)
  })

  test("returns false for non-image", () => {
    expect(isImageAttachment("text/plain")).toBe(false)
    expect(isImageAttachment("")).toBe(false)
  })

  test("returns true for image/bmp", () => {
    expect(isImageAttachment("image/bmp")).toBe(true)
  })

  test("returns true for image/webp", () => {
    expect(isImageAttachment("image/webp")).toBe(true)
  })
})

describe("sniffAttachmentMime", () => {
  test("detects PNG from magic bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("image/png")
  })

  test("detects JPEG from magic bytes", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("image/jpeg")
  })

  test("detects GIF from magic bytes", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("image/gif")
  })

  test("detects BMP from magic bytes", () => {
    const bytes = new Uint8Array([0x42, 0x4d, 0x00, 0x00])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("image/bmp")
  })

  test("detects PDF from magic bytes", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("application/pdf")
  })

  test("detects WebP from RIFF + WEBP", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("image/webp")
  })

  test("returns fallback for unknown bytes", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02])
    expect(sniffAttachmentMime(bytes, "application/octet-stream")).toBe("application/octet-stream")
  })

  test("returns fallback for empty bytes", () => {
    expect(sniffAttachmentMime(new Uint8Array(), "fallback")).toBe("fallback")
  })

  test("does not match RIFF without WEBP", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])
    expect(sniffAttachmentMime(bytes, "fallback")).toBe("fallback")
  })
})
