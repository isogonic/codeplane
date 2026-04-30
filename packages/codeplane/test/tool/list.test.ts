import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { ListTool } from "../../src/tool/list"
import { Truncate } from "../../src/tool"
import { Tool } from "../../src/tool"
import { Filesystem } from "../../src/util"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer),
)

const init = Effect.fn("ListToolTest.init")(function* () {
  const info = yield* ListTool
  return yield* info.init()
})

const run = Effect.fn("ListToolTest.run")(function* (
  args: Tool.InferParameters<typeof ListTool>,
  next: Tool.Context = ctx,
) {
  const tool = yield* init()
  return yield* tool.execute(args, next)
})

const exec = Effect.fn("ListToolTest.exec")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ListTool>,
  next: Tool.Context = ctx,
) {
  return yield* provideInstance(dir)(run(args, next))
})

const fail = Effect.fn("ListToolTest.fail")(function* (
  dir: string,
  args: Tool.InferParameters<typeof ListTool>,
  next: Tool.Context = ctx,
) {
  const exit = yield* exec(dir, args, next).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected list to fail")
})

const full = (p: string) => (process.platform === "win32" ? Filesystem.normalizePath(p) : p)
const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  return {
    items,
    next: {
      ...ctx,
      ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
        Effect.sync(() => {
          items.push(req)
        }),
    },
  }
}

const put = Effect.fn("ListToolTest.put")(function* (p: string, content = "") {
  const fs = yield* AppFileSystem.Service
  yield* fs.writeWithDirs(p, content)
})

const mkdir = Effect.fn("ListToolTest.mkdir")(function* (p: string) {
  const fs = yield* AppFileSystem.Service
  yield* fs.makeDirectory(p, { recursive: true })
})

describe("tool.list", () => {
  it.live("lists directory entries with subdirectory suffixes", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "b.txt"))
      yield* mkdir(path.join(dir, "subdir"))
      yield* put(path.join(dir, "a.txt"))

      const result = yield* exec(dir, { path: dir })
      expect(result.output).toContain("<type>directory</type>")
      expect(result.output).toContain("a.txt")
      expect(result.output).toContain("b.txt")
      expect(result.output).toContain("subdir/")
      expect(result.metadata.count).toBe(3)
      expect(result.metadata.truncated).toBe(false)
    }),
  )

  it.live("defaults to the current directory", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "test.txt"))

      const result = yield* exec(dir, {})
      expect(result.output).toContain("test.txt")
    }),
  )

  it.live("uses list permission for directory listing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      yield* put(path.join(dir, "test.txt"))
      const { items, next } = asks()

      yield* exec(dir, { path: dir }, next)
      expect(items.find((item) => item.permission === "list")?.patterns).toEqual([full(dir)])
      expect(items.find((item) => item.permission === "read")).toBeUndefined()
    }),
  )

  it.live("asks for directory-scoped external_directory permission outside project", () =>
    Effect.gen(function* () {
      const outer = yield* tmpdirScoped()
      const dir = yield* tmpdirScoped({ git: true })
      yield* put(path.join(outer, "external", "a.txt"), "a")
      const { items, next } = asks()

      yield* exec(dir, { path: path.join(outer, "external") }, next)
      const ext = items.find((item) => item.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext!.patterns).toContain(glob(path.join(outer, "external", "*")))
    }),
  )

  it.live("rejects file paths", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const file = path.join(dir, "test.txt")
      yield* put(file, "content")

      const err = yield* fail(dir, { path: file })
      expect(err.message).toContain("list path must be a directory")
    }),
  )
})
