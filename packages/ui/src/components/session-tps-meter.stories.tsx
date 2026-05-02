// @ts-nocheck
import { SessionTpsMeter } from "@/components/session/session-tps-meter"

const turns = (...values: { tps: number; tokens?: number; ms?: number }[]) =>
  values.map((v, i) => {
    const tokens = v.tokens ?? Math.round(v.tps * 4)
    const ms = v.ms ?? Math.round((tokens / v.tps) * 1000)
    return { id: `t${i}`, index: i, tokens, ms, tps: v.tps }
  })

const ramp = turns(
  { tps: 18 },
  { tps: 24 },
  { tps: 22 },
  { tps: 31 },
  { tps: 47 },
  { tps: 39 },
  { tps: 58 },
  { tps: 64 },
  { tps: 51 },
  { tps: 72 },
)

const args = {
  label: "Generation speed",
  speed: {
    lifetime: 42.4,
    recent: 61.5,
    peak: 72,
    current: 72,
    turns: ramp,
  },
}

export default {
  title: "App/SessionTpsMeter",
  id: "app-session-tps-meter",
  component: SessionTpsMeter,
  tags: ["autodocs"],
  args,
  render: (props) => <SessionTpsMeter {...props} />,
}

export const Basic = {}

export const Empty = {
  args: {
    label: "Generation speed",
    speed: { lifetime: null, recent: null, peak: null, current: null, turns: [] },
  },
}

export const SingleTurn = {
  args: {
    label: "Generation speed",
    speed: {
      lifetime: 38,
      recent: 38,
      peak: 38,
      current: 38,
      turns: turns({ tps: 38 }),
    },
  },
}

export const Choppy = {
  args: {
    label: "Generation speed",
    speed: {
      lifetime: 26.5,
      recent: 31.2,
      peak: 89,
      current: 18,
      turns: turns(
        { tps: 12 },
        { tps: 89 },
        { tps: 22 },
        { tps: 71 },
        { tps: 14 },
        { tps: 64 },
        { tps: 25 },
        { tps: 18 },
      ),
    },
  },
}

export const FastModel = {
  args: {
    label: "Generation speed",
    speed: {
      lifetime: 184,
      recent: 192,
      peak: 211,
      current: 192,
      turns: turns(
        { tps: 158 },
        { tps: 172 },
        { tps: 168 },
        { tps: 184 },
        { tps: 211 },
        { tps: 195 },
        { tps: 192 },
      ),
    },
  },
}
