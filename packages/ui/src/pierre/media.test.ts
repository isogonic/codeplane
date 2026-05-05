import { describe, expect, test } from "bun:test"
import {
  normalizeMimeType,
  fileExtension,
  mediaKindFromPath,
  isBinaryContent,
  dataUrlFromMediaValue,
  svgTextFromValue,
  hasMediaValue,
  textFromValue,
} from "./media"

describe("normalizeMimeType", () => {
  test("returns undefined for empty input", () => {
    expect(normalizeMimeType("")).toBeUndefined()
    expect(normalizeMimeType(undefined)).toBeUndefined()
  })

  test("strips parameters", () => {
    expect(normalizeMimeType("image/png; charset=utf-8")).toBe("image/png")
  })

  test("trims and lowercases", () => {
    expect(normalizeMimeType("  IMAGE/PNG  ")).toBe("image/png")
  })

  test("rewrites audio/x-aac to audio/aac", () => {
    expect(normalizeMimeType("audio/x-aac")).toBe("audio/aac")
  })

  test("rewrites audio/x-m4a to audio/mp4", () => {
    expect(normalizeMimeType("audio/x-m4a")).toBe("audio/mp4")
  })

  test("preserves other types", () => {
    expect(normalizeMimeType("application/json")).toBe("application/json")
  })
})

describe("fileExtension", () => {
  test("returns lowercase extension", () => {
    expect(fileExtension("file.PNG")).toBe("png")
  })

  test("returns empty for no extension", () => {
    expect(fileExtension("README")).toBe("")
  })

  test("returns empty for undefined", () => {
    expect(fileExtension(undefined)).toBe("")
  })

  test("returns empty for empty string", () => {
    expect(fileExtension("")).toBe("")
  })

  test("returns last extension", () => {
    expect(fileExtension("file.tar.gz")).toBe("gz")
  })

  test("dot file with no extension returns the part after dot", () => {
    expect(fileExtension(".gitignore")).toBe("gitignore")
  })
})

describe("mediaKindFromPath", () => {
  test("png is image", () => {
    expect(mediaKindFromPath("photo.png")).toBe("image")
  })

  test("jpg is image", () => {
    expect(mediaKindFromPath("a.jpg")).toBe("image")
  })

  test("svg is svg", () => {
    expect(mediaKindFromPath("a.svg")).toBe("svg")
  })

  test("mp3 is audio", () => {
    expect(mediaKindFromPath("song.mp3")).toBe("audio")
  })

  test("wav is audio", () => {
    expect(mediaKindFromPath("clip.wav")).toBe("audio")
  })

  test("flac is audio", () => {
    expect(mediaKindFromPath("audio.flac")).toBe("audio")
  })

  test("pdf is pdf", () => {
    expect(mediaKindFromPath("doc.pdf")).toBe("pdf")
  })

  test("mp4 is video", () => {
    expect(mediaKindFromPath("clip.mp4")).toBe("video")
  })

  test("webm is video", () => {
    expect(mediaKindFromPath("clip.webm")).toBe("video")
  })

  test("mov is video", () => {
    expect(mediaKindFromPath("clip.mov")).toBe("video")
  })

  test("csv is table", () => {
    expect(mediaKindFromPath("data.csv")).toBe("table")
  })

  test("tsv is table", () => {
    expect(mediaKindFromPath("data.tsv")).toBe("table")
  })

  test("md is markdown", () => {
    expect(mediaKindFromPath("README.md")).toBe("markdown")
  })

  test("mdx is markdown", () => {
    expect(mediaKindFromPath("docs.mdx")).toBe("markdown")
  })

  test("html is html", () => {
    expect(mediaKindFromPath("page.html")).toBe("html")
  })

  test("htm is html", () => {
    expect(mediaKindFromPath("page.htm")).toBe("html")
  })

  test("json is json", () => {
    expect(mediaKindFromPath("config.json")).toBe("json")
  })

  test("jsonc is json", () => {
    expect(mediaKindFromPath("tsconfig.jsonc")).toBe("json")
  })

  test("apng is image", () => {
    expect(mediaKindFromPath("a.apng")).toBe("image")
  })

  test("jxl is image", () => {
    expect(mediaKindFromPath("a.jxl")).toBe("image")
  })

  test("unknown extension returns undefined", () => {
    expect(mediaKindFromPath("doc.xyz")).toBeUndefined()
  })

  test("undefined input returns undefined", () => {
    expect(mediaKindFromPath(undefined)).toBeUndefined()
  })

  test("ico is image", () => {
    expect(mediaKindFromPath("favicon.ico")).toBe("image")
  })

  test("webp is image", () => {
    expect(mediaKindFromPath("a.webp")).toBe("image")
  })

  test("avif is image", () => {
    expect(mediaKindFromPath("a.avif")).toBe("image")
  })

  test("opus is audio", () => {
    expect(mediaKindFromPath("a.opus")).toBe("audio")
  })

  test("uppercase extension still works", () => {
    expect(mediaKindFromPath("file.PNG")).toBe("image")
  })
})

