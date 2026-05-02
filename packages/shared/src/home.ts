import os from "os"
import path from "path"
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir"

function trim(value: string | undefined) {
  return value?.trim() || undefined
}

function defaultHome() {
  return process.env.CODEPLANE_TEST_HOME || os.homedir()
}

function defaultRoot() {
  if (process.platform === "darwin") return path.join(defaultHome(), "Library", "Application Support", "Codeplane")
  if (process.platform === "win32") {
    return path.join(trim(process.env.APPDATA) || path.join(defaultHome(), "AppData", "Roaming"), "Codeplane")
  }
  return path.join(xdgConfig || path.join(defaultHome(), ".config"), "Codeplane")
}

function override(key: string) {
  return trim(process.env[key])
}

export function legacyPaths() {
  return {
    cache: path.join(xdgCache || path.join(defaultHome(), ".cache"), "codeplane"),
    config: path.join(xdgConfig || path.join(defaultHome(), ".config"), "codeplane"),
    data: path.join(xdgData || path.join(defaultHome(), ".local", "share"), "codeplane"),
    state: path.join(xdgState || path.join(defaultHome(), ".local", "state"), "codeplane"),
  }
}

export function paths() {
  const root = path.resolve(override("CODEPLANE_HOME_DIR") || defaultRoot())
  const data = path.resolve(override("CODEPLANE_DATA_DIR") || path.join(root, "data"))
  const cache = path.resolve(override("CODEPLANE_CACHE_DIR") || path.join(root, "cache"))
  const state = path.resolve(override("CODEPLANE_STATE_DIR") || path.join(root, "state"))
  const bin = path.resolve(override("CODEPLANE_BIN_DIR") || path.join(root, "bin"))
  const log = path.resolve(override("CODEPLANE_LOG_DIR") || path.join(root, "log"))

  return {
    agents: path.join(root, "agents"),
    bin,
    cache,
    commands: path.join(root, "commands"),
    config: root,
    data,
    home: defaultHome(),
    instances: path.join(root, "instances.json"),
    local_server: path.join(root, "local_server"),
    local_server_binaries: path.join(root, "local_server", "binaries"),
    log,
    plugins: path.join(root, "plugins"),
    root,
    skills: path.join(root, "skills"),
    state,
  }
}

export const CodeplaneHome = {
  legacyPaths,
  paths,
}

