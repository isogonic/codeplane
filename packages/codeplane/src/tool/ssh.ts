import { Schema, Effect, Stream } from "effect"
import os from "os"
import path from "path"
import fsp from "fs/promises"
import { createWriteStream } from "node:fs"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Instance } from "../project/instance"
import { Log } from "../util"
import * as Tool from "./tool"
import DESCRIPTION from "./ssh.txt"

const log = Log.create({ service: "ssh-tool" })

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 10 * 60_000
const MAX_INLINE_OUTPUT_BYTES = 256 * 1024
const CONTROL_DIR = path.join(os.tmpdir(), "codeplane-ssh")

// Truncate to a byte budget on a codepoint boundary. The old code compared
// .length (UTF-16 units) to a byte limit and sliced by units, which both
// mis-measured multi-byte text and could split a surrogate pair at the cut
// (orphaned surrogate → U+FFFD on UTF-8 encode).
function truncateBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  let bytes = 0
  let out = ""
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, "utf-8")
    if (bytes + chBytes > maxBytes) break
    bytes += chBytes
    out += ch
  }
  return out + "…"
}

export const Parameters = Schema.Struct({
  host: Schema.String.annotate({
    description: "Destination as [user@]host[:port], or a host alias from ~/.ssh/config.",
  }),
  operation: Schema.optional(Schema.Literals(["exec", "upload", "download", "sync", "script"])).annotate({
    description: "What to do on the host. Default 'exec'. See the tool description for the fields each operation expects.",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "exec: the shell command to run on the remote host.",
  }),
  script: Schema.optional(Schema.String).annotate({
    description: "script: full script body sent over a heredoc.",
  }),
  interpreter: Schema.optional(Schema.String).annotate({
    description: "script: remote interpreter, default 'bash'.",
  }),
  stdin: Schema.optional(Schema.String).annotate({
    description: "exec/script: string piped to the remote command's stdin.",
  }),
  localPath: Schema.optional(Schema.String).annotate({
    description: "upload/download/sync: local path (absolute or workdir-relative).",
  }),
  remotePath: Schema.optional(Schema.String).annotate({
    description: "upload/download/sync: remote path on the host.",
  }),
  recursive: Schema.optional(Schema.Boolean).annotate({
    description: "upload/download: copy directories recursively.",
  }),
  delete: Schema.optional(Schema.Boolean).annotate({
    description: "sync: pass --delete to rsync to remove extraneous remote files.",
  }),
  exclude: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "sync: rsync exclude patterns.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: `exec/script: milliseconds. Default ${DEFAULT_TIMEOUT_MS}, cap ${MAX_TIMEOUT_MS}.`,
  }),
  identityFile: Schema.optional(Schema.String).annotate({
    description: "Path to a private key file. Falls back to ssh-agent and the user's default key when omitted.",
  }),
  port: Schema.optional(Schema.Number).annotate({
    description: "TCP port override. Takes precedence over the host:port shorthand.",
  }),
  jumpHost: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Array of [user@]host[:port] strings forming an SSH jump chain (-J).",
  }),
  forwardAgent: Schema.optional(Schema.Boolean).annotate({
    description: "Forward the local SSH agent (-A). Default false.",
  }),
  strictHostKeyChecking: Schema.optional(Schema.Literals(["yes", "accept-new", "no"])).annotate({
    description:
      "StrictHostKeyChecking value. Default 'yes'. 'no' is dangerous and should only be used for ephemeral hosts.",
  }),
  extraOptions: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Array of -o style options (e.g. 'ServerAliveInterval=30').",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type ParsedHost = {
  user?: string
  host: string
  port?: number
}

