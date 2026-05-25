import { describe, expect, test } from "bun:test"
import {
  acceptKey,
  autoRespondsPermission,
  directoryAcceptKey,
  GLOBAL_AUTO_ACCEPT_KEY,
  isDirectoryAutoAccepting,
} from "../../src/tui/util/permission-auto-respond"

const sessions = [
  { id: "root" },
  { id: "child", parentID: "root" },
  { id: "grandchild", parentID: "child" },
]

describe("tui permission auto respond", () => {
  test("accepts child-session permissions through the root session toggle", () => {
    const directory = "/tmp/project"
    const autoAccept = {
      [acceptKey("root", directory)]: true,
    }

    expect(autoRespondsPermission(autoAccept, sessions, { sessionID: "grandchild" }, directory)).toBe(true)
  })

  test("allows a child session to override an accepted parent", () => {
    const directory = "/tmp/project"
    const autoAccept = {
      [acceptKey("root", directory)]: true,
      [acceptKey("child", directory)]: false,
    }

    expect(autoRespondsPermission(autoAccept, sessions, { sessionID: "grandchild" }, directory)).toBe(false)
  })

  test("supports directory and global auto-accept records", () => {
    const directory = "/tmp/project"

    expect(isDirectoryAutoAccepting({ [directoryAcceptKey(directory)]: true }, directory)).toBe(true)
    expect(
      autoRespondsPermission({ [directoryAcceptKey(directory)]: true }, sessions, { sessionID: "child" }, directory),
    ).toBe(true)
    expect(
      autoRespondsPermission({ [GLOBAL_AUTO_ACCEPT_KEY]: true }, sessions, { sessionID: "child" }, directory),
    ).toBe(true)
  })
})
