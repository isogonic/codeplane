import { describe, expect, test } from "bun:test"
import type { Message } from "@codeplane-ai/sdk/v2/client"
import { base64Decode } from "@codeplane-ai/shared/util/encode"
import { messageCursor, trimSessionMessages } from "./session-page"

const message = (id: string, created: number) =>
  ({
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created },
  }) as Message

describe("session page cache", () => {
  test("encodes cursors that match the message API paging cursor", () => {
    expect(JSON.parse(base64Decode(messageCursor(message("msg_2", 20))))).toEqual({ id: "msg_2", time: 20 })
  })

  test("trims cached sessions to the recent page and keeps a load-more cursor", () => {
    const result = trimSessionMessages({
      messages: [message("msg_1", 10), message("msg_2", 20), message("msg_3", 30)],
      limit: 2,
    })

    expect(result?.items.map((item) => item.id)).toEqual(["msg_2", "msg_3"])
    expect(result?.complete).toBe(false)
    expect(result?.cursor ? JSON.parse(base64Decode(result.cursor)) : undefined).toEqual({ id: "msg_2", time: 20 })
  })

  test("leaves already bounded pages unchanged", () => {
    expect(trimSessionMessages({ messages: [message("msg_1", 10)], limit: 2 })).toBeUndefined()
  })
})
