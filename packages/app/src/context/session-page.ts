import type { Message } from "@codeplane-ai/sdk/v2/client"
import { base64Encode } from "@codeplane-ai/shared/util/encode"

export function messageCursor(message: Pick<Message, "id" | "time">) {
  return base64Encode(JSON.stringify({ id: message.id, time: message.time.created }))
}

export function trimSessionMessages(input: { messages: readonly Message[] | undefined; limit: number }) {
  const messages = input.messages ?? []
  const limit = Math.max(1, input.limit)
  if (messages.length <= limit) return

  const items = messages.slice(-limit)
  const first = items[0]
  return {
    items,
    cursor: first ? messageCursor(first) : undefined,
    complete: false,
  }
}
