import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SpeedMetrics, TurnSpeed } from "./session-context-metrics"
import { createSessionContextFormatter } from "./session-context-format"

const SPARK_WIDTH = 160
const SPARK_HEIGHT = 36
const SPARK_PADDING_X = 6
const SPARK_PADDING_Y = 5

function buildSparkDomain(turns: TurnSpeed[]) {
  if (turns.length === 0) return { min: 0, max: 1 }
  const values = turns.map((turn) => turn.tps)
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max <= min) {
    const pad = Math.max(max * 0.14, 1)
    return {
      min: Math.max(0, min - pad),
      max: max + pad,
    }
  }
  const spread = max - min
  const pad = Math.max(spread * 0.2, max * 0.04, 1)
  return {
    min: Math.max(0, min - pad),
    max: max + pad,
  }
}

export function buildSparkPath(turns: TurnSpeed[]) {
  if (turns.length === 0) return { line: "", area: "", points: [] as { x: number; y: number; turn: TurnSpeed }[] }
  const innerWidth = SPARK_WIDTH - SPARK_PADDING_X * 2
  const innerHeight = SPARK_HEIGHT - SPARK_PADDING_Y * 2
  const domain = buildSparkDomain(turns)
  const domainSpan = Math.max(domain.max - domain.min, 1)
  const denom = Math.max(turns.length - 1, 1)
  const points = turns.map((turn, i) => {
    const x = SPARK_PADDING_X + (i / denom) * innerWidth
    const ratio = Math.min(Math.max((turn.tps - domain.min) / domainSpan, 0), 1)
    const y = SPARK_PADDING_Y + (1 - ratio) * innerHeight
    return { x, y, turn }
  })
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return { line: "", area: "", points }
  const baseline = (SPARK_HEIGHT - SPARK_PADDING_Y).toFixed(2)
  const area = `${line} L${last.x.toFixed(2)} ${baseline} L${first.x.toFixed(2)} ${baseline} Z`
  return { line, area, points }
}

export function SessionTpsMeter(props: { speed: SpeedMetrics; label: string }) {
  const language = useLanguage()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const headline = createMemo(() => props.speed.recent ?? props.speed.lifetime)
  const spark = createMemo(() => buildSparkPath(props.speed.turns))
  const lastIndex = createMemo(() => props.speed.turns.length - 1)

  const tpsTooltip = (turn: TurnSpeed, index: number) =>
    `#${index + 1} · ${formatter().tokensPerSecond(turn.tps)} · ${turn.tokens.toLocaleString(language.intl())} tok / ${(turn.ms / 1000).toFixed(1)}s`

  return (
    <div class="flex flex-col gap-2 overflow-hidden rounded-md border border-border-base bg-surface-base px-3 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <div class="text-12-regular text-text-weak">{props.label}</div>
        <Show when={props.speed.turns.length > 0}>
          <div class="text-11-regular text-text-weaker">
            {props.speed.turns.length.toLocaleString(language.intl())} turns
          </div>
        </Show>
      </div>
      <div class="flex min-w-0 items-end gap-3">
        <div class="flex shrink-0 items-baseline gap-1.5">
          <div class="text-20-medium text-text-strong tabular-nums">
            {headline() === null
              ? "—"
              : headline()!.toLocaleString(language.intl(), {
                  maximumFractionDigits: headline()! >= 100 ? 0 : headline()! >= 10 ? 1 : 2,
                })}
          </div>
          <div class="text-12-regular text-text-weak">tok/s</div>
        </div>
        <Show when={props.speed.turns.length > 1}>
          <svg
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            preserveAspectRatio="none"
            class="h-9 min-w-0 flex-1 overflow-visible"
            aria-hidden="true"
          >
            <path d={spark().area} fill="var(--syntax-property)" fill-opacity="0.12" />
            <path
              d={spark().line}
              fill="none"
              stroke="var(--syntax-property)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <For each={spark().points}>
              {(point, i) => (
                <Show when={i() === lastIndex()}>
                  <circle cx={point.x} cy={point.y} r={2.5} fill="var(--syntax-property)" />
                </Show>
              )}
            </For>
          </svg>
        </Show>
      </div>
      <div class="grid grid-cols-3 gap-2 pt-1">
        <MeterStat
          label="Recent"
          value={formatter().tokensPerSecond(props.speed.recent)}
          title={
            props.speed.turns.length > 0 ? `Average over the last ${Math.min(5, props.speed.turns.length)} turns` : ""
          }
        />
        <MeterStat label="Lifetime" value={formatter().tokensPerSecond(props.speed.lifetime)} title="Session average" />
        <MeterStat
          label="Peak"
          value={formatter().tokensPerSecond(props.speed.peak)}
          title={
            props.speed.turns.length > 0 ? tpsTooltip(bestTurn(props.speed.turns)!, bestTurnIndex(props.speed.turns)) : ""
          }
        />
      </div>
    </div>
  )
}

function MeterStat(props: { label: string; value: string; title?: string }) {
  return (
    <div class="flex flex-col gap-0.5" title={props.title}>
      <div class="text-11-regular text-text-weaker">{props.label}</div>
      <div class="text-12-medium text-text-strong tabular-nums">{props.value}</div>
    </div>
  )
}

function bestTurn(turns: TurnSpeed[]): TurnSpeed | undefined {
  let best: TurnSpeed | undefined
  for (const turn of turns) {
    if (!best || turn.tps > best.tps) best = turn
  }
  return best
}

function bestTurnIndex(turns: TurnSpeed[]): number {
  let bestIdx = 0
  let bestTps = -Infinity
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (turn && turn.tps > bestTps) {
      bestTps = turn.tps
      bestIdx = i
    }
  }
  return bestIdx
}
