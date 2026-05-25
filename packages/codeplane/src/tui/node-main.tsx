// Bridge entry that `launcher.ts` (sibling) builds and spawns. Boot flow:
//   1. Pick instance via the wizard (or use --instance to skip)
//   2. Pick working directory via the wizard (or use --dir to skip)
//   3. service.open() the instance to translate `local://` -> live http URL
//   4. Hand off to the SolidJS TUI's `tui()` function
//
// The runtime-plugin-support side-effect lives here (the TUI runtime
// entry) instead of inside @/tui/plugin/runtime.ts because that file is
// transitively reachable from the main CLI bundle, and runtime-plugin-
// support-configure.ts imports the "bun" builtin which the main browser-
// conditioned build cannot bundle. The TUI bundle has target="bun" and
// can.
import "@opentui/solid/runtime-plugin-support"
// Log routing is set up FIRST (before any other module is imported) so that
// Log.Default.* calls during downstream module init don't write to stderr —
// opentui's renderer captures stderr and would otherwise surface every
// "loading internal tui plugin" line as an always-on console overlay.
import * as Log from "@/util/log"

await Log.init({
  print: process.argv.includes("--print-logs"),
  level: (process.env["CODEPLANE_LOG_LEVEL"] as Log.Level | undefined) ?? "INFO",
})

// All other imports happen via dynamic import AFTER Log.init() so any logs
// emitted while these modules evaluate go to the log file, not stderr.
const { tui } = await import("./app")
const { TuiConfig } = await import("./config/tui")
const { runBootWizard } = await import("./boot/wizard")
const { createInstanceService } = await import("./instance-service")
const { headersForInstance, normalizeInstanceUrl } = await import("./client")
const { localInstanceUrl } = await import("@codeplane-ai/shared/instance")
import type { Args } from "./context/args"
import type { BootSelection } from "./boot/wizard"
import type { InstanceService } from "./instance-service"
import type { SavedInstance } from "@codeplane-ai/shared/instance"

function parseArgs(argv: string[]) {
  const result: {
    instance?: string
    route?: string
    directory?: string
    sessionID?: string
    continueSession?: boolean
    fork?: boolean
    model?: string
    agent?: string
    prompt?: string
  } = {}

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--instance") result.instance = next
    if (arg === "--route") result.route = next
    if (arg === "--dir" || arg === "--directory") result.directory = next
    if (arg === "--session" || arg === "-s") result.sessionID = next
    if (arg === "--continue" || arg === "-c") result.continueSession = true
    if (arg === "--fork") result.fork = true
    if (arg === "--model" || arg === "-m") result.model = next
    if (arg === "--agent") result.agent = next
    if (arg === "--prompt") result.prompt = next
  }

  return result
}

function defaultLocalSeed(): SavedInstance {
  return {
    id: "default",
    url: localInstanceUrl("default"),
    label: "Default local",
    local: { binaryVersion: "" },
  }
}

async function ensureSavedDefault(service: InstanceService): Promise<SavedInstance> {
  const seed = defaultLocalSeed()
  await service.save(seed)
  return seed
}

type Resolved = {
  instance: SavedInstance
  directory?: string
}

async function resolveSelection(
  service: InstanceService,
  args: ReturnType<typeof parseArgs>,
): Promise<Resolved | null> {
  // Headless flow: --instance bypasses the wizard.
  if (args.instance) {
    const all = await service.list()
    const found = all.find((i) => i.id === args.instance)
    if (!found) throw new Error(`Saved instance not found: ${args.instance}`)
    return { instance: found, directory: args.directory }
  }

  // Interactive: render the boot wizard. If there are no saved instances,
  // seed a default-local entry so the list is never empty.
  let instances = await service.list()
  if (instances.length === 0) {
    await ensureSavedDefault(service)
    instances = await service.list()
  }

  const selection: BootSelection | null = await runBootWizard({
    service,
    instances,
    defaultDirectory: args.directory ?? process.cwd(),
  })
  if (!selection) return null
  return { instance: selection.instance, directory: selection.directory }
}