function parseHost(value: string): ParsedHost {
  const userSplit = value.split("@")
  const user = userSplit.length > 1 ? userSplit[0] : undefined
  const remainder = userSplit.length > 1 ? userSplit.slice(1).join("@") : value
  // Bracketed IPv6: [::1]:22
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(remainder)
  if (bracket) {
    return { user, host: bracket[1], port: bracket[2] ? Number(bracket[2]) : undefined }
  }
  const colonIdx = remainder.lastIndexOf(":")
  // Only treat as host:port if everything after the colon is digits — leaves
  // IPv6 addresses (which contain colons) alone when not bracketed.
  if (colonIdx >= 0 && /^\d+$/.test(remainder.slice(colonIdx + 1))) {
    return { user, host: remainder.slice(0, colonIdx), port: Number(remainder.slice(colonIdx + 1)) }
  }
  return { user, host: remainder }
}

function controlPath(parsed: ParsedHost) {
  // OpenSSH appends %r/%h/%p substitutions; we hash the host so the control
  // socket path is short (Linux limits AF_UNIX sock paths to 108 bytes).
  const key = `${parsed.user ?? ""}@${parsed.host}:${parsed.port ?? ""}`
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0
  const slug = (hash >>> 0).toString(16).padStart(8, "0")
  return path.join(CONTROL_DIR, `cm-${slug}.sock`)
}

function buildSshArgs(params: Params, parsed: ParsedHost, extra: string[] = []) {
  const args: string[] = []
  const opt = (k: string, v: string) => args.push("-o", `${k}=${v}`)

  opt("ControlMaster", "auto")
  opt("ControlPath", controlPath(parsed))
  opt("ControlPersist", "10m")
  opt("BatchMode", "yes")
  opt("ConnectTimeout", "15")
  opt("StrictHostKeyChecking", params.strictHostKeyChecking ?? "yes")

  for (const item of params.extraOptions ?? []) args.push("-o", item)

  const port = params.port ?? parsed.port
  if (port !== undefined) args.push("-p", String(port))
  if (params.identityFile) args.push("-i", params.identityFile)
  if (params.forwardAgent) args.push("-A")
  if (params.jumpHost?.length) args.push("-J", params.jumpHost.join(","))

  args.push(...extra)

  const target = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
  args.push(target)
  return args
}

function buildScpArgs(params: Params, parsed: ParsedHost) {
  const args: string[] = []
  args.push("-o", `ControlPath=${controlPath(parsed)}`)
  args.push("-o", "ControlMaster=auto")
  args.push("-o", "ControlPersist=10m")
  args.push("-o", "BatchMode=yes")
  args.push("-o", `StrictHostKeyChecking=${params.strictHostKeyChecking ?? "yes"}`)
  for (const item of params.extraOptions ?? []) args.push("-o", item)
  const port = params.port ?? parsed.port
  if (port !== undefined) args.push("-P", String(port))
  if (params.identityFile) args.push("-i", params.identityFile)
  if (params.jumpHost?.length) args.push("-J", params.jumpHost.join(","))
  return args
}

function remoteSpec(parsed: ParsedHost, p: string) {
  const target = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
  // bracket IPv6 when forming scp target; scp uses host:path syntax.
  const safeHost = target.includes(":") && !target.startsWith("[") ? `[${target}]` : target
  return `${safeHost}:${p}`
}

const Operation = Schema.Literals(["exec", "upload", "download", "sync", "script"])
type Operation = Schema.Schema.Type<typeof Operation>

function permissionPattern(parsed: ParsedHost, operation: Operation) {
  const target = parsed.user ? `${parsed.user}@${parsed.host}` : parsed.host
  return `${operation}:${target}`
}

async function ensureControlDir() {
  await fsp.mkdir(CONTROL_DIR, { recursive: true, mode: 0o700 }).catch(() => undefined)
}

function clampTimeout(input?: number) {
  if (!input || !Number.isFinite(input)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(input, 1_000), MAX_TIMEOUT_MS)
}

function resolveLocalPath(input: string) {
  if (path.isAbsolute(input)) return input
  return path.resolve(Instance.directory, input)
}

