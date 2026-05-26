import { describe, expect, test } from "bun:test"
import { buildSparkPath } from "./session-tps-meter"

const turns = (...values: number[]) =>
  values.map((tps, index) => ({
    id: `turn-${index}`,
    index,
    tokens: Math.round(tps * 4),
    ms: 4_000,
    tps,
  }))

describe("buildSparkPath", () => {
  test("uses the local visible range so modest TPS variation does not collapse into a flat line", () => {
    const spark = buildSparkPath(turns(68, 71, 69, 72))
    const ys = spark.points.map((point) => point.y)
    const spread = Math.max(...ys) - Math.min(...ys)

    expect(spread).toBeGreaterThan(8)
  })

  test("keeps the first and last points inset so the current marker stays inside the chart", () => {
    const spark = buildSparkPath(turns(120, 180, 150))
    const first = spark.points[0]
    const last = spark.points.at(-1)

    expect(first?.x).toBeGreaterThan(2.5)
    expect(last?.x).toBeLessThan(157.5)
  })

  test("renders a stable centered line when every turn has the same speed", () => {
    const spark = buildSparkPath(turns(80, 80, 80))
    const ys = spark.points.map((point) => point.y)

    expect(new Set(ys.map((value) => value.toFixed(2))).size).toBe(1)
    expect(ys[0]).toBeGreaterThan(5)
    expect(ys[0]).toBeLessThan(31)
  })
})
