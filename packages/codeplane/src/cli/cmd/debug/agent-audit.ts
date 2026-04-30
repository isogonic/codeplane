import { EOL } from "os"
import path from "path"
import { existsSync } from "fs"
import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises"
import { cmd } from "../cmd"
import PROMPT_AUDIT_TETRIS from "../../../command/template/audit-tetris.txt"

type PackageJson = {
  scripts?: Record<string, string>
}

type RunReport = {
  model: string
  agent?: string
  directory: string
  command: string[]
  exitCode: number | undefined
  timedOut: boolean
  durationMs: number
  metrics: ReturnType<typeof metrics>
  validation: Awaited<ReturnType<typeof validateWorkspace>>
  verification: Awaited<ReturnType<typeof verifyWorkspace>>
  repairs: AgentAttempt[]
  stderrTail?: string
}

type AgentAttempt = {
  kind: "initial" | "repair"
  command: string[]
  exitCode: number | undefined
  timedOut: boolean
  durationMs: number
  metrics: ReturnType<typeof metrics>
  cleanupPids: number[]
  stderrTail?: string
}

type CommandResult = {
  name: string
  command: string[]
  cwd: string
  exitCode: number | undefined
  timedOut: boolean
  durationMs: number
  stdoutTail: string
  stderrTail: string
  skipped?: string
}

type RuntimeResult = {
  command: string[]
  cwd: string
  port: number
  url: string
  healthUrl: string
  scoresUrl: string
  uiStatus?: number
  healthStatus?: number
  scoresStatus?: number
  scorePostStatus?: number
  uiOk: boolean
  healthOk: boolean
  scoresOk: boolean
  scorePostOk: boolean
  uiContentOk: boolean
  uiContentMissing: string[]
  timedOut: boolean
  exitedEarly: boolean
  exitCode: number | undefined
  durationMs: number
  stdoutTail: string
  stderrTail: string
  uiTextTail: string
  scoresTextTail: string
  scorePostTextTail: string
}

type ProbeResult = {
  ok: boolean
  status?: number
  textTail: string
}

type AuditReport = {
  scenario: "tetris"
  startedAt: string
  completedAt: string
  baseDirectory: string
  concurrency: number
  prompt: string
  runs: RunReport[]
  flaws: string[]
  improvements: string[]
}

type JsonEvent = {
  type?: string
  part?: {
    type?: string
    tool?: string
    text?: string
    state?: {
      status?: string
      error?: string
    }
  }
  error?: unknown
}

export const AgentAuditCommand = cmd({
  command: "agent-audit",
  describe: "run local agent audit scenarios",
  builder: (yargs) => yargs.command(TetrisCommand).demandCommand(),
  async handler() {},
})

const TetrisCommand = cmd({
  command: "tetris [instructions..]",
  describe: "run the full-stack Tetris local build audit",
  builder: (yargs) =>
    yargs
      .positional("instructions", {
        type: "string",
        array: true,
        default: [],
        description: "Extra instructions appended to the built-in Tetris audit prompt",
      })
      .option("model", {
        type: "string",
        array: true,
        description: "Model(s) to compare, in provider/model form. Omit to use the configured default model.",
      })
      .option("agent", {
        type: "string",
        description: "Primary agent to run. Omit to use the configured default agent.",
      })
      .option("dir", {
        type: "string",
        description: "Base directory for audit workspaces and reports.",
      })
      .option("timeout-seconds", {
        type: "number",
        default: 900,
        description: "Maximum seconds to allow each model run.",
      })
      .option("verify-timeout-seconds", {
        type: "number",
        default: 120,
        description: "Maximum seconds for deterministic post-run install/typecheck/test/build/start verification.",
      })
      .option("repair-attempts", {
        type: "number",
        default: 1,
        description: "Number of same-model repair passes to run after deterministic verification fails.",
      })
      .option("repair-timeout-seconds", {
        type: "number",
        default: 180,
        description: "Maximum seconds for each repair pass.",
      })
      .option("concurrency", {
        type: "number",
        default: 2,
        description: "Maximum number of model audits to run at the same time.",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        description: "Print the generated prompt and planned run directories without calling a model.",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"] as const,
        default: "text",
        description: "Output format for the audit summary.",
      }),
  async handler(args) {
    const startedAt = new Date().toISOString()
    const baseDirectory = path.resolve(args.dir ?? defaultBaseDirectory(startedAt))
    const models = normalizeModels(args.model)
    const concurrency = normalizeConcurrency(args.concurrency ?? 2, models.length)
    const prompt = promptWithInstructions((args.instructions ?? []).join(" "))

    if (args.dryRun) {
      const output = {
        scenario: "tetris",
        baseDirectory,
        models,
        concurrency,
        agent: args.agent,
        prompt,
      }
      process.stdout.write(args.format === "json" ? JSON.stringify(output, null, 2) + EOL : dryRunText(output) + EOL)
      return
    }

    await mkdir(baseDirectory, { recursive: true })
    const runs = await mapLimit(models, concurrency, (model, index) =>
      runModel({
        model,
        index,
        agent: args.agent,
        baseDirectory,
        prompt,
        timeoutSeconds: args.timeoutSeconds ?? 900,
        verifyTimeoutSeconds: args.verifyTimeoutSeconds ?? 120,
        repairAttempts: args.repairAttempts ?? 1,
        repairTimeoutSeconds: args.repairTimeoutSeconds ?? 180,
      }),
    )

    const report: AuditReport = {
      scenario: "tetris",
      startedAt,
      completedAt: new Date().toISOString(),
      baseDirectory,
      concurrency,
      prompt,
      runs,
      ...findings(runs),
    }

    await writeFile(path.join(baseDirectory, "audit-report.json"), JSON.stringify(report, null, 2) + EOL)
    await writeFile(path.join(baseDirectory, "audit-report.md"), markdown(report) + EOL)
    process.stdout.write(args.format === "json" ? JSON.stringify(report, null, 2) + EOL : summary(report) + EOL)
  },
})

