// TUI-local Process namespace. Wraps `@/util/process.spawn` and adds the
// `run`/`text`/`stop` helpers and `RunFailedError` class their TUI expects.
// Mirrors the contract of `@opencode-ai/core/util/process` so callers built
// against that surface compile unchanged.
//
// Provides both styles:
//   import { Process } from "@/tui/_compat/process"
//   import * as Process from "@/tui/_compat/process"
import { spawn as spawnRaw, type Options as SpawnOptions, type Child as SpawnChild } from "@/util/process"
import { errorMessage } from "@/util/error"

export interface RunOptions extends Omit<SpawnOptions, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface Result {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface TextResult extends Result {
  text: string
}

export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

async function bufferStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks)
}

export const spawn = spawnRaw

export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
  const proc = spawnRaw(cmd, {
    ...opts,
    stdout: "pipe",
    stderr: "pipe",
  } as SpawnOptions)
  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")
  const exited = new Promise<number>((resolve, reject) => {
    proc.on("close", (code: number | null) => resolve(code ?? 0))
    proc.on("error", reject)
  })
  const out = await Promise.all([exited, bufferStream(proc.stdout), bufferStream(proc.stderr)])
    .then(([code, stdout, stderr]) => ({ code, stdout, stderr }))
    .catch((err: unknown) => {
      if (!opts.nothrow) throw err
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(errorMessage(err)),
      }
    })
  if (out.code === 0 || opts.nothrow) return out
  throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
}

export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
  const out = await run(cmd, opts)
  return { ...out, text: out.stdout.toString() }
}

export async function stop(proc: SpawnChild): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform !== "win32" || !proc.pid) {
    proc.kill?.()
    return
  }
  const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], { nothrow: true })
  if (out.code === 0) return
  proc.kill?.()
}

export type Child = SpawnChild

export const Process = {
  RunFailedError,
  spawn,
  run,
  text,
  stop,
} as const

export namespace Process {
  export type Child = SpawnChild
  export type Result = import("./process").Result
  export type TextResult = import("./process").TextResult
  export type RunOptions = import("./process").RunOptions
}
