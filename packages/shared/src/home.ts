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
  // The CLI's per-instance preflight (cli/preflight.ts) sets
  // CODEPLANE_HOME_DIR=<base>/instances/<id> so each instance gets an
  // isolated subtree for codeplane.jsonc + plugins + agents + commands +
  // skills. But TWO things must NEVER be per-instance:
  //
  //   1. instances.json — the registry of saved instances. If this lived
  //      under instances/<id>/instances.json, the TUI and Desktop would
  //      see different lists of saved servers. Symptom: a remote server
  //      added in the Desktop's setup UI never shows up when the user
  //      runs `codeplane tui` against the same machine, and vice versa.
  //   2. local_server/ — the npm-backed runtime binary cache. Each
  //      version is ~50MB; downloading per-instance would multiply
  //      disk usage and re-download time.
  //
  // The preflight separately sets CODEPLANE_GLOBAL_HOME_DIR=<base> so
  // both surfaces resolve those two shared resources to the SAME path
  // (`<base>/instances.json` and `<base>/local_server/`) regardless of
  // whether they're running inside a per-instance subtree. Desktop
  // doesn't run the preflight, so CODEPLANE_GLOBAL_HOME_DIR is unset
  // there; falling back to `root` produces the same path because
  // Desktop also doesn't override CODEPLANE_HOME_DIR.
  const globalRoot = path.resolve(override("CODEPLANE_GLOBAL_HOME_DIR") || root)
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
    globalRoot,
    home: defaultHome(),
    instances: path.join(globalRoot, "instances.json"),
    local_server: path.join(globalRoot, "local_server"),
    local_server_binaries: path.join(globalRoot, "local_server", "binaries"),
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

