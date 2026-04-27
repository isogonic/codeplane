import { Effect, Layer, Context, Schema } from "effect"
import { Bus } from "@/bus"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import path from "path"

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

function normalizeDiffs(diffs: Snapshot.FileDiff[]) {
  return diffs.map((item) => {
    const file = unquoteGitPath(item.file)
    if (file === item.file) return item
    return { ...item, file }
  })
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function diffStatus(input: unknown) {
  if (input === "added" || input === "add") return "added"
  if (input === "deleted" || input === "delete") return "deleted"
  if (input === "modified" || input === "move") return "modified"
}

function normalizeMetadataFile(file: string, root?: string) {
  const value = file.replaceAll("\\", "/")
  if (!root || !path.isAbsolute(file)) return value
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return value
  return relative.replaceAll("\\", "/")
}

function metadataFileDiff(input: unknown, root?: string): Snapshot.FileDiff[] {
  if (!isRecord(input)) return []
  const file =
    typeof input.file === "string"
      ? input.file
      : typeof input.relativePath === "string"
        ? input.relativePath
        : typeof input.filePath === "string"
          ? input.filePath
          : undefined
  if (!file) return []
  const status = diffStatus(input.status) ?? diffStatus(input.type)
  return [
    {
      file: normalizeMetadataFile(file, root),
      patch: typeof input.patch === "string" ? input.patch : "",
      additions: typeof input.additions === "number" && Number.isFinite(input.additions) ? input.additions : 0,
      deletions: typeof input.deletions === "number" && Number.isFinite(input.deletions) ? input.deletions : 0,
      ...(status ? { status } : {}),
    },
  ]
}

function metadataDiffs(input: unknown, root?: string): Snapshot.FileDiff[] {
  if (!isRecord(input)) return []
  return [
    ...metadataFileDiff(input.filediff, root),
    ...(Array.isArray(input.files) ? input.files.flatMap((file) => metadataFileDiff(file, root)) : []),
  ]
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: MessageV2.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      const toolDiffs = input.messages.flatMap((item) =>
        item.parts.flatMap((part) => {
          if (part.type !== "tool" || part.state.status !== "completed") return []
          return metadataDiffs(part.state.metadata, item.info.role === "assistant" ? item.info.path.root : undefined)
        }),
      )
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) {
        const diffs = yield* snapshot.diffFull(from, to).pipe(Effect.catch(() => Effect.succeed([])))
        if (diffs.length > 0) return diffs
      }
      return toolDiffs
    })

    const summarize = Effect.fn("SessionSummary.summarize")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      const all = yield* sessions.messages({ sessionID: input.sessionID })
      if (!all.length) return

      const diffs = yield* computeDiff({ messages: all })
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })

      const messages = all.filter(
        (m) => m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
      )
      const target = messages.find((m) => m.info.id === input.messageID)
      if (!target || target.info.role !== "user") return
      const msgDiffs = yield* computeDiff({ messages })
      target.info.summary = { ...target.info.summary, diffs: msgDiffs }
      yield* sessions.updateMessage(target.info)
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const diffs = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const cached = normalizeDiffs(diffs)
      const changed = cached.some((item, i) => item.file !== diffs[i]?.file)
      if (cached.length > 0) {
        if (changed) yield* storage.write(["session_diff", input.sessionID], cached).pipe(Effect.ignore)
        return cached
      }

      const all = yield* sessions.messages({ sessionID: input.sessionID })
      const messages = input.messageID
        ? all.filter(
            (m) =>
              m.info.id === input.messageID || (m.info.role === "assistant" && m.info.parentID === input.messageID),
          )
        : all
      const next = normalizeDiffs(yield* computeDiff({ messages }).pipe(Effect.catch(() => Effect.succeed([]))))
      if (!input.messageID && next.length > 0) {
        yield* storage.write(["session_diff", input.sessionID], next).pipe(Effect.ignore)
        yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: next })
      }
      return next
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export * as SessionSummary from "./summary"