function normalizeModels(input: string[] | string | undefined) {
  const values = (Array.isArray(input) ? input : input ? [input] : [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return values.length ? values : ["default"]
}

function normalizeConcurrency(input: number, count: number) {
  return Math.max(1, Math.min(Math.floor(input || 1), Math.max(1, count)))
}

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>) {
  const pending = items.map((item, index) => ({ item, index }))
  const results = new Array<R>(items.length)
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
      while (true) {
        const next = pending.shift()
        if (!next) return
        results[next.index] = await fn(next.item, next.index)
      }
    }),
  )
  return results
}

function defaultBaseDirectory(startedAt: string) {
  return path.join(
    gitRoot(process.cwd()) ?? process.cwd(),
    "tmp",
    "codeplane-agent-audits",
    `tetris-${startedAt.replace(/[:.]/g, "-")}`,
  )
}

function gitRoot(cwd: string): string | undefined {
  const parent = path.dirname(cwd)
  if (existsSync(path.join(cwd, ".git"))) return cwd
  if (parent === cwd) return undefined
  return gitRoot(parent)
}

function promptWithInstructions(instructions: string) {
  const extra = instructions.trim() || "No extra instructions. Run the standard audit exactly."
  return PROMPT_AUDIT_TETRIS.replace(/\$ARGUMENTS/g, extra)
}

function dryRunText(input: {
  baseDirectory: string
  models: string[]
  concurrency: number
  agent?: string
  prompt: string
}) {
  return [
    "Tetris agent audit dry run",
    `baseDirectory: ${input.baseDirectory}`,
    `models: ${input.models.join(", ")}`,
    `concurrency: ${input.concurrency}`,
    `agent: ${input.agent ?? "default"}`,
    "",
    input.prompt,
  ].join(EOL)
}

async function runModel(input: {
  model: string
  index: number
  agent?: string
  baseDirectory: string
  prompt: string
  timeoutSeconds: number
  verifyTimeoutSeconds: number
  repairAttempts: number
  repairTimeoutSeconds: number
}): Promise<RunReport> {
  const started = Date.now()
  const directory = path.join(
    input.baseDirectory,
    `${String(input.index + 1).padStart(2, "0")}-${safeSegment(input.model)}`,
  )
  await mkdir(directory, { recursive: true })

  const initial = await runAgent({
    kind: "initial",
    directory,
    model: input.model,
    agent: input.agent,
    title: `Tetris audit (${input.model})`,
    prompt: input.prompt,
    timeoutSeconds: input.timeoutSeconds,
  })
  initial.cleanupPids = await cleanupWorkspaceProcesses(directory)

  let validation = await validateWorkspace(directory)
  let verification = await verifyWorkspace(directory, validation, input.verifyTimeoutSeconds)
  const repairs: AgentAttempt[] = []

  for (const attempt of Array.from({ length: Math.max(0, input.repairAttempts) }, (_, index) => index + 1)) {
    if (verification.passed) break
    const repair = await runAgent({
      kind: "repair",
      directory,
      model: input.model,
      agent: input.agent,
      title: `Tetris audit repair ${attempt} (${input.model})`,
      prompt: repairPrompt({
        model: input.model,
        directory,
        validation,
        verification,
      }),
      timeoutSeconds: input.repairTimeoutSeconds,
    })
    repair.cleanupPids = await cleanupWorkspaceProcesses(directory)
    repairs.push(repair)
    validation = await validateWorkspace(directory)
    verification = await verifyWorkspace(directory, validation, input.verifyTimeoutSeconds)
    repair.cleanupPids.push(...(await cleanupWorkspaceProcesses(directory)))
  }
  const finalCleanupPids = await cleanupWorkspaceProcesses(directory)
  if (finalCleanupPids.length) (repairs.at(-1) ?? initial).cleanupPids.push(...finalCleanupPids)

  return {
    model: input.model,
    agent: input.agent,
    directory,
    command: initial.command,
    exitCode: initial.exitCode,
    timedOut: initial.timedOut,
    durationMs: Date.now() - started,
    metrics: initial.metrics,
    validation,
    verification,
    repairs,
    ...(initial.stderrTail && { stderrTail: initial.stderrTail }),
  }
}

