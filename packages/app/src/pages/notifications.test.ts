import { describe, expect, test } from "bun:test"
import { base64Encode } from "@codeplane-ai/shared/util/encode"
import { notificationHref } from "./notifications-utils"

describe("notificationHref", () => {
  test("links session notifications to their session route", () => {
    expect(notificationHref({ directory: "/tmp/project", session: "session-1" })).toBe(
      `/${base64Encode("/tmp/project")}/session/session-1`,
    )
  })

  test("links global project notifications to the project route", () => {
    expect(notificationHref({ directory: "/tmp/project", session: "global" })).toBe(`/${base64Encode("/tmp/project")}`)
  })

  test("skips notifications without a directory target", () => {
    expect(notificationHref({})).toBeUndefined()
  })
})
