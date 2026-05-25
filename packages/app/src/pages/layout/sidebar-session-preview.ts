import type { AssistantMessage, Message, Part, UserMessage } from "@codeplane-ai/sdk/v2/client"

export type SessionPreview = {
  loading: boolean
  thinking?: boolean
  prompt?: string
  providerID?: string
  modelID?: string
  cost?: number
  duration?: number
}

const textPart = (part: Part): part is Extract<Part, { type: "text" }> =>
  part.type === "text" && !part.synthetic && !part.ignored

const userMessage = (message: Message): message is UserMessage => message.role === "user"

const assistantMessage = (message: Message): message is AssistantMessage => message.role === "assistant"

const newer = (candidate: Message, current: Message | undefined) => {
  if (!current) return true
  if (candidate.time.created !== current.time.created) return candidate.time.created > current.time.created
  return candidate.id > current.id
}

export function getSessionPreview(input: {
  messages: Message[] | undefined
  parts: Record<string, Part[] | undefined>
  now?: number
  working?: boolean
}): SessionPreview {
  if (!input.messages) return input.working ? { loading: false, thinking: true } : { loading: true }

  let user: UserMessage | undefined
  let assistant: AssistantMessage | undefined
  let assistantAfterUser: AssistantMessage | undefined

  for (const message of input.messages) {
    if (userMessage(message) && newer(message, user)) {
      user = message
    }
  }

  for (const message of input.messages) {
    if (!assistantMessage(message)) continue
    if (!user) {
      if (newer(message, assistant)) assistant = message
      continue
    }
    if (message.parentID === user.id && newer(message, assistant)) assistant = message
    if (message.time.created >= user.time.created && newer(message, assistantAfterUser)) assistantAfterUser = message
  }

  assistant = assistant ?? assistantAfterUser

  const prompt = user
    ? (input.parts[user.id] ?? [])
        .filter(textPart)
        .map((part) => part.text)
        .join("\n")
        .trim()
    : undefined

  return {
    loading: false,
    thinking: (input.working && !prompt) || undefined,
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
