import { Config } from "@/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Global } from "@/global"
import path from "path"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"

export type ConfigPathSegment = string | number

type ConfigShowArgs = {
  global?: boolean
}

type ConfigValueArgs = {
  global?: boolean
  path: string
}

type ConfigSetArgs = {
  json?: boolean
  path: string
  value: string
}

export function splitConfigPath(input: string): ConfigPathSegment[] {
  const value = input.trim()
  if (!value) return []
  const result: ConfigPathSegment[] = []
  let current = ""
  let index = 0

  const pushCurrent = () => {
    if (!current) return
    result.push(current)
    current = ""
  }

  while (index < value.length) {
    const char = value[index]

    if (char === "\\") {
      current += value[index + 1] ?? ""
      index += 2
      continue
    }

    if (char === ".") {
      pushCurrent()
      index++
      continue
    }

    if (char === "[") {
      const close = value.indexOf("]", index + 1)
      if (close === -1) {
        current += char
        index++
        continue
      }
      pushCurrent()
      const token = value.slice(index + 1, close).trim()
      result.push(/^\d+$/.test(token) ? Number.parseInt(token, 10) : token)
      index = close + 1
      continue
    }

    current += char
    index++
  }

  pushCurrent()
  return result
}

export function getConfigValueAtPath(input: unknown, target: string | ConfigPathSegment[]) {
  const segments = Array.isArray(target) ? target : splitConfigPath(target)
  return segments.reduce<{ found: boolean; value?: unknown }>(
    (result, segment) => {
      if (!result.found) return result
      if (typeof segment === "number") {
        if (!Array.isArray(result.value)) return { found: false }
        if (!(segment in result.value)) return { found: false }
        return { found: true, value: result.value[segment] }
      }
      if (!result.value || typeof result.value !== "object") return { found: false }
      if (!(segment in result.value)) return { found: false }
      return { found: true, value: (result.value as Record<string, unknown>)[segment] }
    },
    { found: true, value: input },
  )
}

export function setConfigValueAtPath(input: unknown, target: string | ConfigPathSegment[], value: unknown): unknown {
  const segments = Array.isArray(target) ? target : splitConfigPath(target)
  if (segments.length === 0) return value
  const [head, ...tail] = segments
  if (typeof head === "number") {
    const next = Array.isArray(input) ? [...input] : []
    next[head] = setConfigValueAtPath(next[head], tail, value)
    return next
  }
  const next = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {}
  return {
    ...next,
    [head]: setConfigValueAtPath((next as Record<string, unknown>)[head], tail, value),
  }
}

export function deleteConfigValueAtPath(input: unknown, target: string | ConfigPathSegment[]): unknown {
  const segments = Array.isArray(target) ? target : splitConfigPath(target)
  if (segments.length === 0) return input
  const [head, ...tail] = segments
  if (typeof head === "number") {
    if (!Array.isArray(input)) return input
    const next = [...input]
    if (tail.length === 0) {
      next.splice(head, 1)
      return next
    }
    next[head] = deleteConfigValueAtPath(next[head], tail)
    return next
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const next = { ...(input as Record<string, unknown>) }
  if (tail.length === 0) {
    delete next[head]
    return next
  }
  const child = deleteConfigValueAtPath(next[head], tail)
  if (child === undefined) {
    delete next[head]
    return next
  }
  return {
    ...next,
    [head]: child,
  }
}

function formatJson(input: unknown) {
  return JSON.stringify(input, null, 2)
}

function canonicalGlobalConfigFile() {
  return path.join(Global.Path.config, "codeplane.jsonc")
}

async function effectiveConfig() {
  return bootstrap(process.cwd(), () => AppRuntime.runPromise(Config.Service.use((cfg) => cfg.get())))
}

async function effectiveDirectories() {
  return bootstrap(process.cwd(), () => AppRuntime.runPromise(Config.Service.use((cfg) => cfg.directories())))
}

async function globalConfig() {
  return AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
}

async function saveGlobalConfig(next: unknown) {
  return AppRuntime.runPromise(Config.Service.use((cfg) => cfg.updateGlobal(next as Config.Info)))
}

async function selectedConfig(globalOnly?: boolean) {
  if (globalOnly) return globalConfig()
  return effectiveConfig()
}

function parseConfigValue(value: string, json?: boolean) {
  if (!json) return value
  return JSON.parse(value)
}

export const ConfigCommand = cmd({
  command: "config",
  describe: "inspect and manage Codeplane config",
  builder: (yargs: Argv) =>
    yargs
      .command(ConfigShowCommand)
      .command(ConfigGetCommand)
      .command(ConfigSetCommand)
      .command(ConfigUnsetCommand)
      .command(ConfigPathsCommand)
      .demandCommand(),
  async handler() {},
})

export const ConfigShowCommand = cmd({
  command: "show",
  describe: "print effective config or the shared global config",
  builder: (yargs: Argv) =>
    yargs.option("global", {
      type: "boolean",
      default: false,
      describe: "show only the shared global config",
    }),
  async handler(args) {
    console.log(formatJson(await selectedConfig(Boolean((args as ConfigShowArgs).global))))
  },
})

export const ConfigGetCommand = cmd({
  command: "get <path>",
  describe: "read a config value by path",
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "config path, for example npm.registry or mcp.server.url",
      })
      .option("global", {
        type: "boolean",
        default: false,
        describe: "read from the shared global config only",
      }),
  async handler(args) {
    const input = args as ConfigValueArgs
    const result = getConfigValueAtPath(await selectedConfig(Boolean(input.global)), input.path)
    if (!result.found) throw new Error(`Config path not found: ${input.path}`)
    console.log(formatJson(result.value))
  },
})

export const ConfigSetCommand = cmd({
  command: "set <path> <value>",
  describe: "set a shared global config value by path",
  builder: (yargs: Argv) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "config path, for example npm.registry or permission.edit",
      })
      .positional("value", {
        type: "string",
        describe: "string value, or JSON when --json is set",
      })
      .option("json", {
        type: "boolean",
        default: false,
        describe: "parse the value argument as JSON",
      }),
  async handler(args) {
    const input = args as ConfigSetArgs
    const current = await globalConfig()
    const next = setConfigValueAtPath(current, input.path, parseConfigValue(input.value, Boolean(input.json)))
    await saveGlobalConfig(next)
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Updated ${input.path}` + UI.Style.TEXT_NORMAL)
  },
})

export const ConfigUnsetCommand = cmd({
  command: "unset <path>",
  describe: "remove a shared global config value by path",
  builder: (yargs: Argv) =>
    yargs.positional("path", {
      type: "string",
      describe: "config path to remove",
    }),
  async handler(args) {
    const input = args as ConfigValueArgs
    const current = await globalConfig()
    const result = getConfigValueAtPath(current, input.path)
    if (!result.found) throw new Error(`Config path not found: ${input.path}`)
    await saveGlobalConfig(deleteConfigValueAtPath(current, input.path))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Removed ${input.path}` + UI.Style.TEXT_NORMAL)
  },
})

export const ConfigPathsCommand = cmd({
  command: "paths",
  describe: "show canonical Codeplane config and data paths",
  async handler() {
    console.log(
      formatJson({
        ...Global.Path,
        canonicalGlobalConfigFile: canonicalGlobalConfigFile(),
        discoveredConfigDirectories: await effectiveDirectories(),
      }),
    )
  },
})