describe("isBinaryContent", () => {
  test("returns true for binary type", () => {
    expect(isBinaryContent({ type: "binary" })).toBe(true)
  })

  test("returns false for text type", () => {
    expect(isBinaryContent({ type: "text" })).toBe(false)
  })

  test("returns false for missing type", () => {
    expect(isBinaryContent({})).toBe(false)
  })

  test("returns false for null", () => {
    expect(isBinaryContent(null)).toBe(false)
  })

  test("returns false for non-object", () => {
    expect(isBinaryContent("binary")).toBe(false)
    expect(isBinaryContent(42)).toBe(false)
  })
})

describe("dataUrlFromMediaValue (string input)", () => {
  test("accepts data:image/png", () => {
    const value = "data:image/png;base64,abc"
    expect(dataUrlFromMediaValue(value, "image")).toBe(value)
  })

  test("rejects mismatched data url for image", () => {
    expect(dataUrlFromMediaValue("data:audio/mp3;base64,abc", "image")).toBeUndefined()
  })

  test("accepts data:image/svg+xml for svg kind", () => {
    const value = "data:image/svg+xml;base64,abc"
    expect(dataUrlFromMediaValue(value, "svg")).toBe(value)
  })

  test("rejects non-svg for svg kind", () => {
    expect(dataUrlFromMediaValue("data:image/png;base64,abc", "svg")).toBeUndefined()
  })

  test("audio data:audio/x-aac normalized to audio/aac", () => {
    expect(dataUrlFromMediaValue("data:audio/x-aac;base64,xyz", "audio")).toContain("audio/aac")
  })

  test("audio data:audio/x-m4a normalized to audio/mp4", () => {
    expect(dataUrlFromMediaValue("data:audio/x-m4a;base64,xyz", "audio")).toContain("audio/mp4")
  })

  test("unknown protocol returns undefined", () => {
    expect(dataUrlFromMediaValue("https://example.com", "image")).toBeUndefined()
  })
})

describe("dataUrlFromMediaValue (object input)", () => {
  test("converts base64 image record", () => {
    const result = dataUrlFromMediaValue(
      { content: "abc", mimeType: "image/png", encoding: "base64" },
      "image",
    )
    expect(result).toBe("data:image/png;base64,abc")
  })

  test("converts base64 audio record", () => {
    const result = dataUrlFromMediaValue(
      { content: "xyz", mimeType: "audio/mpeg", encoding: "base64" },
      "audio",
    )
    expect(result).toBe("data:audio/mpeg;base64,xyz")
  })

  test("converts svg base64", () => {
    const result = dataUrlFromMediaValue(
      { content: "abc", mimeType: "image/svg+xml", encoding: "base64" },
      "svg",
    )
    expect(result).toBe("data:image/svg+xml;base64,abc")
  })

  test("converts svg text", () => {
    const result = dataUrlFromMediaValue(
      { content: "<svg></svg>", mimeType: "image/svg+xml", encoding: "utf-8" as any },
      "svg",
    )
    expect(result).toContain("data:image/svg+xml;charset=utf-8,")
  })

  test("rejects non-image mime for image kind", () => {
    expect(
      dataUrlFromMediaValue({ content: "x", mimeType: "audio/mpeg", encoding: "base64" }, "image"),
    ).toBeUndefined()
  })

  test("returns undefined for non-base64 audio", () => {
    expect(
      dataUrlFromMediaValue(
        { content: "x", mimeType: "audio/mpeg", encoding: "raw" as any },
        "audio",
      ),
    ).toBeUndefined()
  })

  test("returns undefined for missing content", () => {
    expect(dataUrlFromMediaValue({ mimeType: "image/png" }, "image")).toBeUndefined()
  })

  test("returns undefined for missing mime", () => {
    expect(dataUrlFromMediaValue({ content: "x" }, "image")).toBeUndefined()
  })

  test("returns undefined for null value", () => {
    expect(dataUrlFromMediaValue(null, "image")).toBeUndefined()
  })
})

