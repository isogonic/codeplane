// CLI preflight — runs before any other module is imported by src/index.ts.
//
// Why this file is at the top of the import graph:
//
//   `Global` (src/global/index.ts) computes the resolved Codeplane home paths
//   eagerly at module evaluation by reading CODEPLANE_HOME_DIR. After that,
//   nothing inside the process can switch to a different home folder without
//   re-execing. So the per-instance home dir routing has to land in the env
//   *before* Global is imported. That's what this file does.
//
// Behavior (post-v27.4.29 — per-instance is the default, not opt-in):
//
//   - If CODEPLANE_HOME_DIR is already set in the env (e.g. the desktop
//     shell spawned us with an explicit per-instance dir), do nothing and
//     respect the parent's choice.
//   - Otherwise, scan argv for `--instance <id>` / `-i <id>` /
//     `--instance=<id>`. If absent, default to the literal id "default".
//   - Set CODEPLANE_HOME_DIR to <default-root>/instances/<id>. This
//     guarantees that providers, models, MCP servers, agents, commands,
//     plugins, skills, and the global codeplane.jsonc all live in a
//     per-instance subtree — completely isolated from every other instance
//     on the same machine.
//   - On the very first time the "default" instance dir is created, copy
//     legacy config files from <root>/* into <root>/instances/default/*
//     so existing users keep their configuration without any manual
//     migration step. Originals are left in place; the migration is one-way
//     and only fires when <root>/instances/default/ does not exist yet.
//
// The argv scan is tiny and self-contained so it works without yargs being
// loaded yet. The full yargs parser still sees the same args later.

import { CodeplaneHome } from "@codeplane-ai/shared/home"
import fs from "fs"
import path from "path"

const DEFAULT_INSTANCE_ID = "default"

// Files / directories that live at the root of the Codeplane home folder
// and should be migrated into the default-instance dir on first run. The
// global instances.json (saved-instance registry) is *not* migrated — it
// stays at the root so every per-instance server can see the same registry
// of saved remotes / locals.
const LEGACY_FILES = ["codeplane.jsonc", "codeplane.json", "config.json"]
const LEGACY_DIRS = ["plugins", "agents", "commands", "skills"]

function readFlagFromArgv(argv: readonly string[], flag: string, alias?: string): string | undefined {
  // Skip the runtime + script entry (process.argv[0..1]); yargs does the same.
  const args = argv.slice(2)
  const long = `--${flag}`
  const longEq = `--${flag}=`
  const aliasShort = alias ? `-${alias}` : undefined
  const aliasShortEq = alias ? `-${alias}=` : undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === long || (aliasShort && arg === aliasShort)) {
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith("-")) return next
    }
    if (arg?.startsWith(longEq)) return arg.slice(longEq.length) || undefined
    if (aliasShortEq && arg?.startsWith(aliasShortEq)) return arg.slice(aliasShortEq.length) || undefined
  }
  return undefined
}

function readInstanceFromArgv(argv: readonly string[]): string | undefined {
  return readFlagFromArgv(argv, "instance", "i")
}

function copyEntry(src: string, dest: string): void {
  if (!fs.existsSync(src)) return
  if (fs.existsSync(dest)) return
  fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: false })
}

function migrateLegacyToDefault(root: string, target: string): void {
  // Only migrate when the default-instance dir does not exist yet — that's
  // our signal that this is the very first run after switching to the
  // per-instance default. Subsequent runs do nothing here.
  if (fs.existsSync(target)) return
  try {
    fs.mkdirSync(target, { recursive: true })
  } catch {
    return
  }
  for (const name of LEGACY_FILES) copyEntry(path.join(root, name), path.join(target, name))
  for (const name of LEGACY_DIRS) copyEntry(path.join(root, name), path.join(target, name))
}

function applyInstance(): void {
  if (process.env.CODEPLANE_HOME_DIR && process.env.CODEPLANE_HOME_DIR.length > 0) {
    // The spawning process already pinned a home dir (e.g. desktop shell
    // running a managed local instance). Respect it. The desktop also
    // doesn't set CODEPLANE_GLOBAL_HOME_DIR — that's fine, home.ts falls
    // back to CODEPLANE_HOME_DIR for the global root in that case, and
    // since the desktop doesn't use per-instance routing the two paths
    // coincide and instances.json lands at the same spot the desktop
    // already expects.
    return
  }
  const requested = readInstanceFromArgv(process.argv)
  // Sanitize: reject path separators so a user can't inject `..` or an
  // absolute path via the flag. Fall back to the default id if the value
  // is malformed rather than failing silently with a global root.
  const safe =
    requested && !requested.includes("/") && !requested.includes("\\") && !requested.startsWith(".")
      ? requested
      : undefined
  const id = safe ?? DEFAULT_INSTANCE_ID

  const defaultPaths = CodeplaneHome.paths()
  const target = path.join(defaultPaths.root, "instances", id)

  if (id === DEFAULT_INSTANCE_ID) {
    migrateLegacyToDefault(defaultPaths.root, target)
  }

  process.env.CODEPLANE_HOME_DIR = target
  // CODEPLANE_GLOBAL_HOME_DIR is what home.ts uses to resolve the
  // shared registry (instances.json) + the shared local-runtime cache
  // (local_server/) to the OUTER root, regardless of which per-instance
  // subtree CODEPLANE_HOME_DIR points at. Without this, every CLI
  // invocation since v27.4.29 has been writing instances.json into
  // <root>/instances/<id>/instances.json, where the desktop's
  // <root>/instances.json reader doesn't see it — so a remote added in
  // the desktop UI was invisible from `codeplane tui` and vice versa.
  process.env.CODEPLANE_GLOBAL_HOME_DIR = defaultPaths.root
}

// Apply --password / --username CLI flags by setting the matching env vars
// before the Flag module captures them at import time. Each Codeplane
// instance is single-user; Basic Auth is the way to put a password in
// front of an exposed instance (codeplane serve --hostname 0.0.0.0).
//
//   codeplane serve --hostname 0.0.0.0 --password hunter2
//
// is equivalent to
//
//   CODEPLANE_SERVER_PASSWORD=hunter2 codeplane serve --hostname 0.0.0.0
//
// but doesn't require the user to learn the env var name. The flags can
// be combined with --username (default: "codeplane") for a custom user.
//
// Explicit env-var overrides win — if CODEPLANE_SERVER_PASSWORD is
// already set, the CLI flag is ignored so a launchd / systemd unit's
// secret stays in control.
function applyAuth(): void {
  const password = readFlagFromArgv(process.argv, "password")
  const username = readFlagFromArgv(process.argv, "username")
  if (password !== undefined && !process.env.CODEPLANE_SERVER_PASSWORD) {
    process.env.CODEPLANE_SERVER_PASSWORD = password
  }
  if (username !== undefined && !process.env.CODEPLANE_SERVER_USERNAME) {
    process.env.CODEPLANE_SERVER_USERNAME = username
  }
}

applyInstance()
applyAuth()
