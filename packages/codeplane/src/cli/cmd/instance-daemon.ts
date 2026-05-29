// `codeplane instance daemon ...` — long-running background process for
// a saved local instance. Why this exists: scheduled cron tasks live
// inside the codeplane server. If the server isn't running, no cron
// fires. With ad-hoc `codeplane tui` use only, the server is alive
// only for the duration of the TUI session — close the terminal and
// every cron task you set up is dormant until you re-open the TUI.
//
// The daemon decouples the SERVER lifecycle from the CLIENT lifecycle:
//   - `instance daemon start <id>` spawns the server fully detached
//     and writes a state file with PID + URL.
//   - The server keeps running across shell exits / reboots-of-other-
//     terminals. Crons fire as scheduled regardless of whether you
//     have a TUI / Desktop attached.
//   - `instance daemon stop <id>` reads the state file and kills the
//     process group cleanly.
//   - `instance daemon status` lists every daemon's live URL across
//     all instances + verifies the server is actually responding.
//   - Future: `instance daemon install <id>` for launchd / systemd
//     auto-start on login (separate release).
//
// State files live at `<root>/instances/<id>/daemon.json` so each
// instance has its own daemon state and one daemon per instance is
// the natural cap.

import path from "node:path"
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, openSync } from "node:fs"
import { spawn } from "node:child_process"
import type { Argv } from "yargs"
import { CodeplaneHome } from "@codeplane-ai/shared/home"
import { createInstanceService } from "../../tui/instance-service"
import { UI } from "../ui"
import { cmd } from "./cmd"

type DaemonState = {
  pid: number
  port: number
  url: string
  startedAt: number
  binary: string
  /** Server's binaryVersion at launch — used by `status` to detect drift. */
  binaryVersion: string
}

function daemonStateFile(id: string): string {
  // Per-instance daemon state lives in the target instance's own
  // subdir under the global root (NOT the per-instance subdir of the
  // CLI process invoking us — those can differ when the user runs
  // `codeplane --instance work instance daemon start home`, where
  // the CLI is routed to instances/work/ but the daemon target is
  // home → instances/home/daemon.json). Using paths.globalRoot
  // (introduced in v27.4.51) keeps both surfaces resolving the same
  // file regardless of which per-instance subtree the caller is in.
  return path.join(CodeplaneHome.paths().globalRoot, "instances", id, "daemon.json")
}

function daemonLogFile(id: string): string {
  return path.join(CodeplaneHome.paths().globalRoot, "instances", id, "daemon.log")
}

function readDaemonState(id: string): DaemonState | undefined {
  const file = daemonStateFile(id)
  if (!existsSync(file)) return undefined
  try {
    const raw = readFileSync(file, "utf8")
    return JSON.parse(raw) as DaemonState
  } catch {
    return undefined
  }
}

