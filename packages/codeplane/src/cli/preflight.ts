// CLI preflight — runs before any other module is imported by src/index.ts.
//
// Why this file is at the top of the import graph:
//
//   `Global` (src/global/index.ts) computes the resolved Codeplane home paths
//   eagerly at module evaluation by reading CODEPLANE_HOME_DIR. After that,
//   nothing inside the process can switch to a different home folder without
//   re-execing. So if a user passes `--instance <id>` to `serve`, `web`, or
//   `tui`, we have to translate that into CODEPLANE_HOME_DIR *before* Global
//   is imported. That's what this file does.
//
// Behavior:
//
//   - If CODEPLANE_HOME_DIR is already set in the env (e.g. the desktop
//     spawned us with an explicit per-instance dir), do nothing.
//   - Otherwise, scan argv for `--instance <id>` / `-i <id>` /
//     `--instance=<id>` and, if found, set CODEPLANE_HOME_DIR to
//     `<default-root>/instances/<id>`. This guarantees that providers,
//     models, MCP servers, agents, commands, plugins, skills, and the
//     global codeplane.jsonc live in a per-instance subtree under the
//     standard OS-native Codeplane home folder.
//   - Unknown subcommands or invocations without `--instance` keep the
//     pre-existing behavior (use the global root).
//
// The argv scan is tiny and self-contained so it works without yargs being
// loaded yet. It only looks for the flag — yargs still parses everything
// else (including `--instance` itself) once it's loaded later.

import { CodeplaneHome } from "@codeplane-ai/shared/home"
import path from "path"

function readInstanceFromArgv(argv: readonly string[]): string | undefined {
  // Skip the runtime + script entry (process.argv[0..1]); yargs does the same.
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--instance" || arg === "-i") {
      const next = args[i + 1]
      if (next && !next.startsWith("-")) return next
    }
    if (arg?.startsWith("--instance=")) return arg.slice("--instance=".length) || undefined
    if (arg?.startsWith("-i=")) return arg.slice("-i=".length) || undefined
  }
  return undefined
}

function applyInstance(): void {
  if (process.env.CODEPLANE_HOME_DIR && process.env.CODEPLANE_HOME_DIR.length > 0) {
    // The spawning process already pinned a home dir (e.g. desktop shell
    // running a managed local instance). Respect it.
    return
  }
  const id = readInstanceFromArgv(process.argv)
  if (!id) return
  // Sanitize: reject path separators so a user can't inject `..` or an
  // absolute path via the flag.
  if (id.includes("/") || id.includes("\\") || id.startsWith(".")) return

  const defaultPaths = CodeplaneHome.paths()
  process.env.CODEPLANE_HOME_DIR = path.join(defaultPaths.root, "instances", id)
}

applyInstance()
