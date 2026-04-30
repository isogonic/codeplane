import path from "path"
import { Effect, Schema } from "effect"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./list.txt"
import * as Tool from "./tool"

const DEFAULT_LIST_LIMIT = 2000

export const Parameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description:
      "The directory to list. Defaults to the current working directory. Must be a directory path if provided.",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "The entry number to start listing from (1-indexed)",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "The maximum number of entries to list (defaults to 2000)",
  }),
})

export const ListTool = Tool.define(
  "list",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const entries = Effect.fn("ListTool.entries")(function* (dir: string) {
      const items = yield* fs.readDirectoryEntries(dir)
      return yield* Effect.forEach(
        items,
        Effect.fnUntraced(function* (item) {
          if (item.type === "directory") return item.name + "/"
          if (item.type !== "symlink") return item.name

          const target = yield* fs.stat(path.join(dir, item.name)).pipe(Effect.catch(() => Effect.void))
          if (target?.type === "Directory") return item.name + "/"
          return item.name
        }),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((items: string[]) => items.sort((a, b) => a.localeCompare(b))))
    })

    const run = Effect.fn("ListTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (params.offset !== undefined && params.offset < 1) {
        return yield* Effect.fail(new Error("offset must be greater than or equal to 1"))
      }

      const ins = yield* InstanceState.context
      const dir = AppFileSystem.resolve(
        path.isAbsolute(params.path ?? ins.directory)
          ? (params.path ?? ins.directory)
          : path.join(ins.directory, params.path ?? "."),
      )
      const stat = yield* fs.stat(dir).pipe(Effect.catch(() => Effect.succeed(undefined)))

      yield* assertExternalDirectoryEffect(ctx, dir, { kind: "directory" })
      yield* ctx.ask({
        permission: "list",
        patterns: [dir],
        always: ["*"],
        metadata: {
          path: dir,
        },
      })

      if (!stat) return yield* Effect.fail(new Error(`Directory not found: ${dir}`))
      if (stat.type !== "Directory") return yield* Effect.fail(new Error(`list path must be a directory: ${dir}`))

      const all = yield* entries(dir)
      const limit = params.limit ?? DEFAULT_LIST_LIMIT
      const offset = params.offset ?? 1
      const sliced = all.slice(offset - 1, offset - 1 + limit)
      const truncated = offset - 1 + sliced.length < all.length

      return {
        title: path.relative(ins.worktree, dir),
        output: [
          `<path>${dir}</path>`,
          `<type>directory</type>`,
          "<entries>",
          sliced.join("\n"),
          truncated
            ? `\n(Showing ${sliced.length} of ${all.length} entries. Use offset=${offset + sliced.length} to continue.)`
            : `\n(${all.length} entries)`,
          "</entries>",
        ].join("\n"),
        metadata: {
          preview: sliced.slice(0, 20).join("\n"),
          count: all.length,
          truncated,
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