async function runAgent(input: {
  kind: AgentAttempt["kind"]
  directory: string
  model: string
  agent?: string
  title: string
  prompt: string
  timeoutSeconds: number
}): Promise<AgentAttempt> {
  const started = Date.now()
  const command = [
    process.execPath,
    process.argv[1]!,
    "run",
    "--dir",
    input.directory,
    "--format",
    "json",
    "--dangerously-skip-permissions",
    "--title",
    input.title,
    ...(input.agent ? ["--agent", input.agent] : []),
    ...(input.model === "default" ? [] : ["--model", input.model]),
  ]

  let timedOut = false
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  auditDebug(`${input.kind} started pid=${proc.pid} directory=${input.directory}`)

  proc.stdin.write(input.prompt)
  proc.stdin.end()

  const timeout = setTimeout(
    () => {
      timedOut = true
      auditDebug(`${input.kind} timeout pid=${proc.pid}`)
      terminate(proc.pid, "SIGTERM")
    },
    Math.max(1, input.timeoutSeconds) * 1000,
  )
  const force = setTimeout(
    () => {
      if (timedOut) auditDebug(`${input.kind} force kill pid=${proc.pid}`)
      if (timedOut) terminate(proc.pid, "SIGKILL")
    },
    Math.max(1, input.timeoutSeconds) * 1000 + 5_000,
  )

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited.catch(() => undefined),
  ]).finally(() => {
    clearTimeout(timeout)
    clearTimeout(force)
  })

  return {
    kind: input.kind,
    command,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    metrics: metrics(parseEvents(stdout)),
    cleanupPids: [],
    ...(stderr.trim() && { stderrTail: tail(stderr.trim(), 12_000) }),
  }
}

async function cleanupWorkspaceProcesses(directory: string) {
  const pids = new Set<number>()
  const ps = await processOutput(["ps", "-axo", "pid=,command="], 3_000)
  for (const line of ps.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const command = match[2] ?? ""
    if (pid === process.pid || !command.includes(directory)) continue
    pids.add(pid)
  }

  const lsof = await processOutput(["lsof", "-t", "+D", directory], 3_000)
  for (const line of lsof.split(/\r?\n/)) {
    const pid = Number(line.trim())
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
  }

  if (pids.size === 0) return []
  auditDebug(`cleanup directory=${directory} pids=${[...pids].join(",")}`)
  for (const pid of pids) {
    terminate(pid, "SIGTERM")
  }
  await sleep(500)
  for (const pid of pids) {
    if (!pidAlive(pid)) continue
    terminate(pid, "SIGKILL")
  }
  return [...pids].toSorted((a, b) => a - b)
}

async function processOutput(command: string[], timeoutMs: number) {
  const proc = await Promise.resolve()
    .then(() =>
      Bun.spawn(command, {
        stdout: "pipe",
        stderr: "ignore",
      }),
    )
    .catch(() => undefined)
  if (!proc) return ""
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    terminate(proc.pid, "SIGTERM")
  }, timeoutMs)
  const force = setTimeout(() => {
    if (timedOut) terminate(proc.pid, "SIGKILL")
  }, timeoutMs + 1_000)
  const output = await new Response(proc.stdout).text().catch(() => "")
  clearTimeout(timeout)
  clearTimeout(force)
  await proc.exited.catch(() => undefined)
  return output
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function parseEvents(stdout: string): JsonEvent[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonEvent]
      } catch {
        return []
      }
    })
}

