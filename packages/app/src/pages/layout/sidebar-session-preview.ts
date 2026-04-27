import type { AssistantMessage, Message, Part, UserMessage } from "@codeplane-ai/sdk/v2/client"

export type SessionPreview = {
  loading: boolean
  prompt?: string
  providerID?: string
  modelID?: string
  cost?: number
  duration?: number
}

const byTime = (a: Message, b: Message) => a.time.created - b.time.created || a.id.localeCompare(b.id)

const textPart = (part: Part): part is Extract<Part, { type: "text" }> =>
  part.type === "text" && !part.synthetic && !part.ignored

const userMessage = (message: Message): message is UserMessage => message.role === "user"

const assistantMessage = (message: Message): message is AssistantMessage => message.role === "assistant"

export function getSessionPreview(input: {
  messages: Message[] | undefined
  parts: Record<string, Part[] | undefined>
  now?: number
}): SessionPreview {
  if (!input.messages) return { loading: true }

  const messages = input.messages.slice().sort(byTime)
  const user = messages.findLast(userMessage)
  const assistant = user
    ? (messages.findLast(
        (message): message is AssistantMessage => assistantMessage(message) && message.parentID === user.id,
      ) ??
      messages.findLast(
        (message): message is AssistantMessage =>
          assistantMessage(message) && message.time.created >= user.time.created,
      ))
    : messages.findLast(assistantMessage)

  const prompt = user
    ? (input.parts[user.id] ?? [])
        .filter(textPart)
        .map((part) => part.text)
        .join("\n")
        .trim()
    : undefined

  return {
    loading: false,
    prompt: prompt || undefined,
    providerID: assistant?.providerID ?? user?.model.providerID,
    modelID: assistant?.modelID ?? user?.model.modelID,
    cost: assistant?.cost,
    duration: assistant
      ? Math.max(0, (assistant.time.completed ?? input.now ?? Date.now()) - assistant.time.created)
      : undefined,
  }
}

export function formatSessionPreviewDuration(value: number | undefined, locale: string) {
  if (value === undefined) return "-"

  const seconds = Math.round(value / 1000)
  if (seconds < 60) {
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "second",
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(seconds)
  }

  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return `${new Intl.NumberFormat(locale).format(minutes)}m ${new Intl.NumberFormat(locale).format(remaining)}s`
}

export function formatSessionPreviewCost(value: number | undefined, locale: string) {
  if (value === undefined) return "-"

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value)
}
