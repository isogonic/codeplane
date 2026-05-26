import type { AssistantMessage, Message, SessionStatus } from "@codeplane-ai/sdk/v2/client"

const isAssistantMessage = (message: Message): message is AssistantMessage => message.role === "assistant"

export function hasPendingAssistantMessage(messages: Message[] | undefined) {
  const lastAssistant = messages?.findLast(isAssistantMessage)
  return !!lastAssistant && typeof lastAssistant.time.completed !== "number"
}

export function isSessionWorking(status: SessionStatus | undefined, messages: Message[] | undefined) {
  return (status?.type ?? "idle") !== "idle" || hasPendingAssistantMessage(messages)
}
