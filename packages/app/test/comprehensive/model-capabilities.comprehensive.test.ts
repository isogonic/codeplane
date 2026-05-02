import { describe, expect, test } from "bun:test"
import {
  attachmentInput,
  modelSupportsAttachment,
  modelSupportsInput,
} from "../../src/utils/model-capabilities"

describe("attachmentInput", () => {
  test("image/* maps to image", () => expect(attachmentInput("image/png")).toBe("image"))
  test("audio/* maps to audio", () => expect(attachmentInput("audio/mp3")).toBe("audio"))
  test("video/* maps to video", () => expect(attachmentInput("video/mp4")).toBe("video"))
  test("application/pdf maps to pdf", () =>
    expect(attachmentInput("application/pdf")).toBe("pdf"))
  test("other returns undefined", () =>
    expect(attachmentInput("application/json")).toBeUndefined())
  for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]) {
    test(`${mime} maps to image`, () => expect(attachmentInput(mime)).toBe("image"))
  }
  for (const mime of ["audio/wav", "audio/mp3", "audio/aac", "audio/ogg"]) {
    test(`${mime} maps to audio`, () => expect(attachmentInput(mime)).toBe("audio"))
  }
  for (const mime of ["video/mp4", "video/webm", "video/quicktime"]) {
    test(`${mime} maps to video`, () => expect(attachmentInput(mime)).toBe("video"))
  }
})

describe("modelSupportsInput", () => {
  test("undefined model returns false", () =>
    expect(modelSupportsInput(undefined, "text")).toBe(false))
  test("model without capabilities returns false", () =>
    expect(modelSupportsInput({ id: "x" } as never, "text")).toBe(false))
  test("text input check direct", () => {
    const model = {
      id: "x",
      capabilities: {
        attachment: true,
        input: { text: true, image: false, audio: false, video: false, pdf: false },
      },
    }
    expect(modelSupportsInput(model, "text")).toBe(true)
  })
  test("non-text requires attachment + input", () => {
    const model = {
      id: "x",
      capabilities: {
        attachment: true,
        input: { text: true, image: true, audio: false, video: false, pdf: false },
      },
    }
    expect(modelSupportsInput(model, "image")).toBe(true)
    expect(modelSupportsInput(model, "audio")).toBe(false)
  })
  test("text-only model rejects non-text", () => {
    const model = {
      id: "gpt-5.3-codex-spark",
      capabilities: {
        attachment: true,
        input: { text: true, image: true, audio: true, video: true, pdf: true },
      },
    }
    expect(modelSupportsInput(model, "image")).toBe(false)
  })
})

describe("modelSupportsAttachment", () => {
  test("non-attachment mime always supported", () => {
    expect(modelSupportsAttachment(undefined, "text/plain")).toBe(true)
  })
  test("image requires capability", () => {
    const model = {
      id: "x",
      capabilities: {
        attachment: true,
        input: { text: true, image: true, audio: false, video: false, pdf: false },
      },
    }
    expect(modelSupportsAttachment(model, "image/png")).toBe(true)
  })
  for (let i = 0; i < 30; i++) {
    test(`bulk default model #${i}`, () => {
      expect(modelSupportsAttachment(undefined, `text/${i}`)).toBe(true)
    })
  }
})