describe("svgTextFromValue", () => {
  test("returns content directly when not base64", () => {
    expect(svgTextFromValue({ content: "<svg/>", mimeType: "image/svg+xml" })).toBe("<svg/>")
  })

  test("returns undefined when mime is not svg", () => {
    expect(svgTextFromValue({ content: "x", mimeType: "image/png" })).toBeUndefined()
  })

  test("returns undefined for non-string content", () => {
    expect(svgTextFromValue({ content: 42, mimeType: "image/svg+xml" })).toBeUndefined()
  })

  test("returns undefined for null", () => {
    expect(svgTextFromValue(null)).toBeUndefined()
  })

  test("decodes base64 encoded svg", () => {
    const svg = "<svg/>"
    const encoded = btoa(svg)
    expect(svgTextFromValue({ content: encoded, mimeType: "image/svg+xml", encoding: "base64" })).toBe(svg)
  })
})

describe("hasMediaValue", () => {
  test("returns true for non-empty string", () => {
    expect(hasMediaValue("anything")).toBe(true)
  })

  test("returns false for empty string", () => {
    expect(hasMediaValue("")).toBe(false)
  })

  test("returns true for object with content", () => {
    expect(hasMediaValue({ content: "x" })).toBe(true)
  })

  test("returns false for object with empty content", () => {
    expect(hasMediaValue({ content: "" })).toBe(false)
  })

  test("returns false for object with no content", () => {
    expect(hasMediaValue({})).toBe(false)
  })

  test("returns false for null/undefined", () => {
    expect(hasMediaValue(null)).toBe(false)
    expect(hasMediaValue(undefined)).toBe(false)
  })

  test("returns false for non-string content type", () => {
    expect(hasMediaValue({ content: 42 })).toBe(false)
  })
})

describe("dataUrlFromMediaValue (video & pdf)", () => {
  test("converts base64 video record", () => {
    const result = dataUrlFromMediaValue(
      { content: "abc", mimeType: "video/mp4", encoding: "base64" },
      "video",
    )
    expect(result).toBe("data:video/mp4;base64,abc")
  })

  test("rejects non-video mime for video kind", () => {
    expect(
      dataUrlFromMediaValue({ content: "x", mimeType: "audio/mpeg", encoding: "base64" }, "video"),
    ).toBeUndefined()
  })

  test("normalizes video/quicktime in data url", () => {
    const result = dataUrlFromMediaValue("data:video/quicktime;base64,abc", "video")
    expect(result).toContain("video/mp4")
  })

  test("converts base64 pdf record", () => {
    const result = dataUrlFromMediaValue(
      { content: "abc", mimeType: "application/pdf", encoding: "base64" },
      "pdf",
    )
    expect(result).toBe("data:application/pdf;base64,abc")
  })

  test("rejects non-pdf mime for pdf kind", () => {
    expect(
      dataUrlFromMediaValue({ content: "x", mimeType: "image/png", encoding: "base64" }, "pdf"),
    ).toBeUndefined()
  })

  test("rejects pdf without base64", () => {
    expect(
      dataUrlFromMediaValue({ content: "x", mimeType: "application/pdf" }, "pdf"),
    ).toBeUndefined()
  })
})

describe("textFromValue", () => {
  test("returns string input as-is", () => {
    expect(textFromValue("hello")).toBe("hello")
  })

  test("returns text record content", () => {
    expect(textFromValue({ type: "text", content: "abc" })).toBe("abc")
  })

  test("decodes base64 text content", () => {
    const encoded = btoa("hello")
    expect(textFromValue({ type: "text", content: encoded, encoding: "base64" })).toBe("hello")
  })

  test("returns undefined for binary content", () => {
    expect(textFromValue({ type: "binary", content: "abc" })).toBeUndefined()
  })

  test("returns undefined for null", () => {
    expect(textFromValue(null)).toBeUndefined()
  })

  test("returns undefined for non-string content", () => {
    expect(textFromValue({ content: 42 })).toBeUndefined()
  })
})
