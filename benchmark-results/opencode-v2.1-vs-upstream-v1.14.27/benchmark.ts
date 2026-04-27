#!/usr/bin/env bun

import { mkdir, cp, rm } from "fs/promises"
import path from "path"

type Candidate = {
  id: string
  label: string
  version: string
  repo: string
  opencode: string
  commit: string
  installNote?: string
}

type Result = {
  candidate: string
  benchmark: string
  model?: string
  iteration: number
  ok: boolean
  exitCode: number | null
  wallMs: number
  stdoutBytes: number
  stderrBytes: number
  timedOut: boolean
  stdoutTail: string
  stderrTail: string
}

const root = path.resolve(import.meta.dir, "../..")
const outDir = import.meta.dir
const tempRoot = "/tmp/opencode-bench-work"
const authSource = path.join(process.env.HOME ?? "", ".local/share/opencode/auth.json")
const upstream = "/tmp/opencode-bench-upstream-v1.14.27"

const candidates: Candidate[] = [
  {
    id: "mine-v2.1.0",
    label: "Meine v2.1.0",
    version: "v2.1.0",
    repo: root,
    opencode: path.join(root, "packages/opencode"),
    commit: "95f28931752b6beadb527f6da467d26f85a6cf91",
  },
  {
    id: "upstream-v1.14.27",
    label: "Offiziell v1.14.27",
    version: "v1.14.27",
    repo: upstream,
    opencode: path.join(upstream, "packages/opencode"),
    commit: "373cc2a5e13ba7b8cc40ff3306c7db023fab370c",
    installNote: "Source checkout installed with bun install --ignore-scripts because tree-sitter-powershell failed under local Node 25.",
  },
]

const models = (process.env.BENCH_MODELS ?? "openai/gpt-5.4-mini-fast,github-copilot/gpt-5.4-mini")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)

const cliIterations = Number(process.env.BENCH_CLI_REPS ?? 8)
const modelIterations = Number(process.env.BENCH_LLM_REPS ?? 1)

function sanitize(value: string) {
  return value
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replaceAll(/sk-[A-Za-z0-9_-]+/g, "sk-[redacted]")
    .replaceAll(/"apiKey"\s*:\s*"[^"]+"/g, '"apiKey":"[redacted]"')
    .replaceAll(/"access"\s*:\s*"[^"]+"/g, '"access":"[redacted]"')
    .replaceAll(/"refresh"\s*:\s*"[^"]+"/g, '"refresh":"[redacted]"')
}

function tail(value: string) {
  return sanitize(value.slice(-3000))
}

async function prepareProfile(candidate: Candidate, benchmark: string, iteration: number) {
  const base = path.join(tempRoot, candidate.id, `${benchmark}-${iteration}`)
  const home = path.join(base, "home")
  const data = path.join(base, "share")
  const cache = path.join(base, "cache")
  const config = path.join(base, "config")
  const state = path.join(base, "state")
  await mkdir(path.join(home, ".local/share/opencode"), { recursive: true })
  await mkdir(path.join(data, "opencode"), { recursive: true })
  await mkdir(cache, { recursive: true })
  await mkdir(config, { recursive: true })
  await mkdir(state, { recursive: true })
  await cp(authSource, path.join(home, ".local/share/opencode", "auth.json")).catch(() => {})
  await cp(authSource, path.join(data, "opencode", "auth.json")).catch(() => {})
  return {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_STATE_HOME: state,
  }
}

async function prepareFixture(candidate: Candidate, iteration: number) {
  const dir = path.join(tempRoot, candidate.id, `fixture-${iteration}`)
  await rm(dir, { recursive: true, force: true })
  await mkdir(path.join(dir, "src"), { recursive: true })
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          test: "bun test",
        },
        devDependencies: {
          "@types/bun": "latest",
        },
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(dir, "src/calc.ts"),
    [
      "export function weightedChecksum(input: string) {",
      "  return input.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)",
      "}",
      "",
      "export function benchmarkAnswer() {",
      "  return weightedChecksum('opencode-v2.1')",
      "}",
      "",
    ].join("\n"),
  )
  await Bun.write(
    path.join(dir, "src/calc.test.ts"),
    [
      "import { expect, test } from 'bun:test'",
      "import { benchmarkAnswer, weightedChecksum } from './calc'",
      "",
      "test('weighted checksum stays deterministic', () => {",
      "  expect(weightedChecksum('abc')).toBe(590)",
      "  expect(benchmarkAnswer()).toBe(7071)",
      "})",
      "",
    ].join("\n"),
  )
  await Bun.write(
    path.join(dir, "README.md"),
    [
      "# opencode benchmark fixture",
      "",
      "Task target: inspect `src/calc.ts`, optionally run `bun test`, and report whether tests pass plus the value of `benchmarkAnswer()`.",
      "",
    ].join("\n"),
  )
  return dir
}

