import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Bus } from "../../src/bus"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { NotFoundError, Storage } from "../../src/storage"

const sessionID = SessionID.descending("ses_summary")
const userID = MessageID.ascending("msg_user")
const assistantID = MessageID.ascending("msg_assistant")
const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }

const user: MessageV2.User = {
  id: userID,
  sessionID,
  role: "user",
  time: { created: 1 },
  agent: "build",
  model,
}

const assistant = (parts: MessageV2.Part[]): MessageV2.WithParts => ({
  info: {
    id: assistantID,
    sessionID,
    role: "assistant",
    time: { created: 2 },
    parentID: userID,
    providerID: model.providerID,
    modelID: model.modelID,
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp/project", root: "/tmp/project" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  },
  parts,
})

const messages = (parts: MessageV2.Part[]): MessageV2.WithParts[] => [{ info: user, parts: [] }, assistant(parts)]

const key = (input: string[]) => input.join("\0")

function storageLayer(store: Map<string, unknown>) {
  return Layer.succeed(
    Storage.Service,
    Storage.Service.of({
      remove: (input) =>
        Effect.sync(() => {
          store.delete(key(input))
        }),
      read: <T>(input: string[]) => {
        const value = store.get(key(input))
        if (value === undefined) return Effect.fail(new NotFoundError({ message: `missing ${input.join("/")}` }))
        return Effect.succeed(structuredClone(value) as T)
      },
      update: <T>(input: string[], fn: (draft: T) => void) => {
        const value = store.get(key(input))
        if (value === undefined) return Effect.fail(new NotFoundError({ message: `missing ${input.join("/")}` }))
        const draft = structuredClone(value) as T
        return Effect.sync(() => {
          fn(draft)
          store.set(key(input), structuredClone(draft))
          return draft
        })
      },
      write: (input, content) =>
        Effect.sync(() => {
          store.set(key(input), structuredClone(content))
        }),
      list: (prefix) =>
        Effect.succeed(
          Array.from(store.keys())
            .filter((item) => item.startsWith(key(prefix)))
            .map((item) => item.split("\0")),
        ),
    }),
  )
}

function sessionLayer(input: MessageV2.WithParts[]) {
  const unexpected = () => Effect.die("unexpected session call")
  return Layer.succeed(
    Session.Service,
    Session.Service.of({
      create: unexpected,
      fork: unexpected,
      touch: unexpected,
      get: unexpected,
      setTitle: unexpected,
      setArchived: unexpected,
      setPermission: unexpected,
      setRevert: unexpected,
      clearRevert: unexpected,
      setSummary: unexpected,
      diff: unexpected,
      messages: () => Effect.succeed(input),
      children: () => Effect.succeed([]),
      remove: unexpected,
      updateMessage: (message) => Effect.succeed(message),
      removeMessage: unexpected,
      removePart: unexpected,
      getPart: () => Effect.succeed(undefined),
      updatePart: (part) => Effect.succeed(part),
      updatePartDelta: unexpected,
      findMessage: unexpected,
    }),
  )
}

function snapshotLayer(diffs: Snapshot.FileDiff[]) {
  return Layer.succeed(
    Snapshot.Service,
    Snapshot.Service.of({
      init: () => Effect.void,
      cleanup: () => Effect.void,
      track: () => Effect.succeed("from"),
      patch: () => Effect.succeed({ hash: "to", files: [] }),
      restore: () => Effect.void,
      revert: () => Effect.void,
      diff: () => Effect.succeed(""),
      diffFull: (from, to) => Effect.succeed(from === "from" && to === "to" ? diffs : []),
    }),
  )
}

const busLayer = Layer.succeed(
  Bus.Service,
  Bus.Service.of({
    publish: () => Effect.void,
    publishLocal: () => Effect.void,
    subscribe: () => Stream.empty,
    subscribeAll: () => Stream.empty,
    subscribeCallback: () => Effect.succeed(() => {}),
    subscribeAllCallback: () => Effect.succeed(() => {}),
  }),
)

async function run(
  input: {
    messages: MessageV2.WithParts[]
    snapshotDiffs?: Snapshot.FileDiff[]
  },
  body: (store: Map<string, unknown>) => Effect.Effect<void, never, SessionSummary.Service>,
) {
  const store = new Map<string, unknown>()
  return Effect.runPromise(
    body(store).pipe(
      Effect.provide(
        SessionSummary.layer.pipe(
          Layer.provide(sessionLayer(input.messages)),
          Layer.provide(snapshotLayer(input.snapshotDiffs ?? [])),
          Layer.provide(storageLayer(store)),
          Layer.provide(busLayer),
        ),
      ),
    ),
  )
}

describe("SessionSummary.diff", () => {
  test("does not attribute snapshot-only ambient changes to a message", async () => {
    const ambient: Snapshot.FileDiff = {
      file: "src/ambient.ts",
      patch: "",
      additions: 57,
      deletions: 0,
      status: "modified",
    }

    await run(
      {
        snapshotDiffs: [ambient],
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ]),
      },
      (store) =>
        Effect.gen(function* () {
          store.set(key(["session_diff", sessionID]), [ambient])
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID, messageID: userID })).toEqual([])
        }),
    )
  })

  test("filters message snapshot diffs to files changed by completed tools", async () => {
    const changed: Snapshot.FileDiff = {
      file: "src/app.ts",
      patch: "snapshot patch",
      additions: 4,
      deletions: 1,
      status: "modified",
    }
    const ambient: Snapshot.FileDiff = {
      file: "src/ambient.ts",
      patch: "ambient patch",
      additions: 57,
      deletions: 0,
      status: "modified",
    }

    await run(
      {
        snapshotDiffs: [changed, ambient],
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_tool"),
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: "call_1",
            tool: "edit",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Edit",
              metadata: {
                filediff: {
                  file: "/tmp/project/src/app.ts",
                  patch: "tool patch",
                  additions: 1,
                  deletions: 1,
                },
              },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ]),
      },
      () =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID, messageID: userID })).toEqual([changed])
        }),
    )
  })

  test("recomputes and persists missing snapshot diffs when a patch part follows the finish snapshot", async () => {
    const diff: Snapshot.FileDiff = {
      file: "src/app.ts",
      patch: "",
      additions: 4,
      deletions: 1,
      status: "modified",
    }

    await run(
      {
        snapshotDiffs: [diff],
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
          {
            id: PartID.ascending("prt_patch"),
            sessionID,
            messageID: assistantID,
            type: "patch",
            hash: "from",
            files: ["src/app.ts"],
          },
        ]),
      },
      (store) =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID })).toEqual([diff])
          expect(store.get(key(["session_diff", sessionID]))).toEqual([diff])
        }),
    )
  })

  test("falls back to apply patch metadata when snapshots are empty", async () => {
    await run(
      {
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_tool"),
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: "call_1",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Patch",
              metadata: {
                files: [
                  {
                    relativePath: "src/new.ts",
                    type: "add",
                    patch: "",
                    additions: 8,
                    deletions: 0,
                  },
                ],
              },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ]),
      },
      () =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID })).toEqual([
            {
              file: "src/new.ts",
              patch: "",
              additions: 8,
              deletions: 0,
              status: "added",
            },
          ])
        }),
    )
  })

  test("falls back to single file diff metadata when snapshots are empty", async () => {
    await run(
      {
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_tool"),
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: "call_1",
            tool: "edit",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Edit",
              metadata: {
                filediff: {
                  file: "/tmp/project/src/app.ts",
                  patch: "",
                  additions: 3,
                  deletions: 1,
                },
              },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ]),
      },
      () =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID })).toEqual([
            {
              file: "src/app.ts",
              patch: "",
              additions: 3,
              deletions: 1,
            },
          ])
        }),
    )
  })

  test("falls back to edit tool filediff metadata when snapshots are empty", async () => {
    await run(
      {
        messages: messages([
          {
            id: PartID.ascending("prt_start"),
            sessionID,
            messageID: assistantID,
            type: "step-start",
            snapshot: "from",
          },
          {
            id: PartID.ascending("prt_tool"),
            sessionID,
            messageID: assistantID,
            type: "tool",
            callID: "call_1",
            tool: "edit",
            state: {
              status: "completed",
              input: {},
              output: "",
              title: "Edit",
              metadata: {
                filediff: {
                  file: "/tmp/project/src/app.ts",
                  patch: "@@ -1 +1 @@\n-old\n+new\n",
                  additions: 1,
                  deletions: 1,
                },
              },
              time: { start: 1, end: 2 },
            },
          },
          {
            id: PartID.ascending("prt_finish"),
            sessionID,
            messageID: assistantID,
            type: "step-finish",
            reason: "stop",
            snapshot: "to",
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ]),
      },
      () =>
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          expect(yield* summary.diff({ sessionID })).toEqual([
            {
              file: "src/app.ts",
              patch: "@@ -1 +1 @@\n-old\n+new\n",
              additions: 1,
              deletions: 1,
            },
          ])
        }),
    )
  })
})
