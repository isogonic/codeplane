import path from "path"
import { spawnSync } from "node:child_process"

const LOGIN = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"])
const VOLATILE = new Set(["_", "OLDPWD", "PWD", "SHLVL"])
const ENV_TIMEOUT_MS = Number(process.env.CODEPLANE_SHELL_ENV_TIMEOUT_MS || 2_000)

const cache = new Map<string, NodeJS.ProcessEnv>()

function shellName(file: string) {
  return process.platform === "win32" ? path.win32.parse(file).name.toLowerCase() : path.basename(file).toLowerCase()
}

function fallbackShell() {
  if (process.platform === "darwin") return "/bin/zsh"
  return process.env.SHELL || "/bin/sh"
}

function loginShell(file: string) {
  return LOGIN.has(shellName(file))
}

function clean(entries: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(entries).filter(([key, value]) => typeof value === "string" && !VOLATILE.has(key)),
  ) as NodeJS.ProcessEnv
}

function splitPath(value: string | undefined) {
  return value?.split(path.delimiter).filter(Boolean) ?? []
}

function mergePath(...values: Array<string | undefined>) {
  const seen = new Set<string>()
  return values
    .flatMap(splitPath)
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
    .join(path.delimiter)
}

function parseEnv(text: string) {
  const out: NodeJS.ProcessEnv = {}
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=")
    if (index <= 0) continue
    const key = line.slice(0, index)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || VOLATILE.has(key)) continue
    out[key] = line.slice(index + 1)
  }
  return out
}

function readLoginEnvironment(shell: string) {
  if (process.platform === "win32" || !loginShell(shell)) return {}
  const cached = cache.get(shell)
  if (cached) return cached

  const result = spawnSync(shell, ["-l", "-c", "/usr/bin/env"], {
    encoding: "utf8",
    env: process.env,
    timeout: Number.isFinite(ENV_TIMEOUT_MS) && ENV_TIMEOUT_MS > 0 ? ENV_TIMEOUT_MS : 2_000,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
  const env = result.status === 0 && typeof result.stdout === "string" ? parseEnv(result.stdout) : {}
  cache.set(shell, env)
  return env
}

export function environment(
  base: NodeJS.ProcessEnv = process.env,
  extra?: NodeJS.ProcessEnv,
  shell = base.SHELL || fallbackShell(),
): NodeJS.ProcessEnv {
  const login = readLoginEnvironment(shell)
  const extraPath = extra?.PATH ?? extra?.Path
  const loginPath = login.PATH ?? login.Path
  const basePath = base.PATH ?? base.Path
  return {
    ...clean(login),
    ...clean(base),
    ...(extra ? clean(extra) : {}),
    PATH: mergePath(extraPath, loginPath, basePath),
  }
}

export function reset() {
  cache.clear()
}
