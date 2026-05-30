export * as NpmConfig from "./config"

import fs from "node:fs/promises"
import path from "path"
import npa from "npm-package-arg"
import { Schema } from "effect"
import z from "zod"
import { ConfigParse } from "@/config/parse"
import { zod as effectZod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { isRecord } from "@/util/record"

export const Client = Schema.Literals(["auto", "npm", "pnpm", "bun", "yarn"]).pipe(
  withStatics((s) => ({ zod: effectZod(s) })),
)
export type Client = Schema.Schema.Type<typeof Client>
export type PackageManager = Exclude<Client, "auto">

export const Registry = Schema.Struct({
  registry: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
  always_auth: Schema.optional(Schema.Boolean),
}).pipe(withStatics((s) => ({ zod: effectZod(s) })))
export type Registry = Schema.Schema.Type<typeof Registry>

export const Info = Schema.Struct({
  client: Schema.optional(Client),
  registry: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
  always_auth: Schema.optional(Schema.Boolean),
  scopes: Schema.optional(Schema.Record(Schema.String, Registry)),
}).pipe(withStatics((s) => ({ zod: effectZod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

const Root = z
  .object({
    npm: Info.zod.optional(),
  })
  .passthrough()

const CONFIG_FILES = ["codeplane.jsonc", "codeplane.json", "config.json"]
const LOCK_TO_CLIENT = [
  { client: "bun", file: "bun.lock" },
  { client: "bun", file: "bun.lockb" },
  { client: "pnpm", file: "pnpm-lock.yaml" },
  { client: "yarn", file: "yarn.lock" },
  { client: "npm", file: "package-lock.json" },
] as const satisfies ReadonlyArray<{ client: PackageManager; file: string }>

export type PackageSettings = {
  always_auth?: boolean
  registry?: string
  token?: string
}

export type Resolved = {
  client: PackageManager
  config: Info
  npmrc: string
  options: Record<string, string | boolean>
  settings: PackageSettings
  sources: string[]
}

function exists(file: string) {
  return fs.access(file).then(() => true).catch(() => false)
}

function normalizeRegistry(value: string | undefined) {
  if (!value?.trim()) return
  try {
    const url = new URL(value.trim())
    if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`
    return url.toString()
  } catch {
    return value.trim()
  }
}

function normalizeScope(scope: string) {
  const value = scope.trim()
  if (!value) return
  return value.startsWith("@") ? value : `@${value}`
}

function packageName(spec: string | undefined) {
  if (!spec) return
  try {
    return npa(spec).name ?? spec
  } catch {
    return spec
  }
}

function packageScope(spec: string | undefined) {
  const name = packageName(spec)
  if (!name?.startsWith("@")) return
  const slash = name.indexOf("/")
  if (slash === -1) return
  return name.slice(0, slash)
}

function registryKey(registry: string) {
  try {
    const url = new URL(registry)
    const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
    return `//${url.host}${pathname}:_authToken`
  } catch {
    return
  }
}

function merge(base: Info, next: Info): Info {
  type Scope = NonNullable<Info["scopes"]>[string]
  const scopes: Record<string, Scope> = { ...(base.scopes ?? {}) }
  for (const [scope, value] of Object.entries(next.scopes ?? {})) {
    const key = normalizeScope(scope) ?? scope
    // Deep-merge per scope: overriding only one field (e.g. registry) in a
    // later config must not drop the others (e.g. a previously-set authToken).
    scopes[key] = { ...(scopes[key] ?? {}), ...value }
  }

  return {
    ...base,
    ...next,
    registry: normalizeRegistry(next.registry ?? base.registry),
    scopes: Object.keys(scopes).length > 0 ? scopes : undefined,
  }
}

function parsePackageManager(raw: unknown) {
  if (typeof raw !== "string") return
  const [name] = raw.trim().split("@")
  if (name === "npm" || name === "pnpm" || name === "bun" || name === "yarn") return name
}

async function readPackageManager(dir: string) {
  let current = path.resolve(dir)
  while (true) {
    const file = path.join(current, "package.json")
    if (await exists(file)) {
      const json = await Bun.file(file)
        .json()
        .catch(() => undefined)
      const resolved = parsePackageManager(isRecord(json) ? json.packageManager : undefined)
      if (resolved) return resolved
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function readLockManager(dir: string) {
  let current = path.resolve(dir)
  while (true) {
    for (const item of LOCK_TO_CLIENT) {
      if (await exists(path.join(current, item.file))) return item.client
    }
    const parent = path.dirname(current)
    if (parent === current) return
    current = parent
  }
}

async function readInfo(file: string) {
  const text = await Bun.file(file)
    .text()
    .catch(() => undefined)
  if (!text) return
  const parsed = Root.safeParse(ConfigParse.jsonc(text, file))
  if (!parsed.success) return
  return parsed.data.npm
}

async function configSources(dir: string | undefined, globalConfigDir: string) {
  const files = new Set<string>()
  for (const name of CONFIG_FILES) {
    files.add(path.join(globalConfigDir, name))
  }
  if (!dir) return Array.from(files)

  const stack: string[] = []
  let current = path.resolve(dir)
  while (true) {
    stack.push(current)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  for (const base of stack.toReversed()) {
    for (const name of ["codeplane.jsonc", "codeplane.json"]) {
      files.add(path.join(base, name))
      files.add(path.join(base, ".codeplane", name))
    }
  }

  return Array.from(files)
}

export async function load(input: { dir?: string; globalConfigDir: string }) {
  let result: Info = {}
  const sources: string[] = []

  for (const file of await configSources(input.dir, input.globalConfigDir)) {
    if (!(await exists(file))) continue
    const next = await readInfo(file)
    if (!next) continue
    result = merge(result, next)
    sources.push(file)
  }

  return {
    config: result,
    sources,
  }
}

export function packageSettings(config: Info, spec?: string): PackageSettings {
  const scoped = packageScope(spec)
  const scopeConfig = scoped ? config.scopes?.[normalizeScope(scoped) ?? scoped] : undefined
  return {
    always_auth: scopeConfig?.always_auth ?? config.always_auth,
    registry: normalizeRegistry(scopeConfig?.registry ?? config.registry),
    token: scopeConfig?.token ?? config.token,
  }
}

export function options(config: Info) {
  const result: Record<string, string | boolean> = {}
  const base = packageSettings(config)
  if (base.registry) result.registry = base.registry
  if (base.always_auth !== undefined) result["always-auth"] = base.always_auth
  if (base.registry && base.token) {
    const key = registryKey(base.registry)
    if (key) result[key] = base.token
  }

  for (const [scope, item] of Object.entries(config.scopes ?? {})) {
    const name = normalizeScope(scope)
    if (!name) continue
    const registry = normalizeRegistry(item.registry ?? base.registry)
    if (registry) result[`${name}:registry`] = registry
    if (!registry || !item.token) continue
    const key = registryKey(registry)
    if (key) result[key] = item.token
  }

  return result
}

export function npmrc(config: Info) {
  const result = options(config)
  return Object.entries(result)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n")
}

export async function resolve(input: { dir?: string; globalConfigDir: string; spec?: string }): Promise<Resolved> {
  const loaded = await load({
    dir: input.dir,
    globalConfigDir: input.globalConfigDir,
  })
  const client =
    loaded.config.client && loaded.config.client !== "auto"
      ? loaded.config.client
      : ((input.dir && (await readPackageManager(input.dir))) || (input.dir && (await readLockManager(input.dir))) || "npm")

  return {
    client,
    config: loaded.config,
    npmrc: npmrc(loaded.config),
    options: options(loaded.config),
    settings: packageSettings(loaded.config, input.spec),
    sources: loaded.sources,
  }
}
