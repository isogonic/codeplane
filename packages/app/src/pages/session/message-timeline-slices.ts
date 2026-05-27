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
  // Group all assistants by parentID up front. This handles two cases the
  // previous "scan-forward-until-next-user-then-break" loop got wrong:
  //
  //   1. Out-of-order arrival. SSE events can land before the matching
  //      user message reducer-insert finishes, so an assistant whose
  //      parent is "user A" can end up at array index AFTER "user B"
  //      depending on id ordering. The old `break` on next user
  //      dropped that assistant entirely. After a full refresh the
  //      snapshot reorders everything so the bug "vanishes" — which
  //      is the user-reported "client shows wrong, refresh fixes".
  //
  //   2. Late children. A compaction summary or subtask assistant can
  //      arrive after another turn already started. Grouping by
  //      parentID matches each child to its owner regardless of array
  //      position.
  const childrenByParent = new Map<string, AssistantMessage[]>()
  for (const msg of input.messages) {
    if (msg.role !== "assistant") continue
    const a = msg as AssistantMessage
    if (!a.parentID) continue
    const arr = childrenByParent.get(a.parentID)
    if (arr) arr.push(a)
    else childrenByParent.set(a.parentID, [a])
  }
  // Sort each child group by id so the timeline order stays deterministic
  // even when out-of-order ids land in the map.
  for (const arr of childrenByParent.values()) arr.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))

  const map = new Map<string, MessageType[]>()
  for (const id of input.renderedUserMessageIDs) {
    const index = messageIndex(input.messages, id)
    const root = index >= 0 ? input.messages[index] : undefined
    if (!root || root.role !== "user") continue

    const slice: MessageType[] = [root]
    const children = childrenByParent.get(root.id)
    if (children && children.length > 0) slice.push(...children)
    map.set(root.id, slice)
  }
  return map
}
