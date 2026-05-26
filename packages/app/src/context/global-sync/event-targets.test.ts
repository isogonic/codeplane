import { describe, expect, test } from "bun:test"
import { globalEventTargetDirectories } from "./event-targets"

type TestSession = {
  id: string
  directory: string
  projectID?: string
}

const store = (input: { project?: string; sessions?: TestSession[] }) => ({
  project: input.project ?? "",
  session: input.sessions ?? [],
})

const session = (input: TestSession) => input

describe("globalEventTargetDirectories", () => {
  test("routes direct events to their source directory store", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo",
        event: { type: "session.status", properties: { sessionID: "ses_1" } },
        stores: [{ directory: "/repo", store: store({ project: "project" }) }],
      }),
    ).toEqual(["/repo"])
  })

  test("routes session info events to open parent project stores", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/packages/app",
        event: {
          type: "session.created",
          properties: { info: session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" }) },
        },
        stores: [
          { directory: "/repo", store: store({ project: "project" }) },
          { directory: "/repo/packages/app", store: store({ project: "project" }) },
        ],
      }),
    ).toEqual(["/repo", "/repo/packages/app"])
  })

  test("does not route nested project sessions into an ancestor project store", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/nested",
        event: {
          type: "session.created",
          properties: { info: session({ id: "ses_1", directory: "/repo/nested", projectID: "child" }) },
        },
        stores: [{ directory: "/repo", store: store({ project: "parent" }) }],
      }),
    ).toEqual([])
  })

  test("does not route nested project sessions into an ancestor store before project metadata loads", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/nested",
        event: {
          type: "session.created",
          properties: { info: session({ id: "ses_1", directory: "/repo/nested", projectID: "child" }) },
        },
        stores: [{ directory: "/repo", store: store({}) }],
      }),
    ).toEqual([])
  })

  test("keeps direct events flowing to the source store before project metadata loads", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/nested",
        event: {
          type: "session.created",
          properties: { info: session({ id: "ses_1", directory: "/repo/nested", projectID: "child" }) },
        },
        stores: [{ directory: "/repo/nested", store: store({}) }],
      }),
    ).toEqual(["/repo/nested"])
  })

  test("routes session status to stores that already know the session", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/packages/app",
        event: { type: "session.status", properties: { sessionID: "ses_1" } },
        stores: [
          {
            directory: "/repo",
            store: store({
              project: "project",
              sessions: [session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" })],
            }),
          },
          {
            directory: "/repo-other",
            store: store({
              project: "other",
              sessions: [session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" })],
            }),
          },
        ],
      }),
    ).toEqual(["/repo"])
  })

  test("routes streaming deltas to stores that already know the session", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/packages/app",
        event: {
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            messageID: "msg_1",
            partID: "prt_1",
            field: "text",
            delta: "hello",
          },
        },
        stores: [
          {
            directory: "/repo",
            store: store({
              project: "project",
              sessions: [session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" })],
            }),
          },
        ],
      }),
    ).toEqual(["/repo"])
  })

  test("routes message updates by the message session id instead of the message id", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/packages/app",
        event: {
          type: "message.updated",
          properties: { info: { id: "msg_1", sessionID: "ses_1" } },
        },
        stores: [
          {
            directory: "/repo",
            store: store({
              project: "project",
              sessions: [session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" })],
            }),
          },
        ],
      }),
    ).toEqual(["/repo"])
  })

  test("routes part snapshots by the part session id", () => {
    expect(
      globalEventTargetDirectories({
        source: "/repo/packages/app",
        event: {
          type: "message.part.updated",
          properties: { part: { id: "prt_1", messageID: "msg_1", sessionID: "ses_1" } },
        },
        stores: [
          {
            directory: "/repo",
            store: store({
              project: "project",
              sessions: [session({ id: "ses_1", directory: "/repo/packages/app", projectID: "project" })],
            }),
          },
        ],
      }),
    ).toEqual(["/repo"])
  })
})
