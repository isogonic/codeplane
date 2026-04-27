type InputKey = "text" | "image" | "audio" | "video" | "pdf"

type ModelInfo = {
  id: string
  capabilities?: {
    attachment: boolean
    input: Record<InputKey, boolean>
  }
}

const TEXT_ONLY_MODEL_IDS = new Set(["gpt-5.3-codex-spark"])

export function modelSupportsInput(model: ModelInfo | undefined, input: InputKey) {
  if (!model?.capabilities) return false
  if (input !== "text" && TEXT_ONLY_MODEL_IDS.has(model.id)) return false
  if (input === "text") return model.capabilities.input.text
  return model.capabilities.attachment && model.capabilities.input[input]
}

export function attachmentInput(mime: string): Exclude<InputKey, "text"> | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
}

export function modelSupportsAttachment(model: ModelInfo | undefined, mime: string) {
  const input = attachmentInput(mime)
  if (!input) return true
  return modelSupportsInput(model, input)
}
