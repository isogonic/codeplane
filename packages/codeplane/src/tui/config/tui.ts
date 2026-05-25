export * as TuiConfig from "./tui"

import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@/global"
import { AppFileSystem } from "@/tui/_compat/filesystem"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/tui/_compat/config-keybinds"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { makeRuntime } from "@/effect/runtime"
import { Filesystem } from "@/tui/_compat/filesystem"
import * as Log from "@/util/log"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@/npm"
import { ensureOpenCodeCompatModules } from "@/plugin/shared"

const log = Log.create({ service: "tui.config" })

export const Info = TuiInfo

type Acc = {
  result: Info
}

type State = {
  config: Info
  deps: Array<Fiber.Fiber<void, AppFileSystem.Error>>
}

export type Info = z.output<typeof Info> & {
  // Internal resolved plugin list used by runtime loading.
  plugin_origins?: ConfigPlugin.Origin[]
}

export interface Interface {
  readonly get: () => Effect.Effect<Info>
  readonly waitForDependencies: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@codeplane/TuiConfig") {}

function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
  if (Filesystem.contains(ctx.directory, file)) return "local"
  // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
  return "global"
}

function normalize(raw: Record<string, unknown>) {
  const data = { ...raw }
  if (!("tui" in data)) return data
  if (!isRecord(data.tui)) {
    delete data.tui
    return data
  }

  const tui = data.tui
  delete data.tui
  return {
    ...tui,
    ...data,
  }
}

async function resolvePlugins(config: Info, configFilepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], configFilepath)
  }
  return config
}

async function mergeFile(acc: Acc, file: string, ctx: { directory: string }) {
  const data = await loadFile(file)
  acc.result = mergeDeep(acc.result, data)
  if (!data.plugin?.length) return

  const scope = pluginScope(file, ctx)
  const plugins = ConfigPlugin.deduplicatePluginOrigins([
    ...(acc.result.plugin_origins ?? []),
    ...data.plugin.map((spec) => ({ spec, scope, source: file })),
  ])
  acc.result.plugin = plugins.map((item) => item.spec)
  acc.result.plugin_origins = plugins
}

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  // Every config dir we may read from: global config dir, project `.codeplane`
  // folders between cwd and home, and CODEPLANE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.CODEPLANE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 2. Explicit CODEPLANE_TUI_CONFIG override, if set. Read from process.env
  // directly because this flag isn't (yet) registered in our Flag schema.
  const tuiConfigOverride = process.env["CODEPLANE_TUI_CONFIG"]
  if (tuiConfigOverride) {
    yield* Effect.promise(() => mergeFile(acc, tuiConfigOverride, ctx)).pipe(Effect.orDie)
    log.debug("loaded custom tui config", { path: tuiConfigOverride })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 4. Codeplane config directories discovered while walking up the tree.
  // These are returned below so callers can install plugin dependencies from
  // each location.
  const dirs = unique(directories)
  for (const dir of dirs) {
    if (dir === Global.Path.config) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
    }
  }

  const keybinds = { ...(acc.result.keybinds ?? {}) }
  if (process.platform === "win32") {
    // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
    keybinds.terminal_suspend = "none"
    keybinds.input_undo ??= unique([
      "ctrl+z",
      ...ConfigKeybinds.Keybinds.shape.input_undo.parse(undefined).split(","),
    ]).join(",")
  }
  acc.result.keybinds = ConfigKeybinds.Keybinds.parse(keybinds)

  return {
    config: acc.result,
    dirs: acc.result.plugin?.length ? dirs : [],
  }
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => ensureOpenCodeCompatModules(dir))
          yield* npm.install(dir, {
            add: [
              {
                name: "@codeplane-ai/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
          })
        }).pipe(Effect.forkScoped),
      {
        concurrency: "unbounded",
      },
    )

    const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))

    const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
      Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
    )
    return Service.of({ get, waitForDependencies })
  }).pipe(Effect.withSpan("TuiConfig.layer")),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Npm.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function waitForDependencies() {
  await runPromise((svc) => svc.waitForDependencies())
}

export async function get() {
  return runPromise((svc) => svc.get())
}

async function loadFile(filepath: string): Promise<Info> {
  const text = await ConfigPaths.readFile(filepath)
  if (!text) return {}
  return load(text, filepath).catch((error) => {
    log.warn("failed to load tui config", { path: filepath, error })
    return {}
  })
}

async function load(text: string, configFilepath: string): Promise<Info> {
  return ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" })
    .then((expanded) => ConfigParse.jsonc(expanded, configFilepath))
    .then((data) => {
      if (!isRecord(data)) return {}

      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old codeplane.json shape) still get their settings applied.
      return ConfigParse.schema(Info, normalize(data), configFilepath)
    })
    .then((data) => resolvePlugins(data, configFilepath))
    .catch((error) => {
      log.warn("invalid tui config", { path: configFilepath, error })
      return {}
    })
}
