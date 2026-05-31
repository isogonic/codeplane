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
// Behavior:
//
//   - If CODEPLANE_HOME_DIR is already set in the env (e.g. the desktop
//     shell, or a TUI/daemon-spawned server, pinned an explicit per-instance
//     dir), do nothing and respect the parent's choice.
//   - Otherwise, scan argv for `--instance <id>` / `-i <id>` /
//     `--instance=<id>`. When present, set CODEPLANE_HOME_DIR to
//     <root>/instances/<id> so providers, models, MCP servers, agents,
//     commands, plugins, skills, and codeplane.jsonc all live in a
//     per-instance subtree, isolated from every other instance on the
//     same machine. The subtree is created lazily on first use.
//   - When NO instance is given, Codeplane does NOT invent a "default"
//     instance. Commands that boot a server bound to one instance's
//     config/data (`serve`, `web`) hard-error and ask the user to pass
//     `--instance <id>`. Registry/meta commands (`instance`, `tui`,
//     `generate`, `upgrade`, `completion`, `--help`) don't need a
//     per-instance home and resolve to the shared root for their own state.
//
// The argv scan is tiny and self-contained so it works without yargs being
// loaded yet. The full yargs parser still sees the same args later.

import { CodeplaneHome } from "@codeplane-ai/shared/home"
import path from "path"
// dispatch.ts is dependency-free, so importing it here does not pull Global
// (or anything that reads CODEPLANE_HOME_DIR) into the graph before we set it.
import { effectiveCommand } from "../tui/dispatch"

// Commands that run a server pinned to one instance's config/data. These
// must be told which instance to use; everything else (registry/meta
// commands) is fine resolving to the shared root.
const INSTANCE_REQUIRED_COMMANDS = new Set(["serve", "web"])

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

function applyInstance(): void {
  if (process.env.CODEPLANE_HOME_DIR && process.env.CODEPLANE_HOME_DIR.length > 0) {
    // The spawning process already pinned a home dir (e.g. desktop shell
    // running a managed local instance, or a TUI/daemon-spawned server).
    // Respect it. The desktop also doesn't set CODEPLANE_GLOBAL_HOME_DIR —
    // that's fine, home.ts falls back to CODEPLANE_HOME_DIR for the global
    // root in that case, and since the desktop doesn't use per-instance
    // routing the two paths coincide and instances.json lands at the same
    // spot the desktop already expects.
    return
  }

  const requested = readInstanceFromArgv(process.argv)
  // Sanitize: reject path separators so a user can't inject `..` or an
  // absolute path via the flag. A malformed value is treated as "no
  // instance" rather than silently resolving somewhere unexpected.
  const safe =
    requested && !requested.includes("/") && !requested.includes("\\") && !requested.startsWith(".")
      ? requested
      : undefined

  const defaultPaths = CodeplaneHome.paths()

  if (safe) {
    process.env.CODEPLANE_HOME_DIR = path.join(defaultPaths.root, "instances", safe)
    // CODEPLANE_GLOBAL_HOME_DIR is what home.ts uses to resolve the shared
    // registry (instances.json) + the shared local-runtime cache
    // (local_server/) to the OUTER root, regardless of which per-instance
    // subtree CODEPLANE_HOME_DIR points at.
    process.env.CODEPLANE_GLOBAL_HOME_DIR = defaultPaths.root
    return
  }

  // No --instance. Codeplane does not auto-create a "default" instance, so a
  // command that needs a per-instance home cannot proceed without being told
  // which one to use. Use the *effective* command (after default-command
  // injection in tui/dispatch) so a bare `codeplane` that resolves to `web`
  // is caught too. effectiveCommand returns undefined for --help/--version.
  const command = effectiveCommand(process.argv.slice(2))
  if (command && INSTANCE_REQUIRED_COMMANDS.has(command)) {
    const example = path.join(defaultPaths.root, "instances", "<id>")
    process.stderr.write(
      `[codeplane] No instance selected.\n` +
        `Codeplane no longer creates a "default" instance automatically — choose one explicitly:\n\n` +
        `    codeplane ${command} --instance <id>\n\n` +
        `The first run with a new id creates its config + data under:\n` +
        `    ${example}\n\n` +
        "Use `codeplane instance --help` to manage saved servers, or `codeplane tui` to pick one interactively.\n",
    )
    process.exit(1)
  }

  // Registry/meta commands (instance, tui, generate, upgrade, completion,
  // help, or no command): no per-instance home. home.ts resolves both the
  // home and the shared root to the outer root, which is what reading the
  // saved-instance registry and the shared runtime cache expects.
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
  const totpSecret = readFlagFromArgv(process.argv, "totp-secret")
  if (password !== undefined && !process.env.CODEPLANE_SERVER_PASSWORD) {
    process.env.CODEPLANE_SERVER_PASSWORD = password
  }
  if (username !== undefined && !process.env.CODEPLANE_SERVER_USERNAME) {
    process.env.CODEPLANE_SERVER_USERNAME = username
  }
  // Second-factor secret. Like the password, an explicit env var wins so a
  // systemd/launchd unit's secret stays in control.
  if (totpSecret !== undefined && !process.env.CODEPLANE_SERVER_TOTP_SECRET) {
    process.env.CODEPLANE_SERVER_TOTP_SECRET = totpSecret
  }
}

applyInstance()
applyAuth()