function repairPrompt(input: {
  model: string
  directory: string
  validation: Awaited<ReturnType<typeof validateWorkspace>>
  verification: Awaited<ReturnType<typeof verifyWorkspace>>
}) {
  return [
    "Repair the existing local Tetris app in this workspace. Do not start over in a new directory.",
    "",
    `Model under audit: ${input.model}`,
    `Workspace: ${input.directory}`,
    "",
    "Goal: make deterministic verification pass:",
    "- `bun install --ignore-scripts` succeeds",
    "- `bun run typecheck` succeeds when a typecheck script exists",
    "- `bun run test` succeeds when a test script exists",
    "- `bun run build` succeeds when a build script exists",
    "- local runtime serves `/` with the Tetris UI",
    "- local runtime serves `/api/health` with a 2xx response",
    "- local runtime serves `GET /api/scores` with a 2xx response",
    "- local runtime accepts `POST /api/scores` with JSON score data",
    "- fetched UI/assets contain visible Tetris labels: score, level, next, hold, pause, restart",
    "",
    "Current structural validation:",
    JSON.stringify(input.validation, null, 2),
    "",
    "Current deterministic verification:",
    verificationSummary(input.verification),
    "",
    "Common fixes to apply when relevant:",
    "- If package.json is missing, create one with install/dev/build/test/typecheck scripts.",
    "- If tests import the server, do not start Bun.serve at import time. Export the handler/app logic and only listen when the file is run as the entrypoint.",
    "- If the dev server hardcodes a port, respect `PORT` from the environment.",
    "- If `/api/scores` is missing, add GET and POST handlers backed by local in-memory or file storage.",
    "- If UI content verification fails, ensure the served HTML or JS includes visible labels for score, level, next, hold, pause, and restart.",
    "- Do not add hosted services. Keep everything local.",
    "- After edits, run the configured project commands or equivalent local checks.",
  ].join("\n")
}

