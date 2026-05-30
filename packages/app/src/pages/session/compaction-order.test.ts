import { describe, expect, test } from "bun:test"
import type { Part, UserMessage } from "@codeplane-ai/sdk/v2"
import { orderCompactionTurnsChronologically } from "./compaction-order"

const user = (id: string) =>
  ({
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: 1 },
  }) as UserMessage

const textPart = (id: string, messageID: string) =>
  ({ id, messageID, sessionID: "ses_1", type: "text", text: "hi" }) as unknown as Part

const compactionPart = (id: string, messageID: string, tailStartID?: string) =>
  ({ id, messageID, sessionID: "ses_1", type: "compaction", auto: true, tail_start_id: tailStartID }) as unknown as Part

describe("orderCompactionTurnsChronologically", () => {
  test("moves a bottom-anchored compaction to just before its kept tail", () => {
    // The compaction turn (msg_z) sorts LAST by id even though it
    // summarized turns a+b and kept the tail starting at msg_d. The
    // divider should land immediately before msg_d, not at the bottom.
    const users = [user("msg_a"), user("msg_b"), user("msg_d"), user("msg_e"), user("msg_z")]
    const parts: Record<string, Part[]> = {
      msg_a: [textPart("p_a", "msg_a")],
      msg_b: [textPart("p_b", "msg_b")],
      msg_d: [textPart("p_d", "msg_d")],
      msg_e: [textPart("p_e", "msg_e")],
      msg_z: [compactionPart("p_z", "msg_z", "msg_d")],
    }

    const out = orderCompactionTurnsChronologically(users, parts).map((m) => m.id)

    expect(out).toEqual(["msg_a", "msg_b", "msg_z", "msg_d", "msg_e"])
  })

  test("leaves an already-chronological compaction untouched (same reference)", () => {
    // Anchor id minted chronologically: msg_c sits between msg_b and the
    // kept tail msg_d, so tail_start_id (msg_d) and its own position
    // agree. No reorder, identical array reference.
    const users = [user("msg_a"), user("msg_b"), user("msg_c"), user("msg_d")]
    const parts: Record<string, Part[]> = {
      msg_a: [textPart("p_a", "msg_a")],
      msg_b: [textPart("p_b", "msg_b")],
      // tail_start_id === the next real turn id; ordering already correct
      msg_c: [compactionPart("p_c", "msg_c", "msg_c")],
      msg_d: [textPart("p_d", "msg_d")],
    }

    const out = orderCompactionTurnsChronologically(users, parts)
    expect(out).toBe(users)
    expect(out.map((m) => m.id)).toEqual(["msg_a", "msg_b", "msg_c", "msg_d"])
  })

  test("legacy compaction without tail_start_id is left in place", () => {
    const users = [user("msg_a"), user("msg_b"), user("msg_z")]
    const parts: Record<string, Part[]> = {
      msg_a: [textPart("p_a", "msg_a")],
      msg_b: [textPart("p_b", "msg_b")],
      msg_z: [compactionPart("p_z", "msg_z")],
    }

    const out = orderCompactionTurnsChronologically(users, parts)
    expect(out).toBe(users)
  })

  test("multiple compactions are each placed before their own tail", () => {
    // Two compactions whose anchors both sort to the end. Each should
    // slot before its respective kept tail.
    const users = [user("msg_a"), user("msg_c"), user("msg_e"), user("msg_y"), user("msg_z")]
    const parts: Record<string, Part[]> = {
      msg_a: [textPart("p_a", "msg_a")],
      msg_c: [textPart("p_c", "msg_c")],
      msg_e: [textPart("p_e", "msg_e")],
      // first compaction kept tail at msg_c
      msg_y: [compactionPart("p_y", "msg_y", "msg_c")],
      // second compaction kept tail at msg_e
      msg_z: [compactionPart("p_z", "msg_z", "msg_e")],
    }

    const out = orderCompactionTurnsChronologically(users, parts).map((m) => m.id)
    expect(out).toEqual(["msg_a", "msg_y", "msg_c", "msg_z", "msg_e"])
  })
})
