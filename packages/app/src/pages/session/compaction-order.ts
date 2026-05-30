import type { Part, UserMessage } from "@codeplane-ai/sdk/v2"

/**
 * Re-order compaction turns to their true chronological position.
 *
 * The timeline keys every turn by its user-message id and renders turns
 * in id order. A compaction divider ("Session compacted") + its summary
 * live on a synthetic user message whose id is minted at compaction
 * time. For legacy / out-of-order sessions that anchor id can sort
 * AFTER the turns the compaction logically precedes, which makes the
 * whole compaction block float to the very bottom of the chat instead
 * of sitting between the turns it summarized.
 *
 * A compaction summarizes everything up to the first message it KEPT
 * (`tail_start_id` on the compaction part). So the correct slot for the
 * divider is immediately BEFORE `tail_start_id`. We compute a stable
 * sort key per turn:
 *   - normal turn            -> [ownId, 1, ownId]
 *   - compaction w/ tail     -> [tail_start_id, 0, ownId]  (sits just
 *                               before the kept tail, ahead of the real
 *                               turn that owns that id)
 *   - compaction w/o tail    -> [ownId, 0, ownId]  (legacy / manual:
 *                               keep current behavior, no reorder)
 *
 * The sort is stable and only kicks in when at least one compaction
 * turn's `tail_start_id` disagrees with its own id; already-correct
 * sessions are returned untouched (same array reference) because a
 * chronologically-minted anchor id is >= every message it summarized
 * and < its kept tail, so the relative position is unchanged.
 */
export function orderCompactionTurnsChronologically(
  userMessages: UserMessage[],
  partsByMessage: Record<string, Part[]>,
): UserMessage[] {
  const tailStartFor = (id: string) => {
    const parts = partsByMessage[id]
    if (!parts) return undefined
    for (const part of parts) {
      if (part.type !== "compaction") continue
      return (part as { tail_start_id?: string }).tail_start_id
    }
    return undefined
  }

  let needsReorder = false
  const keyed = userMessages.map((msg, index) => {
    const tail = tailStartFor(msg.id)
    const isCompaction = tail !== undefined || (partsByMessage[msg.id] ?? []).some((p) => p.type === "compaction")
    const anchor = tail ?? msg.id
    if (tail !== undefined && tail !== msg.id) needsReorder = true
    return { msg, index, anchor, group: isCompaction ? 0 : 1 }
  })

  if (!needsReorder) return userMessages

  keyed.sort((a, b) => {
    if (a.anchor !== b.anchor) return a.anchor < b.anchor ? -1 : 1
    if (a.group !== b.group) return a.group - b.group
    // Stable fallback: preserve original relative order.
    return a.index - b.index
  })

  return keyed.map((entry) => entry.msg)
}
