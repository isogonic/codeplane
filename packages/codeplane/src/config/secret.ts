export * as ConfigSecret from "./secret"

import path from "path"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Context, Effect, Layer, Semaphore } from "effect"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"
import { Global } from "@/global"
import { Filesystem } from "@/util"

// Single global secrets file ⇒ one process-wide lock serializes its writes.
const setLock = Semaphore.makeUnsafe(1)

const INVALID_SEGMENT = /[^a-z0-9._-]+/g
const EDGE_SEPARATOR = /^[._-]+|[._-]+$/g

const FORMATTING = { insertSpaces: true, tabSize: 2 }
const HEADER = "// Instance secrets. Reference any value below as {secret:<name>} in codeplane.jsonc.\n"

export function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(INVALID_SEGMENT, "-").replace(EDGE_SEPARATOR, "")
}

export function placeholder(name: string) {
  return `{secret:${normalizeName(name)}}`
}

// secrets.jsonc is the single secret store for this instance. It lives in the
// instance config folder next to codeplane.jsonc and is meant to be hand-edited.
export function filepath() {
  return path.join(Global.Path.config, "secrets.jsonc")
}

// Pre-secrets.jsonc instances stored one file per secret under data/secrets/.
// Kept as a read-only fallback so those references keep resolving.
function legacyFilepath(name: string) {
  return path.join(Global.Path.secrets, normalizeName(name))
}

function assertName(name: string) {
  const normalized = normalizeName(name)
  if (!normalized) {
    throw new Error("Secret names must contain at least one letter or number")
  }
  return normalized
}

function parseSecrets(text: string | undefined): Record<string, string> {
  if (!text?.trim()) return {}
  const parsed = parseJsonc(text)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

// Plain (non-Effect) reader used by config variable resolution for {secret:name}.
// Reads secrets.jsonc, then falls back to the legacy per-name file.
export async function read(name: string): Promise<string | undefined> {
  const secrets = parseSecrets(await Filesystem.readText(filepath()).catch(() => undefined))
  if (name in secrets) return secrets[name]
  const normalized = normalizeName(name)
  if (normalized !== name && normalized in secrets) return secrets[normalized]
  const legacy = await Filesystem.readText(legacyFilepath(name)).catch(() => undefined)
  return legacy === undefined ? undefined : legacy.trim()
}

export interface Interface {
  readonly set: (name: string, value: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/ConfigSecret") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const set = Effect.fn("ConfigSecret.set")(function* (name: string, value: string) {
      // Serialize the read-modify-write. secretizeUnknown extracts secrets with
      // `concurrency: "unbounded"`, so without this every concurrent set reads
      // the same `before` and last-write-wins dropped all but one secret.
      yield* setLock.withPermits(1)(
        Effect.gen(function* () {
          const normalized = assertName(name)
          const target = filepath()
          const exists = yield* fs.existsSafe(target)
          const before = exists ? yield* fs.readFileString(target).pipe(Effect.orDie) : ""
          const base = before.trim() ? before : `${HEADER}{}\n`
          const next = applyEdits(base, modify(base, [normalized], value, { formattingOptions: FORMATTING }))
          yield* fs.writeWithDirs(target, next, 0o600).pipe(Effect.orDie)
        }),
      )
    })

    return Service.of({ set })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