function isPidAlive(pid: number): boolean {
  // Node convention: signal 0 doesn't actually deliver a signal; it's
  // just a permission/existence check. Throws if the pid doesn't exist
  // or we don't own it.
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function probePort(url: string, timeoutMs = 1500): Promise<{ ok: boolean; status?: number; version?: string; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL("/global/version", url), { signal: controller.signal })
    if (!response.ok) return { ok: false, status: response.status }
    const body = (await response.json().catch(() => ({}))) as { current?: unknown }
    return { ok: true, status: response.status, version: typeof body.current === "string" ? body.current : undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function waitForListening(logPath: string, deadline: number): Promise<{ port: number; url: string } | undefined> {
  // Poll the log file for the spawned `codeplane serve`'s startup line:
  //   `codeplane server listening on http://127.0.0.1:NNNNN`
  // Once we see it, parse the port and return. Polling is cheaper than
  // setting up an inotify/fsevents watcher for a single file we expect
  // to settle within seconds.
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      const text = readFileSync(logPath, "utf8")
      const match = text.match(/listening on (https?:\/\/[^\s]+)/)
      if (match) {
        const url = match[1].trim()
        const port = Number(new URL(url).port) || 0
        if (port) return { port, url }
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return undefined
}

function fail(message: string): never {
  UI.println(UI.Style.TEXT_DANGER_BOLD + message)
  process.exit(1)
}

const InstanceDaemonStartCommand = cmd({
  command: "start <id>",
  describe: "spawn the server for a saved local instance as a detached background process",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved local instance id",
    }),
  async handler(args) {
    const id = (args as { id: string }).id
    const service = createInstanceService()
    const list = await service.list()
    const saved = list.find((item) => item.id === id)
    if (!saved) {
      fail(`No saved instance with id "${id}". Use \`codeplane instance list\` to see what exists.`)
    }
    if (!saved!.local) {
      fail(
        `Instance "${id}" is a remote URL — there's no local server to daemonize. ` +
          `The remote server is already running on its own host; use \`codeplane tui --instance ${id}\` to attach.`,
      )
    }

    // Already running?
    const existing = readDaemonState(id)
    if (existing && isPidAlive(existing.pid)) {
      const probe = await probePort(existing.url)
      if (probe.ok) {
        UI.println(
          UI.Style.TEXT_WARNING_BOLD +
            `Daemon for "${id}" is already running.\n` +
            UI.Style.TEXT_NORMAL +
            `  pid     ${existing.pid}\n` +
            `  url     ${existing.url}\n` +
            `  version ${probe.version ?? "?"}\n` +
            `  log     ${daemonLogFile(id)}\n` +
            `Use \`codeplane instance daemon stop ${id}\` to stop it first.`,
        )
        return
      }
      // Stale state file — pid alive but port not responding. Treat
      // as orphaned and clean up so we can start a fresh one.
      try {
        unlinkSync(daemonStateFile(id))
      } catch {}
    }

    const binaryVersion = saved!.local!.binaryVersion
    // Use the instance service's localStatus to find where the binary
    // landed on disk. We can't use resolveLocalBinaryPath directly
    // because it takes a version-specific root + binaryName, not just
    // a version — the path computation is wrapped inside the local
    // manager which knows the binaries dir layout.
    const status = await service.localStatus(binaryVersion)
    if (!status.installed || !status.binaryPath) {
      fail(
        `Local runtime v${binaryVersion} for instance "${id}" is not installed on disk. ` +
          `Run \`codeplane instance local install ${binaryVersion}\` first, or update the instance via the picker.`,
      )
    }
    const binary = status.binaryPath

    // Make sure the per-instance dir exists for the log + state file.
    // This process (`codeplane instance daemon start`) is a registry/meta
    // command with no per-instance home of its own. The daemon state + log
    // live under the shared root at instances/<id>/, which nothing has
    // created yet; resolveLocalBinaryPath doesn't pre-create it.
    const instanceDir = path.dirname(daemonStateFile(id))
    mkdirSync(instanceDir, { recursive: true })

    const logPath = daemonLogFile(id)
    // Open in append mode so re-running start doesn't wipe a previous
    // session's output (handy for post-mortem when the daemon dies).
    const logFd = openSync(logPath, "a")

    UI.println(UI.Style.TEXT_INFO_BOLD + `Spawning daemon for "${id}"…`)
    UI.println(
      UI.Style.TEXT_NORMAL +
        `  binary ${binary}\n` +
        `  args   serve --instance ${id} --hostname 127.0.0.1 --port 0\n` +
        `  log    ${logPath}`,
    )

    const child = spawn(
      binary!,
      ["serve", "--instance", id, "--hostname", "127.0.0.1", "--port", "0"],
      {
        cwd: process.env.HOME?.trim() || process.cwd(),
        env: { ...process.env },
        // `detached: true` + `unref()` makes the child outlive the
        // parent process. stdio piped to the log file (not "ignore"
        // because we need to find the listen line for the port).
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      },
    )
    if (!child.pid) {
      fail("Spawn returned no pid — the OS rejected the daemon launch.")
    }
    child.unref()

    UI.println(UI.Style.TEXT_NORMAL + `\nWaiting for server to bind to a port (up to 30s)…`)
    const listening = await waitForListening(logPath, Date.now() + 30_000)
    if (!listening) {
      // Server never logged its listen line. Don't write state — there's
      // nothing for `stop` or `status` to use. Inform the user where to
      // look for the failure.
      try {
        process.kill(child.pid!, "SIGTERM")
      } catch {}
      fail(
        `Daemon spawned (pid ${child.pid}) but did not log a listening URL within 30s.\n` +
          `Check ${logPath} for startup errors.`,
      )
    }

    const state: DaemonState = {
      pid: child.pid!,
      port: listening.port,
      url: listening.url,
      startedAt: Date.now(),
      binary: binary!,
      binaryVersion,
    }
    writeFileSync(daemonStateFile(id), JSON.stringify(state, null, 2))

    // Final probe to confirm the server actually responds, not just
    // that it logged the listen line.
    const probe = await probePort(state.url, 5_000)
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `\n✓ Daemon for "${id}" is running.\n` +
        UI.Style.TEXT_NORMAL +
        `  pid     ${state.pid}\n` +
        `  url     ${state.url}\n` +
        `  version ${probe.version ?? "(probe failed: " + (probe.error ?? probe.status) + ")"}\n` +
        `  log     ${logPath}\n` +
        `\nCron tasks scheduled in this instance will now fire reliably,\n` +
        `regardless of whether you have a TUI / Desktop attached.\n` +
        `Stop with: codeplane instance daemon stop ${id}`,
    )
  },
})

