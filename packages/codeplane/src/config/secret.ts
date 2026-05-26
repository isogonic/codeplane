export * as ConfigSecret from "./secret"

import path from "path"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Global } from "@/global"
import { withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"

export const Entry = Schema.Struct({
  name: Schema.String,
  placeholder: Schema.String,
  updated_at: Schema.Number,
})
  .annotate({ identifier: "ConfigSecretEntry" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Entry = Schema.Schema.Type<typeof Entry>

const INVALID_SEGMENT = /[^a-z0-9._-]+/g
const EDGE_SEPARATOR = /^[._-]+|[._-]+$/g
const RESERVED = new Set(["agents.md", "readme.md"])

export function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(INVALID_SEGMENT, "-").replace(EDGE_SEPARATOR, "")
}

export function placeholder(name: string) {
  return `{secret:${normalizeName(name)}}`
}

export function dirpath() {
  return Global.Path.secrets
}

export function filepath(name: string) {
  return path.join(dirpath(), normalizeName(name))
}

function assertName(name: string) {
  const normalized = normalizeName(name)
  if (!normalized) {
    throw new Error("Secret names must contain at least one letter or number")
  }
  if (RESERVED.has(normalized)) {
    throw new Error("That secret name is reserved by Codeplane")
  }
  return normalized
}

function updatedAt(info: { mtime: Option.Option<Date> }) {
  return Option.getOrUndefined(info.mtime)?.getTime() ?? Date.now()
}

export interface Interface {
  readonly list: () => Effect.Effect<Entry[]>
  readonly get: (name: string) => Effect.Effect<string | undefined>
  readonly set: (name: string, value: string) => Effect.Effect<Entry>
  readonly remove: (name: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/ConfigSecret") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const list = Effect.fn("ConfigSecret.list")(function* () {
      yield* fs.ensureDir(dirpath()).pipe(Effect.orDie)
      const entries = yield* fs.readDirectoryEntries(dirpath()).pipe(Effect.orElseSucceed(() => []))
      return yield* Effect.forEach(
        entries
          .filter((entry) => entry.type === "file" && !RESERVED.has(entry.name.toLowerCase()))
          .map((entry) => entry.name)
          .sort((a, b) => a.localeCompare(b)),
        (name) =>
          Effect.gen(function* () {
            const info = yield* fs.stat(filepath(name)).pipe(Effect.orDie)
            return {
              name,
              placeholder: placeholder(name),
              updated_at: updatedAt(info),
            } satisfies Entry
          }),
        { concurrency: "unbounded" },
      )
    })

    const get = Effect.fn("ConfigSecret.get")(function* (name: string) {
      const normalized = assertName(name)
      const target = filepath(normalized)
      const exists = yield* fs.existsSafe(target)
      if (!exists) return undefined
      return yield* fs.readFileString(target).pipe(Effect.orDie)
    })

    const set = Effect.fn("ConfigSecret.set")(function* (name: string, value: string) {
      const normalized = assertName(name)
      yield* fs.writeWithDirs(filepath(normalized), value, 0o600).pipe(Effect.orDie)
      const info = yield* fs.stat(filepath(normalized)).pipe(Effect.orDie)
      return {
        name: normalized,
        placeholder: placeholder(normalized),
        updated_at: updatedAt(info),
      } satisfies Entry
    })

    const remove = Effect.fn("ConfigSecret.remove")(function* (name: string) {
      const normalized = assertName(name)
      const target = filepath(normalized)
      const exists = yield* fs.existsSafe(target)
      if (!exists) return false
      yield* fs.remove(target).pipe(Effect.orDie)
      return true
    })

    return Service.of({
      list,
      get,
      set,
      remove,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