function verificationSummary(input: Awaited<ReturnType<typeof verifyWorkspace>>) {
  const commands = input.commands.map((command) =>
    [
      `${command.name}: ${command.skipped ?? `exit=${command.exitCode ?? "unknown"} timeout=${command.timedOut}`}`,
      command.stderrTail ? `stderr:\n${tail(command.stderrTail, 4_000)}` : undefined,
      command.stdoutTail && command.exitCode !== 0 ? `stdout:\n${tail(command.stdoutTail, 4_000)}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  )
  const runtime = input.runtime
    ? [
        `runtime: ui=${input.runtime.uiStatus ?? "missing"} health=${input.runtime.healthStatus ?? "missing"} scores=${input.runtime.scoresStatus ?? "missing"} scorePost=${input.runtime.scorePostStatus ?? "missing"} uiContent=${input.runtime.uiContentOk}${input.runtime.uiContentMissing.length ? ` missing=${input.runtime.uiContentMissing.join(",")}` : ""} url=${input.runtime.url} exit=${input.runtime.exitCode ?? "running"} timeout=${input.runtime.timedOut}`,
        input.runtime.stderrTail ? `runtime stderr:\n${tail(input.runtime.stderrTail, 4_000)}` : undefined,
        input.runtime.stdoutTail ? `runtime stdout:\n${tail(input.runtime.stdoutTail, 4_000)}` : undefined,
      ]
        .filter(Boolean)
        .join("\n")
    : "runtime: skipped"
  return [...commands, runtime, `passed: ${input.passed}`].join("\n\n")
}

function metrics(events: JsonEvent[]) {
  const toolCounts: Record<string, number> = {}
  const toolErrors: Record<string, number> = {}
  const errors: string[] = []
  let textParts = 0
  let textChars = 0
  let steps = 0

  for (const event of events) {
    if (event.type === "step_start") steps++
    if (event.type === "error") errors.push(JSON.stringify(event.error))
    if (event.type === "text") {
      textParts++
      textChars += event.part?.text?.length ?? 0
    }
    if (event.type !== "tool_use" || !event.part?.tool) continue
    toolCounts[event.part.tool] = (toolCounts[event.part.tool] ?? 0) + 1
    if (event.part.state?.status === "error") toolErrors[event.part.tool] = (toolErrors[event.part.tool] ?? 0) + 1
  }

  return { events: events.length, steps, textParts, textChars, toolCounts, toolErrors, errors }
}

async function validateWorkspace(dir: string) {
  const files = await collectFiles(dir)
  const packageJsonRel =
    files.find((file) => file === "package.json") ??
    files
      .filter((file) => path.basename(file) === "package.json")
      .toSorted((a, b) => a.split(path.sep).length - b.split(path.sep).length)[0]
  const appRoot = packageJsonRel ? path.dirname(packageJsonRel) : "."
  const appRootPrefix = appRoot === "." ? "" : appRoot + path.sep
  const appFiles = files
    .filter((file) => !appRootPrefix || file.startsWith(appRootPrefix))
    .map((file) => (appRootPrefix ? path.relative(appRoot, file) : file))
  const packageJsonPath = packageJsonRel ? path.join(dir, packageJsonRel) : path.join(dir, "package.json")
  const packageJson = existsSync(packageJsonPath)
    ? await readFile(packageJsonPath, "utf8")
        .then((text) => JSON.parse(text) as { scripts?: Record<string, string> })
        .catch(() => undefined)
    : undefined
  const snippets = await Promise.all(
    appFiles
      .filter((file) => /\.(css|html|js|jsx|json|md|ts|tsx)$/.test(file))
      .slice(0, 200)
      .map((file) => readFile(path.join(dir, appRootPrefix, file), "utf8").catch(() => "")),
  )
  const text = snippets.join("\n").toLowerCase()

  return {
    appRoot,
    fileCount: files.length,
    packageJson: packageJson !== undefined,
    scripts: {
      install: Boolean(packageJson?.scripts?.install),
      dev: Boolean(packageJson?.scripts?.dev || packageJson?.scripts?.start),
      build: Boolean(packageJson?.scripts?.build),
      test: Boolean(packageJson?.scripts?.test),
      typecheck: Boolean(packageJson?.scripts?.typecheck),
      recursiveInstall: /\bbun\s+install\b/.test(packageJson?.scripts?.install ?? ""),
    },
    frontend: appFiles.some(
      (file) => file === "index.html" || file === "public/index.html" || /^src\/(main|app|game)\./.test(file),
    ),
    backend: /bun\.serve|new hono|from ["']hono["']|\/api\/health|\/api\/scores/.test(text),
    tetrisLogic: /tetromino|tetris|line clear|lineclear|rotate|collision|next piece|hold piece/.test(text),
    tests: files.some((file) => /\.(test|spec)\.[jt]sx?$/.test(file)) || Boolean(packageJson?.scripts?.test),
  }
}

async function verifyWorkspace(
  dir: string,
  validation: Awaited<ReturnType<typeof validateWorkspace>>,
  timeoutSeconds: number,
) {
  const appDirectory = path.join(dir, validation.appRoot)
  if (!validation.packageJson) {
    const runtime = existsSync(path.join(appDirectory, "src/server.ts"))
      ? await runRuntime(appDirectory, ["bun", "src/server.ts"], Math.max(10_000, timeoutSeconds * 1000))
      : undefined
    return {
      appDirectory,
      commands: [] as CommandResult[],
      runtime,
      passed: false,
      skipped: "No package.json was detected.",
    }
  }

  const packageJson: PackageJson = await readFile(path.join(appDirectory, "package.json"), "utf8")
    .then((text) => JSON.parse(text) as PackageJson)
    .catch(() => ({ scripts: {} }))
  const budgetMs = Math.max(10_000, timeoutSeconds * 1000)
  const install = await runCommand(
    appDirectory,
    "install",
    ["bun", "install", "--ignore-scripts"],
    Math.min(budgetMs, 120_000),
  )
  const checks = await Promise.all([
    packageJson.scripts?.typecheck
      ? runCommand(appDirectory, "typecheck", ["bun", "run", "typecheck"], budgetMs)
      : Promise.resolve(skippedCommand(appDirectory, "typecheck", "No typecheck script.")),
    packageJson.scripts?.test
      ? runCommand(appDirectory, "test", ["bun", "run", "test"], budgetMs)
      : Promise.resolve(skippedCommand(appDirectory, "test", "No test script.")),
    packageJson.scripts?.build
      ? runCommand(appDirectory, "build", ["bun", "run", "build"], budgetMs)
      : Promise.resolve(skippedCommand(appDirectory, "build", "No build script.")),
  ])
  const commands = [install, ...checks]
  const runtime =
    packageJson.scripts?.dev || packageJson.scripts?.start
      ? await runRuntime(
          appDirectory,
          ["bun", "run", packageJson.scripts.dev ? "dev" : "start"],
          Math.min(budgetMs, 120_000),
        )
      : undefined

  return {
    appDirectory,
    commands,
    runtime,
    passed:
      commands.filter((item) => !item.skipped).every((item) => item.exitCode === 0 && !item.timedOut) &&
      Boolean(runtime?.uiOk) &&
      Boolean(runtime?.healthOk) &&
      Boolean(runtime?.scoresOk) &&
      Boolean(runtime?.scorePostOk) &&
      Boolean(runtime?.uiContentOk),
  }
}

function skippedCommand(cwd: string, name: string, skipped: string): CommandResult {
  return {
    name,
    cwd,
    command: [],
    exitCode: undefined,
    timedOut: false,
    durationMs: 0,
    stdoutTail: "",
    stderrTail: "",
    skipped,
  }
}

async function runCommand(cwd: string, name: string, command: string[], timeoutMs: number): Promise<CommandResult> {
  const started = Date.now()
  let timedOut = false
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, CI: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => {
    timedOut = true
    terminate(proc.pid, "SIGTERM")
  }, timeoutMs)
  const force = setTimeout(() => {
    if (timedOut) terminate(proc.pid, "SIGKILL")
  }, timeoutMs + 5_000)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited.catch(() => undefined),
  ]).finally(() => {
    clearTimeout(timeout)
    clearTimeout(force)
  })
  return {
    name,
    command,
    cwd,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdoutTail: tail(stdout.trim(), 12_000),
    stderrTail: tail(stderr.trim(), 12_000),
  }
}

async function runRuntime(cwd: string, command: string[], timeoutMs: number): Promise<RuntimeResult> {
  const started = Date.now()
  const port = 47_000 + Math.floor(Math.random() * 1_000)
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, CI: "1", HOST: "127.0.0.1", PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(proc.stdout).text()
  const stderr = new Response(proc.stderr).text()
  let exitCode: number | undefined
  const exited = proc.exited.then((code) => {
    exitCode = code
    return code
  })
  const urls = [port, 3000, 5173, 8080, 8000].map((item) => `http://127.0.0.1:${item}`)
  let foundUrl = urls[0]!
  let uiStatus: number | undefined
  let healthStatus: number | undefined
  let scoresStatus: number | undefined
  let scorePostStatus: number | undefined
  let uiOk = false
  let healthOk = false
  let scoresOk = false
  let scorePostOk = false
  let uiContentOk = false
  let uiContentMissing: string[] = []
  let uiTextTail = ""
  let scoresTextTail = ""
  let scorePostTextTail = ""

  while (Date.now() - started < timeoutMs && exitCode === undefined) {
    for (const url of urls) {
      const [ui, health, scores, scorePost, app] = await Promise.all([
        probe(url),
        probe(`${url}/api/health`),
        probe(`${url}/api/scores`),
        probe(`${url}/api/scores`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "audit", score: 1234, lines: 4, level: 2 }),
        }),
        firstProbe([`${url}/app.js`, `${url}/public/app.js`, `${url}/dist/public/app.js`]),
      ])
      if (ui.status) {
        foundUrl = url
        uiStatus = ui.status
        uiOk = ui.ok
        uiTextTail = ui.textTail
      }
      if (health.status) {
        foundUrl = url
        healthStatus = health.status
        healthOk = health.ok
      }
      if (scores.status) {
        foundUrl = url
        scoresStatus = scores.status
        scoresOk = scores.ok
        scoresTextTail = scores.textTail
      }
      if (scorePost.status) {
        foundUrl = url
        scorePostStatus = scorePost.status
        scorePostOk = scorePost.ok
        scorePostTextTail = scorePost.textTail
      }
      const uiContent = checkUiContent([ui.textTail, app.textTail].join("\n"))
      uiContentOk = uiContent.ok
      uiContentMissing = uiContent.missing
      if (uiOk && healthOk && scoresOk && scorePostOk && uiContentOk) break
    }
    if (uiOk && healthOk && scoresOk && scorePostOk && uiContentOk) break
    await sleep(500)
  }

  const timedOut = Date.now() - started >= timeoutMs && exitCode === undefined
  let force: ReturnType<typeof setTimeout> | undefined
  if (exitCode === undefined) {
    terminate(proc.pid, "SIGTERM")
    force = setTimeout(() => {
      if (exitCode === undefined) terminate(proc.pid, "SIGKILL")
    }, 5_000)
  }
  const [stdoutText, stderrText] = await Promise.all([stdout, stderr, exited.catch(() => undefined)])
  if (force) clearTimeout(force)

  return {
    command,
    cwd,
    port,
    url: foundUrl,
    healthUrl: `${foundUrl}/api/health`,
    scoresUrl: `${foundUrl}/api/scores`,
    uiStatus,
    healthStatus,
    scoresStatus,
    scorePostStatus,
    uiOk,
    healthOk,
    scoresOk,
    scorePostOk,
    uiContentOk,
    uiContentMissing,
    timedOut,
    exitedEarly: exitCode !== undefined,
    exitCode,
    durationMs: Date.now() - started,
    stdoutTail: tail(stdoutText.trim(), 12_000),
    stderrTail: tail(stderrText.trim(), 12_000),
    uiTextTail,
    scoresTextTail,
    scorePostTextTail,
  }
}