async function runCommand(
  candidate: Candidate,
  benchmark: string,
  iteration: number,
  args: string[],
  extra?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): Promise<Result> {
  const profile = await prepareProfile(candidate, benchmark.replaceAll(/[^a-z0-9._-]/gi, "_"), iteration)
  const started = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), extra?.timeoutMs ?? 240_000)
  const proc = Bun.spawn(["bun", "--conditions=browser", "src/index.ts", ...args], {
    cwd: candidate.opencode,
    env: {
      ...process.env,
      ...profile,
      ...extra?.env,
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_DISABLE_PRUNE: "true",
      OPENCODE_CLIENT: "benchmark",
    },
    stdout: "pipe",
    stderr: "pipe",
    signal: controller.signal,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited.catch(() => null),
  ])
  clearTimeout(timeout)
  const wallMs = performance.now() - started
  const timedOut = controller.signal.aborted

  return {
    candidate: candidate.id,
    benchmark,
    iteration,
    ok: exitCode === 0 && !timedOut,
    exitCode,
    wallMs,
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    timedOut,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function aggregate(results: Result[]) {
  const keys = [...new Set(results.map((item) => `${item.benchmark}\0${item.model ?? ""}\0${item.candidate}`))]
  return keys.map((key) => {
    const [benchmark, model, candidate] = key.split("\0")
    const rows = results.filter((item) => item.benchmark === benchmark && (item.model ?? "") === model && item.candidate === candidate)
    const times = rows.map((item) => item.wallMs)
    return {
      benchmark,
      model: model || undefined,
      candidate,
      runs: rows.length,
      ok: rows.filter((item) => item.ok).length,
      medianMs: median(times),
      meanMs: mean(times),
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
    }
  })
}

function csv(rows: ReturnType<typeof aggregate>) {
  const header = "benchmark,model,candidate,runs,ok,median_ms,mean_ms,min_ms,max_ms"
  return [
    header,
    ...rows.map((row) =>
      [
        row.benchmark,
        row.model ?? "",
        row.candidate,
        row.runs,
        row.ok,
        row.medianMs.toFixed(1),
        row.meanMs.toFixed(1),
        row.minMs.toFixed(1),
        row.maxMs.toFixed(1),
      ]
        .map((value) => JSON.stringify(String(value)))
        .join(","),
    ),
  ].join("\n")
}

function makeSvg(rows: ReturnType<typeof aggregate>, results: Result[]) {
  const width = 1400
  const groups = [...new Set(rows.map((row) => row.model ? `${row.benchmark} ${row.model}` : row.benchmark))]
  const max = Math.max(...rows.map((row) => row.medianMs), 1)
  const hasFailures = rows.some((row) => row.ok < row.runs)
  const chartTop = 150
  const chartLeft = 280
  const rowHeight = 54
  const barHeight = 16
  const chartWidth = 930
  const height = chartTop + groups.length * rowHeight + 210
  const color = {
    "mine-v2.1.0": "#2563eb",
    "upstream-v1.14.27": "#f97316",
  } as Record<string, string>
  const label = (candidate: string) => candidates.find((item) => item.id === candidate)?.label ?? candidate
  const bars = groups
    .flatMap((group, groupIndex) => {
      const groupRows = rows.filter((row) => (row.model ? `${row.benchmark} ${row.model}` : row.benchmark) === group)
      return groupRows.map((row, index) => {
        const y = chartTop + groupIndex * rowHeight + index * (barHeight + 6)
        const w = Math.max(2, (row.medianMs / max) * chartWidth)
        const failed = row.ok < row.runs
        return [
          `<text x="${chartLeft - 12}" y="${y + 13}" text-anchor="end" class="candidate">${label(row.candidate)}</text>`,
          `<rect x="${chartLeft}" y="${y}" width="${w.toFixed(1)}" height="${barHeight}" rx="4" fill="${failed ? "#ef4444" : color[row.candidate] ?? "#64748b"}" />`,
          `<text x="${chartLeft + w + 8}" y="${y + 13}" class="value">${(row.medianMs / 1000).toFixed(2)}s (${row.ok}/${row.runs} ok)${failed ? " FAILED" : ""}</text>`,
        ].join("\n")
      })
    })
    .join("\n")

  const labels = groups
    .map((group, index) => {
      const y = chartTop + index * rowHeight + 18
      return `<text x="24" y="${y}" class="group">${group}</text>`
    })
    .join("\n")

  const notes = [
    `Generated: ${new Date().toISOString()}`,
    `Official latest release verified via GitHub: anomalyco/opencode v1.14.27.`,
    `LLM prompt/model runs: ${results.filter((item) => item.benchmark === "llm_fixture_task").length}.`,
    hasFailures ? "Red bars are failed runs and should not be interpreted as successful model latency." : "",
  ].filter(Boolean)

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .bg { fill: #0f172a; }
    .title { fill: #f8fafc; font: 700 30px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .subtitle { fill: #cbd5e1; font: 15px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .group { fill: #e2e8f0; font: 650 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .candidate { fill: #cbd5e1; font: 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .value { fill: #e2e8f0; font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .axis { stroke: #334155; stroke-width: 1; }
    .note { fill: #94a3b8; font: 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .legend { fill: #e2e8f0; font: 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  </style>
  <rect class="bg" width="100%" height="100%" />
  <text x="24" y="46" class="title">opencode Benchmark: v2.1.0 vs offizielles v1.14.27</text>
  <text x="24" y="76" class="subtitle">Median wall-clock time, lower is better. Failed rows are red and are not successful latency measurements.</text>
  <rect x="24" y="104" width="16" height="16" rx="4" fill="#2563eb" />
  <text x="48" y="117" class="legend">Meine v2.1.0</text>
  <rect x="180" y="104" width="16" height="16" rx="4" fill="#f97316" />
  <text x="204" y="117" class="legend">Offiziell v1.14.27</text>
  <rect x="360" y="104" width="16" height="16" rx="4" fill="#ef4444" />
  <text x="384" y="117" class="legend">Fehlgeschlagen</text>
  <line x1="${chartLeft}" y1="${chartTop - 18}" x2="${chartLeft}" y2="${chartTop + groups.length * rowHeight - 14}" class="axis" />
  ${labels}
  ${bars}
  ${notes.map((note, index) => `<text x="24" y="${height - 78 + index * 22}" class="note">${note}</text>`).join("\n")}
</svg>
`
}

const results: Result[] = []
await rm(tempRoot, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

for (const candidate of candidates) {
  for (let i = 0; i < cliIterations; i++) {
    results.push(await runCommand(candidate, "cli_version", i, ["--version"], { timeoutMs: 60_000 }))
    results.push(await runCommand(candidate, "run_help", i, ["run", "--help"], { timeoutMs: 60_000 }))
  }

  for (let i = 0; i < 3; i++) {
    results.push(await runCommand(candidate, "models_openai", i, ["models", "openai"], { timeoutMs: 90_000 }))
  }

  for (const model of models) {
    for (let i = 0; i < modelIterations; i++) {
      const fixture = await prepareFixture(candidate, i)
      const result = await runCommand(
        candidate,
        "llm_fixture_task",
        i,
        [
          "run",
          "--format",
          "json",
          "--model",
          model,
          "--dir",
          fixture,
          "--title",
          `benchmark-${candidate.id}-${model.replaceAll("/", "-")}-${i}`,
          "--dangerously-skip-permissions",
          "Inspect the repository files, run tests if useful, do not modify files, and return only compact JSON with keys status, answer, evidence. Report whether tests pass and the numeric value returned by benchmarkAnswer().",
        ],
        { timeoutMs: 240_000 },
      )
      result.model = model
      results.push(result)
    }
  }
}

const summary = aggregate(results)
await Bun.write(path.join(outDir, "results.json"), JSON.stringify({ candidates, models, cliIterations, modelIterations, results, summary }, null, 2))
await Bun.write(path.join(outDir, "summary.csv"), csv(summary))
await Bun.write(path.join(outDir, "benchmark-chart.svg"), makeSvg(summary, results))
await Bun.write(
  path.join(outDir, "README.md"),
  [
    "# opencode benchmark v2.1.0 vs upstream v1.14.27",
    "",
    "This directory was generated by `benchmark.ts`.",
    "",
    "## Method",
    "",
    "- Compared local fork release `v2.1.0` at `95f28931752b6beadb527f6da467d26f85a6cf91` against official GitHub latest `anomalyco/opencode v1.14.27`.",
    "- Ran source-mode CLIs with `bun --conditions=browser src/index.ts` for both candidates.",
    "- Used isolated `HOME` and `XDG_*` directories per run and copied only local opencode auth into temporary profiles.",
    "- Disabled autoupdate, default plugins, LSP downloads, and pruning for benchmark stability.",
    "- LLM fixture task used the same prompt and fixture repository for each model/candidate pair.",
    "- Failed rows are kept in the raw data, but should not be read as successful latency measurements.",
    "",
    "## Files",
    "",
    "- `results.json`: raw timings and sanitized output tails.",
    "- `summary.csv`: aggregate medians/means/min/max.",
    "- `benchmark-chart.svg`: visual summary.",
    "",
  ].join("\n"),
)

console.log(`wrote ${outDir}`)
