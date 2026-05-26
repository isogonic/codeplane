import type { AssistantMessage, Message } from "@codeplane-ai/sdk/v2/client"
import type { SessionStatus } from "@codeplane-ai/sdk/v2"

const isAssistantMessage = (message: Message): message is AssistantMessage => message.role === "assistant"

export function hasPendingTurnAssistant(messages: readonly AssistantMessage[]) {
  const lastAssistant = messages.findLast((message) => isAssistantMessage(message))
  return !!lastAssistant && typeof lastAssistant.time.completed !== "number"
}

export function isSessionTurnWorking(input: {
  active: boolean
  status: SessionStatus
  assistantMessages: readonly AssistantMessage[]
}) {
  return input.active && (input.status.type !== "idle" || hasPendingTurnAssistant(input.assistantMessages))
}