async function firstProbe(urls: string[]) {
  for (const url of urls) {
    const result = await probe(url)
    if (result.ok) return result
  }
  return { ok: false, textTail: "" } satisfies ProbeResult
}

function checkUiContent(input: string) {
  const lower = input.toLowerCase()
  const missing = ["tetris", "score", "level", "next", "hold", "pause", "restart"].filter(
    (item) => !lower.includes(item),
  )
  return { ok: missing.length === 0, missing }
}

async function probe(url: string, init?: RequestInit): Promise<ProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_000)
  return fetch(url, { ...init, signal: controller.signal })
    .then(async (response) => ({
      ok: response.ok,
      status: response.status,
      textTail: tail(await response.text().catch(() => ""), 8_000),
    }))
    .catch(() => ({ ok: false, status: undefined, textTail: "" }))
    .finally(() => clearTimeout(timeout))
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function terminate(pid: number, signal: "SIGTERM" | "SIGKILL") {
  if (pid <= 0 || pid === process.pid) return
  try {
    process.kill(pid, signal)
  } catch {}
}

function auditDebug(message: string) {
  if (!process.env.CODEPLANE_AGENT_AUDIT_DEBUG) return
  process.stderr.write(`[agent-audit] ${message}${EOL}`)
}

async function collectFiles(dir: string, prefix = "", acc: string[] = []): Promise<string[]> {
  if (acc.length > 1_000) return acc
  const entries = await readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (["node_modules", ".git", ".codeplane", "dist", "build", ".turbo"].includes(entry.name)) continue
    const rel = path.join(prefix, entry.name)
    if (entry.isDirectory()) {
      await collectFiles(dir, rel, acc)
      continue
    }
    const info = await stat(path.join(dir, rel)).catch(() => undefined)
    if (info?.isFile()) acc.push(rel)
  }
  return acc
}

