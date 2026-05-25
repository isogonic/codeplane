export * as Npm from "."

import path from "path"
import { fileURLToPath } from "url"
import npa from "npm-package-arg"
import semver from "semver"
import Config from "@npmcli/config"
import { definitions, flatten, nerfDarts, shorthands } from "@npmcli/config/lib/definitions/index.js"
import { Effect, Schema, Context, Layer, Option, FileSystem, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@codeplane-ai/shared/filesystem"
import { Global } from "@codeplane-ai/shared/global"
import { EffectFlock } from "@codeplane-ai/shared/util/effect-flock"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { NpmConfig } from "./config"

import * as CrossSpawnSpawner from "../effect/cross-spawn-spawner"
import { makeRuntime } from "../effect/runtime"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface EntryPoint {
  readonly client: NpmConfig.PackageManager
  readonly directory: string
  readonly entrypoint: Option.Option<string>
  readonly name: string
  readonly registry: Option.Option<string>
  readonly sources: ReadonlyArray<string>
  readonly spec: string
  readonly version: Option.Option<string>
}

export interface PackageView {
  readonly client: NpmConfig.PackageManager
  readonly latest: Option.Option<string>
  readonly registry: Option.Option<string>
  readonly sources: ReadonlyArray<string>
}

export type InstallPackage = {
  readonly name: string
  readonly version?: string
}

export interface ResolvedEntryPoint {
  readonly client?: NpmConfig.PackageManager
  readonly directory: string
  readonly entrypoint?: string
  readonly name?: string
  readonly registry?: string
  readonly sources?: string[]
  readonly spec?: string
  readonly version?: string
}

export interface Interface {
  readonly add: (
    pkg: string,
    dir?: string,
    input?: {
      add?: InstallPackage[]
    },
  ) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly install: (
    dir: string,
    input?: {
      add: InstallPackage[]
      save?: boolean
    },
  ) => Effect.Effect<void, EffectFlock.LockError | InstallFailedError>
  readonly manager: (dir?: string) => Effect.Effect<NpmConfig.PackageManager>
  readonly outdated: (pkg: string, cachedVersion: string, dir?: string) => Effect.Effect<boolean>
  readonly view: (pkg: string, dir?: string) => Effect.Effect<PackageView>
  readonly which: (pkg: string, bin?: string, dir?: string) => Effect.Effect<Option.Option<string>>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined
const npmPath = fileURLToPath(new URL("../..", import.meta.url))

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

function option<T>(value: T | null | undefined) {
  if (value === null || value === undefined) return Option.none<NonNullable<T>>()
  return Option.some(value as NonNullable<T>)
}

function packageSpec(pkg: InstallPackage) {
  return [pkg.name, pkg.version].filter(Boolean).join("@")
}

function packageName(spec: string) {
  try {
    return npa(spec).name ?? spec
  } catch {
    return spec
  }
}

const loadOptions = (dir: string, env?: Record<string, string>) =>
  Effect.tryPromise({
    try: async () => {
      const config = new Config({
        npmPath,
        cwd: dir,
        env: { ...process.env, ...env },
        argv: [process.execPath, process.execPath],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        flatten,
        nerfDarts,
        shorthands,
        warn: false,
      })
      await config.load()
      return config.flat
    },
    catch: (cause) =>
      new InstallFailedError({
        cause,
        dir,
      }),
  })

const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
  let entrypoint: Option.Option<string>
  try {
    const resolved = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
    entrypoint = Option.some(resolved)
  } catch {
    entrypoint = Option.none()
  }
  return {
    client: "npm",
    directory: dir,
    entrypoint,
    name,
    registry: Option.none(),
    sources: [],
    spec: name,
    version: Option.none(),
  }
}

interface ArboristNode {
  name: string
  path: string
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
}

type PackageMetadata = {
  client: NpmConfig.PackageManager
  name: string
  registry?: string
  sources: string[]
  spec: string
  version?: string
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
    const metadataFile = (dir: string) => path.join(dir, ".codeplane-npm.json")
    const unique = <T>(items: readonly T[]) => Array.from(new Set(items))
    const readMetadata = Effect.fnUntraced(function* (dir: string) {
      return (yield* afs.readJson(metadataFile(dir)).pipe(Effect.option)) as Option.Option<PackageMetadata>
    })
    const writeMetadata = Effect.fnUntraced(function* (dir: string, value: PackageMetadata) {
      yield* afs.writeJson(metadataFile(dir), value).pipe(Effect.orDie)
    })
    const packageVersion = Effect.fnUntraced(function* (dir: string) {
      const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.option)
      if (Option.isNone(pkg)) return Option.none<string>()
      const value = pkg.value as { version?: unknown }
      return typeof value.version === "string" && value.version.trim() ? Option.some(value.version.trim()) : Option.none<string>()
    })
    const resolveConfig = Effect.fnUntraced(function* (pkg?: string, dir?: string) {
      return yield* Effect.promise(() =>
        NpmConfig.resolve({
          dir,
          globalConfigDir: global.config,
          spec: pkg,
        }),
      )
    })
    const configEnv = Effect.fnUntraced(function* (resolved: NpmConfig.Resolved) {
      if (!resolved.npmrc.trim()) return
      const dir = yield* fs.makeTempDirectoryScoped({ directory: global.cache, prefix: "npm-config-" }).pipe(Effect.orDie)
      const file = path.join(dir, ".npmrc")
      yield* fs.writeFileString(file, resolved.npmrc).pipe(Effect.orDie)
      return {
        NPM_CONFIG_USERCONFIG: file,
        npm_config_userconfig: file,
      }
    })
    const viewCommands = (client: NpmConfig.PackageManager, pkg: string) =>
      unique([client === "yarn" ? "npm" : client, "npm", "pnpm", "bun"]).map((name) => {
        if (name === "bun") return ["bun", "pm", "view", pkg, "dist-tags.latest", "--json"]
        return [name, "view", pkg, "dist-tags.latest", "--json"]
      })
    const runView = Effect.fnUntraced(function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
      const handle = yield* spawner.spawn(
        ChildProcess.make(cmd[0], cmd.slice(1), {
          cwd: opts?.cwd,
          env: opts?.env,
          extendEnv: true,
        }),
      )
      const [stdout, stderr] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      )
      const code = yield* handle.exitCode
      if (code !== 0 || !stdout.trim()) {
        return yield* Effect.fail(stderr || stdout || `Failed to run ${cmd.join(" ")}`)
      }
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.String))(stdout)
    }, Effect.scoped)
    const view: Interface["view"] = (pkg, dir) =>
      Effect.scoped(
        Effect.gen(function* () {
          const resolved = yield* resolveConfig(pkg, dir)
          const env = yield* configEnv(resolved)
          let latest = Option.none<string>()

          for (const cmd of viewCommands(resolved.client, pkg)) {
            const value = yield* runView(cmd, { cwd: dir, env }).pipe(Effect.option)
            if (Option.isNone(value)) continue
            latest = value
            break
          }

          return {
            client: resolved.client,
            latest,
            registry: option(resolved.settings.registry),
            sources: resolved.sources,
          }
        }).pipe(Effect.withSpan("Npm.view", { attributes: { pkg, dir } })),
      )
    const reify = (input: { dir: string; add?: string[]; contextDir?: string; save?: boolean }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const resolved = yield* resolveConfig(add[0], input.contextDir ?? input.dir)
        const env = yield* configEnv(resolved)
        const npmOptions = yield* loadOptions(input.contextDir ?? input.dir, env)
        const arborist = new Arborist({
          ...npmOptions,
          ...resolved.options,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...npmOptions,
              ...resolved.options,
              add,
              save: input.save ?? true,
              saveType: "prod",
            }),
          catch: (cause) =>
            new InstallFailedError({
              cause,
              add,
              dir: input.dir,
            }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )

    const manager = Effect.fn("Npm.manager")(function* (dir?: string) {
      return (yield* resolveConfig(undefined, dir)).client
    })

    const outdated = Effect.fn("Npm.outdated")(function* (pkg: string, cachedVersion: string, dir?: string) {
      const latestVersion = yield* view(pkg, dir)
      if (Option.isNone(latestVersion.latest)) {
        return false
      }

      const range = /[\s^~*xX<>|=]/.test(cachedVersion)
      if (range) return !semver.satisfies(latestVersion.latest.value, cachedVersion)

      return semver.lt(cachedVersion, latestVersion.latest.value)
    })

    const add = Effect.fn("Npm.add")(function* (pkg: string, contextDir?: string, input?: { add?: InstallPackage[] }) {
      const resolved = yield* resolveConfig(pkg, contextDir)
      const cacheDir = directory(pkg)
      const name = packageName(pkg)
      const extra = input?.add?.map(packageSpec) ?? []
      const add = [pkg, ...extra]
      const cachedPackageDir = path.join(cacheDir, "node_modules", name)

      if (yield* afs.existsSafe(cachedPackageDir)) {
        if (extra.length) {
          const installed = yield* Effect.forEach(
            extra,
            (spec) => afs.existsSafe(path.join(cacheDir, "node_modules", packageName(spec))),
            { concurrency: 8 },
          )
          if (!installed.every(Boolean)) {
            yield* reify({ dir: cacheDir, add, contextDir })
          }
        }

        const entry = resolveEntryPoint(name, cachedPackageDir)
        const metadata = yield* readMetadata(cacheDir)
        const version = yield* packageVersion(cachedPackageDir)
        const stored = Option.getOrUndefined(metadata)
        return {
          ...entry,
          client: stored?.client ?? resolved.client,
          name,
          registry: option(stored?.registry ?? resolved.settings.registry),
          sources: stored?.sources ?? resolved.sources,
          spec: stored?.spec ?? pkg,
          version: stored?.version ? Option.some(stored.version) : version,
        }
      }

      const tree = yield* reify({ dir: cacheDir, add, contextDir })
      const first = tree.edgesOut.get(name)?.to ?? tree.edgesOut.values().next().value?.to
      if (!first) return yield* new InstallFailedError({ add, dir: cacheDir })
      const entry = resolveEntryPoint(first.name, first.path)
      const version = yield* packageVersion(first.path)
      yield* writeMetadata(cacheDir, {
        client: resolved.client,
        name: first.name,
        registry: resolved.settings.registry,
        sources: resolved.sources,
        spec: pkg,
        version: Option.getOrUndefined(version),
      })
      return {
        ...entry,
        client: resolved.client,
        name: first.name,
        registry: option(resolved.settings.registry),
        sources: resolved.sources,
        spec: pkg,
        version,
      }
    }, Effect.scoped)

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map(packageSpec) ?? []
      const packageJson = path.join(dir, "package.json")
      const hasPackageJson = yield* afs.existsSafe(packageJson)
      if (!hasPackageJson && add.length === 0) return

      const declared = yield* Effect.gen(function* () {
        const pkg = yield* afs.readJson(packageJson).pipe(Effect.orElseSucceed(() => ({})))
        const pkgAny = pkg as any
        return new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
          ...(input?.add || []).map((pkg) => pkg.name),
        ])
      })
      if (declared.size === 0) return

      const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules")).pipe(
        Effect.withSpan("Npm.checkNodeModules"),
      )
      if (!nodeModulesExists) {
        yield* reify({ add, dir, contextDir: dir, save: input?.save })
        return
      }

      const lockfileExists = yield* afs.existsSafe(path.join(dir, "package-lock.json"))
      if (!lockfileExists) {
        const installed = yield* Effect.forEach(
          declared,
          (name) => afs.existsSafe(path.join(dir, "node_modules", name)),
          { concurrency: 8 },
        )
        if (installed.every(Boolean)) return
      }

      yield* Effect.gen(function* () {
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        const lockAny = lock as any
        const root = lockAny?.packages?.[""] || {}
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {}),
        ])

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify({ dir, add, contextDir: dir, save: input?.save })
            return
          }
        }
      }).pipe(Effect.withSpan("Npm.checkDirty"))

      return
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string, contextDir?: string) {
      const cacheDir = directory(pkg)
      const binDir = path.join(cacheDir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

        if (files.length === 0) return Option.none<string>()
        // Caller picked a specific bin (e.g. pyright exposes both `pyright` and
        // `pyright-langserver`); trust the hint if the package provides it.
        if (bin) return files.includes(bin) ? Option.some(bin) : Option.none<string>()
        if (files.length === 1) return Option.some(files[0])

        const pkgJson = yield* afs.readJson(path.join(cacheDir, "node_modules", pkg, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
            const parsedBin = parsed.bin
            if (typeof parsedBin === "string") return Option.some(unscoped)
            const keys = Object.keys(parsedBin)
            if (keys.length === 1) return Option.some(keys[0])
            return parsedBin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
          }
        }

        return Option.some(files[0])
      })

      return yield* Effect.gen(function* () {
        const bin = yield* pick()
        if (Option.isSome(bin)) {
          return Option.some(path.join(binDir, bin.value))
        }

        yield* fs.remove(path.join(cacheDir, "package-lock.json")).pipe(Effect.orElseSucceed(() => {}))

        yield* add(pkg, contextDir)

        const resolved = yield* pick()
        if (Option.isNone(resolved)) return Option.none<string>()
        return Option.some(path.join(binDir, resolved.value))
      }).pipe(
        Effect.scoped,
        Effect.orElseSucceed(() => Option.none<string>()),
      )
    })

    return Service.of({
      add,
      install,
      manager,
      outdated,
      view,
      which,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EffectFlock.layer),
  Layer.provide(AppFileSystem.layer),
  Layer.provide(Global.layer),
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>): Promise<ResolvedEntryPoint> {
  const entry = await runPromise((svc) => svc.add(...args))
  return {
    client: entry.client,
    directory: entry.directory,
    entrypoint: Option.getOrUndefined(entry.entrypoint),
    name: entry.name,
    registry: Option.getOrUndefined(entry.registry),
    sources: Array.from(entry.sources),
    spec: entry.spec,
    version: Option.getOrUndefined(entry.version),
  }
}

export async function manager(...args: Parameters<Interface["manager"]>) {
  return runPromise((svc) => svc.manager(...args))
}

export async function outdated(...args: Parameters<Interface["outdated"]>) {
  return runPromise((svc) => svc.outdated(...args))
}

export async function view(...args: Parameters<Interface["view"]>) {
  const result = await runPromise((svc) => svc.view(...args))
  return {
    client: result.client,
    latest: Option.getOrUndefined(result.latest),
    registry: Option.getOrUndefined(result.registry),
    sources: Array.from(result.sources),
  }
}

export async function which(...args: Parameters<Interface["which"]>) {
  const resolved = await runPromise((svc) => svc.which(...args))
  return Option.getOrUndefined(resolved)
}
