import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import type { SpeedMetrics, TurnSpeed } from "./session-context-metrics"
import { createSessionContextFormatter } from "./session-context-format"

const SPARK_WIDTH = 160
const SPARK_HEIGHT = 36
const SPARK_PADDING = 2

function buildSparkPath(turns: TurnSpeed[], peak: number) {
  if (turns.length === 0) return { line: "", area: "", points: [] as { x: number; y: number; turn: TurnSpeed }[] }
  const innerWidth = SPARK_WIDTH - SPARK_PADDING * 2
  const innerHeight = SPARK_HEIGHT - SPARK_PADDING * 2
  const denom = Math.max(turns.length - 1, 1)
  const points = turns.map((turn, i) => {
    const x = SPARK_PADDING + (i / denom) * innerWidth
    const ratio = peak > 0 ? Math.min(turn.tps / peak, 1) : 0
    const y = SPARK_PADDING + (1 - ratio) * innerHeight
    return { x, y, turn }
  })
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")
  const area = `${line} L${points.at(-1)!.x.toFixed(2)} ${(SPARK_HEIGHT - SPARK_PADDING).toFixed(2)} L${points[0]!.x.toFixed(2)} ${(SPARK_HEIGHT - SPARK_PADDING).toFixed(2)} Z`
  return { line, area, points }
}

export function SessionTpsMeter(props: { speed: SpeedMetrics; label: string }) {
  const language = useLanguage()
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))

  const headline = createMemo(() => props.speed.recent ?? props.speed.lifetime)
  const peakValue = createMemo(() => props.speed.peak ?? 0)
  const spark = createMemo(() => buildSparkPath(props.speed.turns, peakValue()))
  const lastIndex = createMemo(() => props.speed.turns.length - 1)

  const tpsTooltip = (turn: TurnSpeed, index: number) =>
    `#${index + 1} · ${formatter().tokensPerSecond(turn.tps)} · ${turn.tokens.toLocaleString(language.intl())} tok / ${(turn.ms / 1000).toFixed(1)}s`

  return (
    <div class="flex flex-col gap-2 rounded-md border border-border-base bg-surface-base px-3 py-2.5">
      <div class="flex items-center justify-between gap-3">
        <div class="text-12-regular text-text-weak">{props.label}</div>
        <Show when={props.speed.turns.length > 0}>
          <div class="text-11-regular text-text-weaker">
            {props.speed.turns.length.toLocaleString(language.intl())} turns
          </div>
        </Show>
      </div>
      <div class="flex items-end justify-between gap-3">
        <div class="flex items-baseline gap-1.5">
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
            width={SPARK_WIDTH}
            height={SPARK_HEIGHT}
            viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
            class="shrink-0 overflow-visible"
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
    if (turns[i]!.tps > bestTps) {
      bestTps = turns[i]!.tps
      bestIdx = i
    }
  }
  return bestIdx
}
