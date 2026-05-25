import { Binary } from "@codeplane-ai/shared/util/binary"
import type { AssistantMessage, Message as MessageType } from "@codeplane-ai/sdk/v2"

const messageIndex = (messages: MessageType[], id: string) => {
  const result = Binary.search(messages, id, (message) => message.id)
  if (result.found) return result.index
  return messages.findIndex((message) => message.id === id)
}

export function visibleTurnSlices(input: {
  messages: MessageType[]
  renderedUserMessageIDs: readonly string[]
}) {
  const map = new Map<string, MessageType[]>()
  for (const id of input.renderedUserMessageIDs) {
    const index = messageIndex(input.messages, id)
    const root = index >= 0 ? input.messages[index] : undefined
    if (!root || root.role !== "user") continue

    const slice: MessageType[] = [root]
    for (let i = index + 1; i < input.messages.length; i++) {
      const next = input.messages[i]
      if (!next) continue
      if (next.role === "user") break
      if (next.role === "assistant" && (next as AssistantMessage).parentID === root.id) {
        slice.push(next)
      }
    }
    map.set(root.id, slice)
  }
  return map
}