const InstanceDaemonStopCommand = cmd({
  command: "stop <id>",
  describe: "kill the background daemon for a saved local instance",
  builder: (yargs: Argv) =>
    yargs.positional("id", {
      type: "string",
      describe: "saved local instance id",
    }),
  async handler(args) {
    const id = (args as { id: string }).id
    const state = readDaemonState(id)
    if (!state) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + `No daemon state file for "${id}". Nothing to stop.`)
      return
    }
    if (!isPidAlive(state.pid)) {
      try {
        unlinkSync(daemonStateFile(id))
      } catch {}
      UI.println(
        UI.Style.TEXT_WARNING_BOLD +
          `Daemon for "${id}" was already dead (stale pid ${state.pid}). State file cleaned up.`,
      )
      return
    }
    try {
      process.kill(state.pid, "SIGTERM")
    } catch (err) {
      fail(`Failed to send SIGTERM to pid ${state.pid}: ${err instanceof Error ? err.message : String(err)}`)
    }
    // Give it 5s to exit cleanly, then SIGKILL.
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      if (!isPidAlive(state.pid)) break
      await new Promise((r) => setTimeout(r, 100))
    }
    if (isPidAlive(state.pid)) {
      try {
        process.kill(state.pid, "SIGKILL")
      } catch {}
    }
    try {
      unlinkSync(daemonStateFile(id))
    } catch {}
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Stopped daemon for "${id}" (was pid ${state.pid}).`)
  },
})

const InstanceDaemonStatusCommand = cmd({
  command: "status [id]",
  describe: "list running daemons (or show one specific instance)",
  builder: (yargs: Argv) =>
    yargs
      .positional("id", {
        type: "string",
        describe: "specific instance id; if omitted, lists all daemons",
      })
      .option("json", { type: "boolean", default: false, describe: "print machine-readable JSON" }),
  async handler(args) {
    const { id, json } = args as { id?: string; json?: boolean }
    const service = createInstanceService()
    const list = await service.list()
    const ids = id ? [id] : list.filter((i) => i.local).map((i) => i.id)

    type Row = {
      id: string
      pid?: number
      url?: string
      alive: boolean
      reachable: boolean
      version?: string
      uptimeMs?: number
      reason?: string
    }
    const rows: Row[] = []
    for (const targetId of ids) {
      const state = readDaemonState(targetId)
      if (!state) {
        rows.push({ id: targetId, alive: false, reachable: false, reason: "no daemon state file" })
        continue
      }
      const alive = isPidAlive(state.pid)
      if (!alive) {
        rows.push({ id: targetId, pid: state.pid, url: state.url, alive: false, reachable: false, reason: "pid dead (stale state)" })
        continue
      }
      const probe = await probePort(state.url, 1500)
      rows.push({
        id: targetId,
        pid: state.pid,
        url: state.url,
        alive: true,
        reachable: probe.ok,
        version: probe.version,
        uptimeMs: Date.now() - state.startedAt,
        reason: probe.ok ? undefined : `port not responding: ${probe.status ? `HTTP ${probe.status}` : probe.error}`,
      })
    }

    if (json) {
      console.log(JSON.stringify(rows, null, 2))
      return
    }
    if (rows.length === 0) {
      UI.println(UI.Style.TEXT_NORMAL + "No saved local instances.")
      return
    }
    for (const row of rows) {
      const status = row.alive && row.reachable ? "✓ running" : row.alive ? "⚠ unreachable" : "○ stopped"
      const color =
        row.alive && row.reachable
          ? UI.Style.TEXT_SUCCESS_BOLD
          : row.alive
            ? UI.Style.TEXT_WARNING_BOLD
            : UI.Style.TEXT_DIM
      UI.println(color + `${status}  ${row.id}`)
      if (row.url) UI.println(UI.Style.TEXT_NORMAL + `         url     ${row.url}`)
      if (row.pid !== undefined) UI.println(UI.Style.TEXT_NORMAL + `         pid     ${row.pid}`)
      if (row.version) UI.println(UI.Style.TEXT_NORMAL + `         version ${row.version}`)
      if (row.uptimeMs !== undefined) {
        const m = Math.floor(row.uptimeMs / 60_000)
        const h = Math.floor(m / 60)
        const uptimeStr = h > 0 ? `${h}h ${m % 60}m` : `${m}m`
        UI.println(UI.Style.TEXT_NORMAL + `         uptime  ${uptimeStr}`)
      }
      if (row.reason) UI.println(UI.Style.TEXT_DIM + `         note    ${row.reason}`)
    }
  },
})

export const InstanceDaemonCommand = cmd({
  command: "daemon",
  describe: "manage long-running background servers for local instances (so cron tasks fire when no client is open)",
  builder: (yargs: Argv) =>
    yargs
      .command(InstanceDaemonStartCommand)
      .command(InstanceDaemonStopCommand)
      .command(InstanceDaemonStatusCommand)
      .demandCommand(),
  async handler() {},
})