function findings(runs: RunReport[]) {
  const flaws = runs.flatMap((run) => {
    const items: string[] = []
    if (run.timedOut) items.push(`${run.model}: run timed out before reaching idle.`)
    if (run.exitCode && run.exitCode !== 0) items.push(`${run.model}: codeplane run exited with ${run.exitCode}.`)
    for (const [index, repair] of run.repairs.entries()) {
      if (repair.timedOut) items.push(`${run.model}: repair attempt ${index + 1} timed out before reaching idle.`)
      if (repair.exitCode && repair.exitCode !== 0) {
        items.push(`${run.model}: repair attempt ${index + 1} exited with ${repair.exitCode}.`)
      }
    }
    if (run.metrics.errors.length) items.push(`${run.model}: emitted ${run.metrics.errors.length} session error(s).`)
    if (!run.validation.packageJson) items.push(`${run.model}: no package.json was produced.`)
    if (!run.validation.frontend) items.push(`${run.model}: frontend entry point was not detected.`)
    if (!run.validation.backend) items.push(`${run.model}: backend/API implementation was not detected.`)
    if (!run.validation.tetrisLogic) items.push(`${run.model}: Tetris gameplay logic was not detected.`)
    if (run.validation.appRoot !== ".") {
      items.push(
        `${run.model}: app was created under ${run.validation.appRoot}; clean audit workspaces should be used directly.`,
      )
    }
    if (!run.validation.scripts.dev) items.push(`${run.model}: no dev/start script was detected.`)
    if (!run.validation.scripts.build) items.push(`${run.model}: no build script was detected.`)
    if (!run.validation.scripts.test) items.push(`${run.model}: no test script was detected.`)
    if (run.validation.scripts.recursiveInstall) {
      items.push(
        `${run.model}: package install script calls bun install and can recursively trigger lifecycle installs.`,
      )
    }
    for (const command of run.verification.commands) {
      if (command.skipped) continue
      if (command.timedOut) items.push(`${run.model}: deterministic ${command.name} verification timed out.`)
      if (command.exitCode && command.exitCode !== 0) {
        items.push(`${run.model}: deterministic ${command.name} verification failed with exit ${command.exitCode}.`)
      }
    }
    if (!run.verification.runtime) items.push(`${run.model}: no dev/start runtime verification was possible.`)
    if (run.verification.runtime && !run.verification.runtime.uiOk) {
      items.push(`${run.model}: local UI probe failed at ${run.verification.runtime.url}.`)
    }
    if (run.verification.runtime && !run.verification.runtime.healthOk) {
      items.push(`${run.model}: backend health probe failed at ${run.verification.runtime.healthUrl}.`)
    }
    if (run.verification.runtime && !run.verification.runtime.scoresOk) {
      items.push(`${run.model}: scores API GET probe failed at ${run.verification.runtime.scoresUrl}.`)
    }
    if (run.verification.runtime && !run.verification.runtime.scorePostOk) {
      items.push(`${run.model}: scores API POST probe failed at ${run.verification.runtime.scoresUrl}.`)
    }
    if (run.verification.runtime && !run.verification.runtime.uiContentOk) {
      items.push(
        `${run.model}: UI content probe missed labels: ${run.verification.runtime.uiContentMissing.join(", ")}.`,
      )
    }
    return items
  })

  return {
    flaws: flaws.length ? flaws : ["No structural audit flaws detected by the local harness."],
    improvements: [
      "Prefer native project command configuration before running raw shell commands.",
      "Record live-server process ids and localhost URLs in tool metadata so audits can verify cleanup.",
      "Expose a first-class model-comparison report in the app UI instead of requiring CLI report files.",
      "Add browser screenshot and DOM smoke checks as a native verification step when a local URL is discovered.",
      "Persist deterministic verifier failures as structured task context so repair prompts do not depend on free-form report text.",
      "Capture screenshots or rendered DOM, because static HTML/JS keyword checks still cannot prove canvas/game interaction works.",
    ],
  }
}