export const SshTool = Tool.define(
  "ssh",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    const runProcess = Effect.fnUntraced(function* (input: {
      command: string
      args: string[]
      stdin?: string
      timeoutMs: number
      cwd?: string
      env?: Record<string, string>
    }) {
      const proc = ChildProcess.make(input.command, input.args, {
        stdin: input.stdin ? Stream.make(new TextEncoder().encode(input.stdin)) : undefined,
        env: input.env,
        cwd: input.cwd,
        extendEnv: true,
      })

      const handle = yield* spawner.spawn(proc)

      let outBuffer = ""
      let outBytes = 0
      let outFile: string | undefined
      let outStream: ReturnType<typeof createWriteStream> | undefined

      const consumeStdout = Stream.decodeText(handle.stdout).pipe(
        Stream.runForEach((text) =>
          Effect.sync(() => {
            outBytes += text.length
            if (outBytes <= MAX_INLINE_OUTPUT_BYTES) {
              outBuffer += text
              return
            }
            if (!outStream) {
              outFile = path.join(os.tmpdir(), `codeplane-ssh-${Date.now()}.log`)
              outStream = createWriteStream(outFile, { flags: "a" })
              outStream.write(outBuffer)
              outBuffer = ""
            }
            outStream?.write(text)
          }),
        ),
      )

      const collect = Effect.gen(function* () {
        const [, stderr] = yield* Effect.all(
          [consumeStdout, Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code: Number(code), stderr }
      }).pipe(Effect.catch((err) => Effect.succeed({ code: -1, stderr: err instanceof Error ? err.message : String(err) })))

      const result = yield* Effect.timeoutOrElse(collect, {
        duration: input.timeoutMs,
        orElse: () =>
          Effect.gen(function* () {
            yield* handle.kill().pipe(Effect.catch(() => Effect.void))
            return { code: -1, stderr: "Timed out" }
          }),
      })

      if (outStream) {
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              outStream!.end(() => resolve())
            }),
        )
      }

      const stdout = outStream && outFile ? `Output truncated to ${outFile}\n${outBuffer}` : outBuffer
      return { code: result.code, stdout, stderr: result.stderr, outFile }
    }, Effect.scoped)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      // SSH commands can legitimately run a long deploy or sync. The
      // sub-operations honor their own timeout and the abort signal, so the
      // tool wrapper's safety-net timeout would just preempt healthy work.
      timeoutMs: null,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const operation: Operation = (params as { operation?: Operation }).operation ?? "exec"
          const parsed = parseHost(params.host)
          if (!parsed.host) throw new Error("ssh: host is required")

          yield* ctx.ask({
            permission: "ssh",
            patterns: [permissionPattern(parsed, operation)],
            always: [`*:${parsed.user ? `${parsed.user}@` : ""}${parsed.host}`, "*"],
            metadata: {
              host: params.host,
              operation,
            },
          })

          yield* Effect.promise(() => ensureControlDir())

          const start = Date.now()
          let stdout = ""
          let stderr = ""
          let exit = 0
          let outFile: string | undefined
          let title = ""

          if (operation === "exec") {
            if (!params.command) throw new Error("ssh exec: 'command' is required")
            const args = buildSshArgs(params, parsed, ["--", params.command])
            const result = yield* runProcess({
              command: "ssh",
              args,
              stdin: params.stdin,
              timeoutMs: clampTimeout(params.timeout),
            })
            stdout = result.stdout
            stderr = result.stderr
            exit = result.code
            outFile = result.outFile
            title = `ssh ${parsed.host}: ${params.command.split("\n")[0].slice(0, 60)}`
          } else if (operation === "script") {
            if (!params.script) throw new Error("ssh script: 'script' is required")
            const interpreter = params.interpreter ?? "bash"
            const heredocTag = `__CODEPLANE_${Date.now()}__`
            const remoteCmd = `${interpreter} <<'${heredocTag}'\n${params.script}\n${heredocTag}\n`
            const args = buildSshArgs(params, parsed, ["--", remoteCmd])
            const result = yield* runProcess({
              command: "ssh",
              args,
              stdin: params.stdin,
              timeoutMs: clampTimeout(params.timeout),
            })
            stdout = result.stdout
            stderr = result.stderr
            exit = result.code
            outFile = result.outFile
            const firstLine =
              params.script.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#")) ?? "script"
            title = `ssh ${parsed.host} (${interpreter}): ${firstLine.slice(0, 60)}`
          } else if (operation === "upload") {
            if (!params.localPath || !params.remotePath)
              throw new Error("ssh upload: 'localPath' and 'remotePath' are required")
            const localPath = resolveLocalPath(params.localPath)
            const stat = yield* Effect.promise(() => fsp.stat(localPath).catch(() => undefined))
            if (!stat) throw new Error(`ssh upload: local path not found: ${localPath}`)
            const recursive = params.recursive ?? stat.isDirectory()
            const args = [...buildScpArgs(params, parsed)]
            if (recursive) args.push("-r")
            args.push(localPath, remoteSpec(parsed, params.remotePath))
            const result = yield* runProcess({ command: "scp", args, timeoutMs: MAX_TIMEOUT_MS })
            stdout = result.stdout
            stderr = result.stderr
            exit = result.code
            outFile = result.outFile
            title = `scp upload ${path.basename(localPath)} → ${parsed.host}:${params.remotePath}`
          } else if (operation === "download") {
            if (!params.localPath || !params.remotePath)
              throw new Error("ssh download: 'localPath' and 'remotePath' are required")
            const localPath = resolveLocalPath(params.localPath)
            const args = [...buildScpArgs(params, parsed)]
            if (params.recursive) args.push("-r")
            args.push(remoteSpec(parsed, params.remotePath), localPath)
            const result = yield* runProcess({ command: "scp", args, timeoutMs: MAX_TIMEOUT_MS })
            stdout = result.stdout
            stderr = result.stderr
            exit = result.code
            outFile = result.outFile
            title = `scp download ${parsed.host}:${params.remotePath} → ${path.basename(localPath)}`
          } else if (operation === "sync") {
            if (!params.localPath || !params.remotePath)
              throw new Error("ssh sync: 'localPath' and 'remotePath' are required")
            const localPath = resolveLocalPath(params.localPath)
            const sshOpts = ["ssh", ...buildSshArgs(params, parsed)]
              .slice(0, -1) // drop the trailing host arg; rsync will append its own host:path target
              .map((arg) => (arg.includes(" ") ? `'${arg.replace(/'/g, "'\\''")}'` : arg))
              .join(" ")
            const args = ["-az", "--info=stats2", "--info=progress2", "-e", sshOpts]
            if (params.delete) args.push("--delete")
            for (const ex of params.exclude ?? []) args.push("--exclude", ex)
            args.push(localPath.endsWith("/") ? localPath : `${localPath}/`, remoteSpec(parsed, params.remotePath))
            const result = yield* runProcess({ command: "rsync", args, timeoutMs: MAX_TIMEOUT_MS })
            stdout = result.stdout
            stderr = result.stderr
            exit = result.code
            outFile = result.outFile
            title = `rsync ${path.basename(localPath)} → ${parsed.host}:${params.remotePath}`
          } else {
            throw new Error(`ssh: unsupported operation ${operation}`)
          }

          const duration = Date.now() - start
          if (exit !== 0) {
            log.info("ssh operation failed", { host: parsed.host, operation, exit })
          }

          const output = (() => {
            if (exit === 0 && stdout.trim()) return stdout
            if (exit === 0) return "(no output)"
            const stderrTrim = stderr.trim()
            const stdoutTrim = stdout.trim()
            const detail = [stdoutTrim, stderrTrim].filter(Boolean).join("\n\n")
            return `Exit ${exit}${detail ? `\n\n${detail}` : ""}`
          })()

          // Leave `metadata.truncated` undefined so the registry wrapper applies
          // the agent's standard truncation rules to the (potentially large)
          // SSH transcript.
          return {
            title,
            output,
            metadata: {
              host: params.host,
              operation,
              exit,
              stderr: truncateBytes(stderr, MAX_INLINE_OUTPUT_BYTES),
              duration_ms: duration,
              ...(outFile ? { transcriptPath: outFile } : {}),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
