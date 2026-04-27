import { describe, expect, test } from "bun:test"
import { modelSupportsAttachment, modelSupportsInput } from "./model-capabilities"

const visionModel = {
  id: "vision-model",
  capabilities: {
    attachment: true,
    input: {
      text: true,
      image: true,
      audio: false,
      video: false,
      pdf: true,
    },
  },
}

describe("model capabilities", () => {
  test("treats gpt-5.3-codex-spark as text-only even when provider metadata advertises vision", () => {
    const model = {
      ...visionModel,
      id: "gpt-5.3-codex-spark",
    }

    expect(modelSupportsInput(model, "text")).toBe(true)
    expect(modelSupportsInput(model, "image")).toBe(false)
    expect(modelSupportsInput(model, "pdf")).toBe(false)
    expect(modelSupportsAttachment(model, "image/png")).toBe(false)
  })

  test("allows supported attachment modalities", () => {
    expect(modelSupportsAttachment(visionModel, "image/png")).toBe(true)
    expect(modelSupportsAttachment(visionModel, "application/pdf")).toBe(true)
    expect(modelSupportsAttachment(visionModel, "audio/mpeg")).toBe(false)
  })
})
