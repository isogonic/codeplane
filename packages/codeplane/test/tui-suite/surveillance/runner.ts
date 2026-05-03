import type { JSX } from "@opentui/solid"
import { mount, type TuiHarness } from "../harness/harness"
import { trimFrame } from "../harness/snapshot"

/** A single scripted action against a harness. */
export type SurveillanceStep =
  | { kind: "press"; chord: string }
  | { kind: "type"; text: string }
  | { kind: "paste"; text: string }
  | { kind: "wait"; ms: number }
  | { kind: "resize"; width: number; height: number }
  | { kind: "expect"; text: string | RegExp }
  | { kind: "snapshot"; label: string }
  | { kind: "settle" }

export interface SurveillanceScript {
  /** Human-readable script name. */
  name: string
  /** Ordered steps, OR a function returning fresh steps each iteration. */
  steps: SurveillanceStep[] | ((iteration: number) => SurveillanceStep[])
}

export interface SurveillanceOptions {
  /** Total iterations of the script to run. Default 100. */
  iterations?: number
  /** Per-iteration timeout, ms. Default 5000. */
  iterationTimeoutMs?: number
  /** Tick interval (between iterations), ms. Default 0. */
  tickMs?: number
  /** Initial terminal width. Default 100. */
  width?: number
  /** Initial terminal height. Default 30. */
  height?: number
  /** Capture a frame snapshot every N iterations. Default 0 (disabled). */
  snapshotEvery?: number
  /** Hook called after each iteration completes. */
  onTick?: (info: TickInfo) => void
  /** Hook called once before the first iteration. */
  onStart?: (h: TuiHarness) => void | Promise<void>
}

export interface TickInfo {
  iteration: number
  durationMs: number
  /** Trimmed text frame after the iteration. */
  frameText: string
  /** Memory delta in bytes versus iteration 0. */
  memDelta: number
  /** Heap-used at this iteration. */
  heapUsed: number
}

export interface SurveillanceReport {
  script: string
  iterations: number
  totalMs: number
  ok: boolean
  failures: SurveillanceFailure[]
  metrics: {
    frameCount: number
    avgIterationMs: number
    minIterationMs: number
    maxIterationMs: number
    p95IterationMs: number
    distinctFrames: number
    blankFrames: number
    memStartHeap: number
    memEndHeap: number
    memPeakHeap: number
  }
  /** Captured snapshots in order, when snapshotEvery > 0. */
  snapshots: { iteration: number; label: string; text: string }[]
}

export interface SurveillanceFailure {
  iteration: number
  step?: SurveillanceStep
  message: string
  frameText: string
}

/** Run a surveillance script against a Solid TUI fixture. Returns a structured report. */
export async function surveil(
  node: () => JSX.Element,
  script: SurveillanceScript,
  opts: SurveillanceOptions = {},
): Promise<SurveillanceReport> {
  const iterations = opts.iterations ?? 100
  const tickMs = opts.tickMs ?? 0
  const iterationTimeout = opts.iterationTimeoutMs ?? 5000
  const snapshotEvery = opts.snapshotEvery ?? 0
  const failures: SurveillanceFailure[] = []
  const snapshots: SurveillanceReport["snapshots"] = []
  const durations: number[] = []
  const seenFrames = new Set<string>()
  let blankFrames = 0
  let memPeak = 0
  const startHeap = process.memoryUsage().heapUsed
  const overall = performance.now()
  const h = await mount(node, { width: opts.width, height: opts.height })
  try {
    if (opts.onStart) await opts.onStart(h)
    for (let i = 0; i < iterations; i++) {
      const it = performance.now()
      const ctl = new AbortController()
      const timeout = setTimeout(() => ctl.abort(), iterationTimeout)
      try {
        const stepsForIter = typeof script.steps === "function" ? script.steps(i) : script.steps
        await runStepsAbortable(h, stepsForIter, ctl.signal, (failure) =>
          failures.push({ iteration: i, ...failure }),
        )
      } catch (err) {
        failures.push({
          iteration: i,
          message: `iteration crashed: ${err instanceof Error ? err.message : String(err)}`,
          frameText: trimFrame(h.frame()),
        })
      } finally {
        clearTimeout(timeout)
      }
      const text = trimFrame(h.frame())
      const blank = text.replace(/\s/g, "").length === 0
      if (blank) blankFrames++
      seenFrames.add(text)
      const dur = performance.now() - it
      durations.push(dur)
      const heap = process.memoryUsage().heapUsed
      if (heap > memPeak) memPeak = heap
      opts.onTick?.({
        iteration: i,
        durationMs: dur,
        frameText: text,
        memDelta: heap - startHeap,
        heapUsed: heap,
      })
      if (snapshotEvery > 0 && i % snapshotEvery === 0) {
        snapshots.push({ iteration: i, label: `iter-${i}`, text })
      }
      if (tickMs > 0) await new Promise((r) => setTimeout(r, tickMs))
    }
  } finally {
    await h.unmount()
  }
  const totalMs = performance.now() - overall
  durations.sort((a, b) => a - b)
  const p95 = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] ?? 0
  return {
    script: script.name,
    iterations,
    totalMs,
    ok: failures.length === 0,
    failures,
    metrics: {
      frameCount: durations.length,
      avgIterationMs: durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length),
      minIterationMs: durations[0] ?? 0,
      maxIterationMs: durations[durations.length - 1] ?? 0,
      p95IterationMs: p95,
      distinctFrames: seenFrames.size,
      blankFrames,
      memStartHeap: startHeap,
      memEndHeap: process.memoryUsage().heapUsed,
      memPeakHeap: memPeak,
    },
    snapshots,
  }
}

async function runStepsAbortable(
  h: TuiHarness,
  steps: SurveillanceStep[],
  signal: AbortSignal,
  onFail: (f: Omit<SurveillanceFailure, "iteration">) => void,
): Promise<void> {
  for (const step of steps) {
    if (signal.aborted) throw new Error("iteration aborted (timeout)")
    try {
      await runStep(h, step)
    } catch (err) {
      onFail({
        step,
        message: err instanceof Error ? err.message : String(err),
        frameText: trimFrame(h.frame()),
      })
      // Don't rethrow; record + continue
    }
  }
}

async function runStep(h: TuiHarness, step: SurveillanceStep): Promise<void> {
  switch (step.kind) {
    case "press":
      await h.press(step.chord)
      return
    case "type":
      await h.type(step.text)
      return
    case "paste":
      await h.paste(step.text)
      return
    case "wait":
      await new Promise((r) => setTimeout(r, step.ms))
      return
    case "resize":
      await h.resize(step.width, step.height)
      return
    case "settle":
      await h.settle()
      return
    case "expect": {
      if (h.find(step.text) === null) throw new Error(`expected ${printNeedle(step.text)} on screen`)
      return
    }
    case "snapshot":
      // captured at iteration end by the runner
      return
  }
}

function printNeedle(n: string | RegExp): string {
  return typeof n === "string" ? JSON.stringify(n) : n.toString()
}

/** Build a random walk script: fresh chords each iteration so frames vary. */
export function randomWalkScript(name: string, chords: string[], stepsPerIteration = 5): SurveillanceScript {
  return {
    name,
    steps: () => {
      const out: SurveillanceStep[] = []
      for (let i = 0; i < stepsPerIteration; i++) {
        const chord = chords[Math.floor(Math.random() * chords.length)]!
        out.push({ kind: "press", chord })
      }
      return out
    },
  }
}