async function resolveTarget(
  service: InstanceService,
  args: ReturnType<typeof parseArgs>,
): Promise<{
  instance: SavedInstance
  url: string
  headers: Record<string, string>
  directory?: string
} | null> {
  const sel = await resolveSelection(service, args)
  if (!sel) return null

  // Translate `local://...` -> live http URL by booting the local server (or
  // attaching to one already running). For non-local URLs this is a no-op.
  // Side effect: `opened.path.directory` is the SERVER's resolved working
  // directory — for a local server that's wherever the binary defaulted to,
  // for a remote server that's the path on the remote machine.
  const opened = await service.open(sel.instance)
  const url = normalizeInstanceUrl(opened.live.url)
  if (!url) throw new Error(`Resolved instance has invalid URL: ${opened.live.url}`)

  // Pick the right directory to scope the session to. The bug we're
  // fixing here: until v27.4.53, `sel.directory` (a LOCAL filesystem
  // path the user picked in the boot wizard's DirectoryPicker) was
  // unconditionally returned. For local instances that's correct
  // (the local server lives on the same filesystem). For remote
  // instances it was completely wrong — the picked path doesn't
  // exist on the remote server, so all tool calls (read/write/grep/
  // ls/etc.) would either fail or silently fall back to the server's
  // process.cwd(), which had nothing to do with what the user
  // selected.
  //
  // Now: if a directory was picked or supplied via --directory, use
  // it (it's interpreted on the SERVER side regardless of remote/
  // local — this is what `client.path.get({ directory })` does).
  // Otherwise fall back to the server-resolved default from
  // `service.open()`, which is the correct default for both modes.
  const directory = sel.directory ?? opened.path.directory ?? undefined

  return {
    instance: sel.instance,
    url,
    headers: headersForInstance(opened.live) ?? {},
    directory,
  }
}

async function main() {
  // Lift service creation here so we can `stopAll()` after tui() resolves.
  // service.open() spawns the local Codeplane server with stdio pipes and no
  // unref(), so its file descriptors keep Bun's event loop alive until we
  // explicitly tear them down — otherwise `/exit` clears the TUI but the
  // process hangs on a blank terminal.
  const service = createInstanceService()
  let stopped = false
  const stopLocalServers = async () => {
    if (stopped) return
    stopped = true
    await service.stopAll().catch(() => undefined)
  }
  // Cover SIGTERM / SIGHUP too so external kills don't leave orphan servers.
  // SIGINT is absorbed by the TUI renderer (exitOnCtrlC: false) but we register
  // it for parity in case the user kills before/after the renderer is mounted.
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
    process.once(signal, () => {
      void stopLocalServers().finally(() => process.exit(0))
    })
  }

  try {
    const args = parseArgs(process.argv.slice(2))
    if (args.fork && !args.continueSession && !args.sessionID) {
      throw new Error("--fork requires --continue or --session")
    }
    const target = await resolveTarget(service, args)
    if (!target) {
      // User quit out of the wizard — exit cleanly.
      await stopLocalServers()
      process.exit(0)
    }

    const config = await TuiConfig.get()
    const tuiArgs: Args = {
      instanceID: target.instance.id,
      continue: args.continueSession,
      sessionID: args.sessionID,
      fork: args.fork,
      model: args.model,
      agent: args.agent,
      prompt: args.prompt,
    }
    await tui({
      url: target.url,
      config,
      args: tuiArgs,
      directory: target.directory,
      headers: target.headers,
    })
  } finally {
    await stopLocalServers()
  }
}

// Recognize the connection-failure signatures Bun / Node fetch surface when
// the instance is gone or the credentials are wrong, and print a clear
// "instance unreachable" / "auth required" message instead of a raw stack.
// The user can then re-run `codeplane tui` to land back on the boot wizard
// and pick a different instance (matches the desktop's bounce-to-Loader
// behavior shipped in v27.4.32).
function classifyTuiExitError(err: unknown): { kind: "unreachable" | "auth-required" | "unknown"; detail: string } {
  const message = err instanceof Error ? err.message : String(err)
  const detail = message || "Unknown error"
  const lower = message.toLowerCase()
  if (lower.includes("401") || lower.includes("unauthorized")) return { kind: "auth-required", detail }
  if (lower.includes("403") || lower.includes("forbidden")) return { kind: "auth-required", detail }
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("ehostunreach") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("connection refused") ||
    lower.includes("network is unreachable") ||
    lower.includes("getaddrinfo") ||
    lower.includes("connect timeout")
  ) {
    return { kind: "unreachable", detail }
  }
  return { kind: "unknown", detail }
}

main().catch((err) => {
  const classified = classifyTuiExitError(err)
  if (classified.kind === "unreachable") {
    // eslint-disable-next-line no-console
    console.error(
      `\nInstance unreachable: ${classified.detail}\n` +
        `\nRe-run \`codeplane tui\` to pick a different instance from the boot wizard,\n` +
        `or check that the server is running and that the saved URL / headers match.\n`,
    )
    process.exit(2)
  }
  if (classified.kind === "auth-required") {
    // eslint-disable-next-line no-console
    console.error(
      `\nInstance rejected the credentials: ${classified.detail}\n` +
        `\nThe server returned 401/403. Update the saved instance's authorization\n` +
        `header to match the server's --password (or fix the password on the server).\n` +
        `Re-run \`codeplane tui\` to pick the instance again.\n`,
    )
    process.exit(2)
  }
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
