import { describe, expect, test } from "bun:test"
import { surveil, randomWalkScript } from "../surveillance/runner"
import { ListFixture } from "../fixtures/list"
import { ScrollFixture } from "../fixtures/scroll"
import { DialogFixture } from "../fixtures/dialog"
import { ErrorBoundaryFixture } from "../fixtures/error-boundary"

describe("tui-suite/surveillance", () => {
  test("runs a scripted walk with no failures and reports metrics", async () => {
    const report = await surveil(
      () => <ListFixture />,
      {
        name: "list-walk",
        steps: [
          { kind: "press", chord: "down" },
          { kind: "press", chord: "down" },
          { kind: "press", chord: "up" },
          { kind: "expect", text: /▸/ },
        ],
      },
      { iterations: 25 },
    )
    expect(report.ok).toBe(true)
    expect(report.iterations).toBe(25)
    expect(report.metrics.frameCount).toBe(25)
    expect(report.metrics.avgIterationMs).toBeGreaterThan(0)
    expect(report.metrics.distinctFrames).toBeGreaterThan(0)
    expect(report.metrics.blankFrames).toBe(0)
  })

  test("records failures when expect step misses", async () => {
    const report = await surveil(
      () => <ListFixture />,
      {
        name: "missing-text",
        steps: [{ kind: "expect", text: "this string never appears in the fixture" }],
      },
      { iterations: 3 },
    )
    expect(report.ok).toBe(false)
    expect(report.failures.length).toBeGreaterThanOrEqual(3)
    expect(report.failures[0]!.message).toContain("this string never appears")
  })

  test("captures snapshots on schedule", async () => {
    const report = await surveil(
      () => <ListFixture />,
      randomWalkScript("list-fuzz", ["up", "down"], 2),
      { iterations: 10, snapshotEvery: 2 },
    )
    expect(report.snapshots.length).toBeGreaterThan(0)
    expect(report.snapshots[0]!.label).toBe("iter-0")
  })

  test("scroll fixture survives random walk", async () => {
    const report = await surveil(
      () => <ScrollFixture count={50} />,
      randomWalkScript("scroll-fuzz", ["up", "down", "pageup", "pagedown", "home", "end"], 6),
      { iterations: 30 },
    )
    expect(report.ok).toBe(true)
    expect(report.metrics.distinctFrames).toBeGreaterThan(1)
  })

  test("error-boundary fixture is non-fatal under random walk", async () => {
    const report = await surveil(
      () => <ErrorBoundaryFixture />,
      randomWalkScript("eb-fuzz", ["x", "r", "x", "r"], 4),
      { iterations: 20 },
    )
    expect(report.ok).toBe(true)
    // The fixture's <ErrorBoundary> catches; make sure we never hit a crashed iteration
    expect(report.failures.filter((f) => f.message.includes("crashed")).length).toBe(0)
  })

  test("dialog confirm/cancel cycle stays consistent", async () => {
    const report = await surveil(
      () => <DialogFixture />,
      {
        name: "dialog-cycle",
        steps: [
          { kind: "press", chord: "o" },
          { kind: "expect", text: "Are you sure?" },
          { kind: "press", chord: "y" },
          { kind: "expect", text: "Status: CONFIRMED" },
          { kind: "press", chord: "o" },
          { kind: "press", chord: "n" },
          { kind: "expect", text: "Status: pending" },
        ],
      },
      { iterations: 5 },
    )
    expect(report.ok).toBe(true)
  })

  test("onTick hook receives per-iteration info", async () => {
    const ticks: number[] = []
    await surveil(
      () => <ListFixture />,
      randomWalkScript("noop", ["down"], 1),
      {
        iterations: 5,
        onTick: (info) => ticks.push(info.iteration),
      },
    )
    expect(ticks).toEqual([0, 1, 2, 3, 4])
  })
})