function markdown(report: AuditReport) {
  return [
    "# Tetris Agent Audit",
    "",
    `Started: ${report.startedAt}`,
    `Completed: ${report.completedAt}`,
    `Base directory: ${report.baseDirectory}`,
    `Concurrency: ${report.concurrency}`,
    "",
    "## Runs",
    "",
    ...report.runs.map((run) =>
      [
        `### ${run.model}`,
        "",
        `Directory: ${run.directory}`,
        `Exit: ${run.exitCode ?? "unknown"}${run.timedOut ? " (timed out)" : ""}`,
        `Duration: ${Math.round(run.durationMs / 1000)}s`,
        `Tools: ${JSON.stringify(run.metrics.toolCounts)}`,
        `Repairs: ${run.repairs.length}`,
        ...run.repairs.map(
          (repair, index) =>
            `- repair ${index + 1}: exit=${repair.exitCode ?? "unknown"} timeout=${repair.timedOut} duration=${Math.round(repair.durationMs / 1000)}s cleanup=${repair.cleanupPids.length ? repair.cleanupPids.join(",") : "none"} tools=${JSON.stringify(repair.metrics.toolCounts)}`,
        ),
        `Validation: ${JSON.stringify(run.validation)}`,
        "",
        "Deterministic verification:",
        "",
        ...run.verification.commands.map(
          (command) =>
            `- ${command.name}: ${command.skipped ?? `exit=${command.exitCode ?? "unknown"} timeout=${command.timedOut} duration=${Math.round(command.durationMs / 1000)}s`}`,
        ),
        run.verification.runtime
          ? `- runtime: ui=${run.verification.runtime.uiStatus ?? "missing"} health=${run.verification.runtime.healthStatus ?? "missing"} scores=${run.verification.runtime.scoresStatus ?? "missing"} scorePost=${run.verification.runtime.scorePostStatus ?? "missing"} uiContent=${run.verification.runtime.uiContentOk}${run.verification.runtime.uiContentMissing.length ? ` missing=${run.verification.runtime.uiContentMissing.join(",")}` : ""} url=${run.verification.runtime.url} exit=${run.verification.runtime.exitCode ?? "running"}`
          : "- runtime: skipped",
        ...run.verification.commands.flatMap((command) =>
          command.skipped || (command.exitCode === 0 && !command.timedOut)
            ? []
            : [
                "",
                `${command.name} stderr tail:`,
                "```",
                command.stderrTail || "(empty)",
                "```",
                command.stdoutTail
                  ? [`${command.name} stdout tail:`, "```", command.stdoutTail, "```"].join(EOL)
                  : undefined,
              ].filter(Boolean),
        ),
        ...(run.verification.runtime && (!run.verification.runtime.uiOk || !run.verification.runtime.healthOk)
          ? [
              "",
              "runtime stderr tail:",
              "```",
              run.verification.runtime.stderrTail || "(empty)",
              "```",
              "runtime stdout tail:",
              "```",
              run.verification.runtime.stdoutTail || "(empty)",
              "```",
            ]
          : []),
        ...(run.verification.runtime &&
        (!run.verification.runtime.scoresOk ||
          !run.verification.runtime.scorePostOk ||
          !run.verification.runtime.uiContentOk)
          ? [
              "",
              "runtime probe tails:",
              "```",
              [
                `ui: ${run.verification.runtime.uiTextTail || "(empty)"}`,
                `scores GET: ${run.verification.runtime.scoresTextTail || "(empty)"}`,
                `scores POST: ${run.verification.runtime.scorePostTextTail || "(empty)"}`,
              ].join("\n\n"),
              "```",
            ]
          : []),
        run.stderrTail ? `Stderr tail:\n\n\`\`\`\n${run.stderrTail}\n\`\`\`` : undefined,
      ]
        .filter(Boolean)
        .join(EOL),
    ),
    "",
    "## Flaws",
    "",
    ...report.flaws.map((item) => `- ${item}`),
    "",
    "## Improvements",
    "",
    ...report.improvements.map((item) => `- ${item}`),
  ].join(EOL)
}

function summary(report: AuditReport) {
  return [
    "Tetris agent audit complete",
    `report: ${path.join(report.baseDirectory, "audit-report.md")}`,
    `json: ${path.join(report.baseDirectory, "audit-report.json")}`,
    `concurrency: ${report.concurrency}`,
    "",
    ...report.runs.map(
      (run) =>
        `${run.model}: exit=${run.exitCode ?? "unknown"} timeout=${run.timedOut} repairs=${run.repairs.length} verified=${run.verification.passed} files=${run.validation.fileCount} tools=${JSON.stringify(run.metrics.toolCounts)}`,
    ),
    "",
    "Flaws:",
    ...report.flaws.map((item) => `- ${item}`),
  ].join(EOL)
}

function safeSegment(input: string) {
  return (input === "default" ? "default" : input).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "default"
}

function tail(input: string, max: number) {
  if (input.length <= max) return input
  return input.slice(-max)
}
