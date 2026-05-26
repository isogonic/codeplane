import type { AssistantMessage, Message, SessionStatus } from "@codeplane-ai/sdk/v2/client"

const isAssistantMessage = (message: Message): message is AssistantMessage => message.role === "assistant"

export function hasPendingAssistantMessage(messages: Message[] | undefined) {
  const lastAssistant = messages?.findLast(isAssistantMessage)
  return !!lastAssistant && typeof lastAssistant.time.completed !== "number"
}

export function hasUnansweredUserMessage(messages: Message[] | undefined) {
  if (!messages?.length) return false
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user")
  if (lastUserIndex === -1) return false
  const lastAssistantIndex = messages.findLastIndex(isAssistantMessage)
  return lastUserIndex > lastAssistantIndex
}

export function isSessionWorking(status: SessionStatus | undefined, messages: Message[] | undefined) {
  if (hasPendingAssistantMessage(messages)) return true
  if ((status?.type ?? "idle") === "idle") return false
  if (status?.type === "retry") return true
  if (!messages?.length) return true
  return hasUnansweredUserMessage(messages)
}
