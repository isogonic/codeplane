import { describe, expect, test } from "bun:test"
import { shouldDeliverEvent } from "../../src/tui/util/event-routing"

const DIR = "/Users/me/project"
const OTHER = "/Users/me/other"
const WS = "ws_abc"

describe("shouldDeliverEvent", () => {
  test("global events are always delivered", () => {
    expect(
      shouldDeliverEvent({ directory: "global", eventWorkspace: undefined, currentWorkspace: WS, instanceDirectory: DIR }),
    ).toBe(true)
  })

  test("no active workspace: delivered iff directory matches", () => {
    expect(
      shouldDeliverEvent({ directory: DIR, eventWorkspace: undefined, currentWorkspace: undefined, instanceDirectory: DIR }),
    ).toBe(true)
    expect(
      shouldDeliverEvent({ directory: OTHER, eventWorkspace: undefined, currentWorkspace: undefined, instanceDirectory: DIR }),
    ).toBe(false)
  })

  test("active workspace + matching event workspace is delivered", () => {
    expect(
      shouldDeliverEvent({ directory: OTHER, eventWorkspace: WS, currentWorkspace: WS, instanceDirectory: DIR }),
    ).toBe(true)
  })

  // The regression: a workspace-scoped session, but the streaming delta is
  // stamped workspace:undefined by the prompt-queue worker. Must still be
  // delivered via the directory fallback (was dropped -> ~15s poll-only).
  test("active workspace + undefined event workspace + matching directory IS delivered (15s-cadence fix)", () => {
    expect(
      shouldDeliverEvent({ directory: DIR, eventWorkspace: undefined, currentWorkspace: WS, instanceDirectory: DIR }),
    ).toBe(true)
  })

  test("events from a different instance directory are isolated", () => {
    expect(
      shouldDeliverEvent({ directory: OTHER, eventWorkspace: undefined, currentWorkspace: WS, instanceDirectory: DIR }),
    ).toBe(false)
  })
})
