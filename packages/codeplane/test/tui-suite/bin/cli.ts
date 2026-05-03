#!/usr/bin/env bun
/**
 * tui-suite CLI — single entrypoint for everything.
 *
 *   tui-suite list                     list available fixtures
 *   tui-suite preview <fixture>        boot a fixture, serve HTML on http://127.0.0.1:0
 *   tui-suite dev <fixture>            print frames + accept commands on stdin
 *   tui-suite agent                    JSON-RPC over stdio (external agents drive)
 *   tui-suite surveil <fixture>        long-running soak with random walk
 *   tui-suite snapshot <fixture>       single frame to stdout
 *   tui-suite test                     run bun:test on the suite
 */
import { FIXTURES, type FixtureName } from "../fixtures"
import { mount } from "../harness/harness"
import { trimFrame, frameToHtml } from "../harness/snapshot"
import { startPreview } from "../preview/server"
import { surveil, randomWalkScript, type SurveillanceScript } from "../surveillance/runner"
import { AgentServer, serveStdio } from "../agent/server"
import { spawn } from "node:child_process"
import path from "node:path"

const argv = process.argv.slice(2)
const cmd = argv[0]
const rest = argv.slice(1)

main().catch((err) => {
  process.stderr.write(`tui-suite: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

async function main() {
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp()
      return
    case "list":
      console.log(Object.keys(FIXTURES).sort().join("\n"))
      return
    case "preview":
      return cmdPreview(rest)
    case "dev":
      return cmdDev(rest)
    case "agent":
      return cmdAgent()
    case "surveil":
      return cmdSurveil(rest)
    case "snapshot":
      return cmdSnapshot(rest)
    case "test":
      return cmdTest(rest)
    default:
      process.stderr.write(`unknown command: ${cmd}\n`)
      printHelp()
      process.exit(2)
  }
}

function printHelp() {
  process.stdout.write(`tui-suite — TUI test + driver suite

  list                          list available fixtures
  preview <fixture> [--port N]  serve fixture as HTML on http://127.0.0.1:PORT
  dev <fixture>                 interactive REPL (stdin commands, frames to stdout)
  agent                         JSON-RPC over stdio for external agents
  surveil <fixture> [--iter N]  random-walk soak test, prints structured report
  snapshot <fixture> [--ansi]   one frame to stdout (text or ANSI)
  test [...bun args]            run bun:test on the suite
`)
}

function getFixture(name: string): () => any {
  if (!(name in FIXTURES)) {
    throw new Error(`no such fixture "${name}". Try: tui-suite list`)
  }
  return FIXTURES[name as FixtureName]
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  return args[i + 1]
}
function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

async function cmdPreview(args: string[]) {
  const name = args[0]
  if (!name) throw new Error("usage: tui-suite preview <fixture> [--port N]")
  const factory = getFixture(name)
  const port = Number(flag(args, "--port") ?? 0)
  const handle = await startPreview({ factory, port })
  process.stdout.write(`tui-suite preview "${name}" -> ${handle.url}\n`)
  process.stdout.write(`(Ctrl+C to stop)\n`)
  process.on("SIGINT", async () => {
    await handle.stop()
    process.exit(0)
  })
  await new Promise(() => {})
}

async function cmdDev(args: string[]) {
  const name = args[0]
  if (!name) throw new Error("usage: tui-suite dev <fixture>")
  const factory = getFixture(name)
  const h = await mount(factory)
  process.stdout.write(`tui-suite dev "${name}" — type "help" for commands\n`)
  printFrame(h.text())

  const stdin = process.stdin
  stdin.setEncoding("utf8")
  let buf = ""
  process.on("SIGINT", async () => {
    await h.unmount()
    process.exit(0)
  })

  for await (const chunk of stdin as AsyncIterable<string>) {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const out = await runDevCmd(h, line)
        if (out) process.stdout.write(out + "\n")
      } catch (err) {
        process.stdout.write(`! ${err instanceof Error ? err.message : String(err)}\n`)
      }
    }
  }
  await h.unmount()
}

async function runDevCmd(h: Awaited<ReturnType<typeof mount>>, line: string): Promise<string | undefined> {
  const space = line.indexOf(" ")
  const cmd = (space < 0 ? line : line.slice(0, space)).toLowerCase()
  const arg = space < 0 ? "" : line.slice(space + 1)
  switch (cmd) {
    case "help":
    case "?":
      return [
        "  press <chord>     send a key chord (e.g. press down, press ctrl+c)",
        "  type <text>       type literal text",
        "  resize <w> <h>    resize the simulated terminal",
        "  frame             print the current frame",
        "  html              print frame as HTML",
        "  find <needle>     locate text in the current frame",
        "  wait <text>       wait for text to appear",
        "  unmount           tear down the harness and exit",
      ].join("\n")
    case "press":
      await h.press(arg)
      printFrame(h.text())
      return
    case "type":
      await h.type(arg)
      printFrame(h.text())
      return
    case "resize": {
      const [w, hh] = arg.split(/\s+/).map((s) => Number(s))
      await h.resize(w!, hh!)
      printFrame(h.text())
      return
    }
    case "frame":
      printFrame(h.text())
      return
    case "html":
      return frameToHtml(h.frame())
    case "find": {
      const f = h.find(arg)
      return f ? `row=${f.row} col=${f.col} text=${JSON.stringify(f.text)}` : "(not found)"
    }
    case "wait":
      await h.waitForText(arg, 5000)
      printFrame(h.text())
      return
    case "unmount":
      await h.unmount()
      process.exit(0)
    default:
      return `unknown command "${cmd}" — type "help"`
  }
}

function printFrame(text: string) {
  const lines = text.split("\n")
  const sep = "─".repeat(Math.max(20, Math.min(120, (lines[0] ?? "").length)))
  process.stdout.write(sep + "\n")
  process.stdout.write(text + "\n")
  process.stdout.write(sep + "\n")
}

async function cmdAgent() {
  const server = new AgentServer({ fixtures: FIXTURES })
  await serveStdio(server)
}

async function cmdSurveil(args: string[]) {
  const name = args[0]
  if (!name) throw new Error("usage: tui-suite surveil <fixture> [--iter N] [--ms N]")
  const factory = getFixture(name)
  const iterations = Number(flag(args, "--iter") ?? 200)
  const tickMs = Number(flag(args, "--ms") ?? 0)
  const chords = flag(args, "--keys")?.split(",") ?? defaultChordsFor(name)
  const script: SurveillanceScript = randomWalkScript(`${name}-walk`, chords, 4)
  const report = await surveil(factory, script, {
    iterations,
    tickMs,
    snapshotEvery: Math.max(1, Math.floor(iterations / 5)),
  })
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  if (!report.ok) process.exit(3)
}

function defaultChordsFor(name: string): string[] {
  switch (name) {
    case "list":
    case "scroll":
      return ["up", "down", "home", "end", "pageup", "pagedown"]
    case "dialog":
      return ["o", "y", "n", "escape"]
    case "input":
      return ["a", "b", "c", "backspace", "enter"]
    case "error-boundary":
      return ["x", "r"]
    default:
      return ["up", "down", "left", "right", "enter", "escape"]
  }
}

async function cmdSnapshot(args: string[]) {
  const name = args[0]
  if (!name) throw new Error("usage: tui-suite snapshot <fixture> [--ansi]")
  const factory = getFixture(name)
  const h = await mount(factory)
  try {
    if (hasFlag(args, "--ansi")) {
      const { frameToAnsi } = await import("../harness/snapshot")
      process.stdout.write(frameToAnsi(h.frame()) + "\n")
    } else {
      process.stdout.write(trimFrame(h.frame()) + "\n")
    }
  } finally {
    await h.unmount()
  }
}

async function cmdTest(args: string[]) {
  const cwd = path.resolve(import.meta.dir, "..", "..", "..")
  const child = spawn("bun", ["test", "test/tui-suite", "--timeout", "30000", ...args], {
    cwd,
    stdio: "inherit",
  })
  await new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      process.exit(code ?? 0)
      resolve()
    })
  })
}
