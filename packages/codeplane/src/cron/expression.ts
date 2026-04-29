const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 7 },
] as const

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

type Field = ReadonlySet<number>
const MAX_SEARCH_YEARS = 400

export type ParsedExpression = {
  minute: Field
  hour: Field
  dayOfMonth: Field
  month: Field
  dayOfWeek: Field
}

export class CronParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CronParseError"
  }
}

function parseValue(token: string, min: number, max: number, names?: Record<string, number>): number {
  const lower = token.toLowerCase()
  if (names && lower in names) return names[lower]
  const value = Number(token)
  if (!Number.isInteger(value)) throw new CronParseError(`Invalid value: ${token}`)
  if (value < min || value > max) throw new CronParseError(`Value ${value} out of range [${min}, ${max}]`)
  return value
}

function parseField(spec: string, min: number, max: number, names?: Record<string, number>): Set<number> {
  const result = new Set<number>()
  for (const part of spec.split(",")) {
    if (!part) throw new CronParseError(`Invalid empty field part: ${spec}`)
    let stepStr = "1"
    let rangeStr = part
    const stepIdx = part.indexOf("/")
    if (stepIdx !== -1) {
      rangeStr = part.slice(0, stepIdx)
      stepStr = part.slice(stepIdx + 1)
    }
    if (!rangeStr) throw new CronParseError(`Invalid range: ${part}`)
    const step = Number(stepStr)
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(`Invalid step: ${stepStr}`)

    let start: number
    let end: number
    if (rangeStr === "*") {
      start = min
      end = max
    } else if (rangeStr.includes("-")) {
      const bounds = rangeStr.split("-")
      if (bounds.length !== 2 || !bounds[0] || !bounds[1]) {
        throw new CronParseError(`Invalid range: ${rangeStr}`)
      }
      start = parseValue(bounds[0], min, max, names)
      end = parseValue(bounds[1], min, max, names)
    } else {
      start = parseValue(rangeStr, min, max, names)
      end = stepIdx !== -1 ? max : start
    }
    if (end < start) throw new CronParseError(`Invalid range: ${rangeStr}`)
    for (let v = start; v <= end; v += step) result.add(v)
  }
  return result
}

function normalizeDayOfWeek(field: Set<number>): Set<number> {
  if (!field.has(7)) return field
  field.delete(7)
  field.add(0)
  return field
}

export function parse(expression: string): ParsedExpression {
  const trimmed = expression.trim()
  const expanded = ALIASES[trimmed.toLowerCase()] ?? trimmed
  const tokens = expanded.split(/\s+/)
  if (tokens.length !== 5) {
    throw new CronParseError(`Expected 5 fields, got ${tokens.length}: ${expression}`)
  }
  return {
    minute: parseField(tokens[0], FIELDS[0].min, FIELDS[0].max),
    hour: parseField(tokens[1], FIELDS[1].min, FIELDS[1].max),
    dayOfMonth: parseField(tokens[2], FIELDS[2].min, FIELDS[2].max),
    month: parseField(tokens[3], FIELDS[3].min, FIELDS[3].max, MONTH_NAMES),
    dayOfWeek: normalizeDayOfWeek(parseField(tokens[4], FIELDS[4].min, FIELDS[4].max, DAY_NAMES)),
  }
}

export function isValid(expression: string): boolean {
  try {
    parse(expression)
    return true
  } catch {
    return false
  }
}

function nextMatchingDay(parsed: ParsedExpression, year: number, month: number, day: number): number {
  const last = new Date(year, month, 0).getDate()
  for (let d = day; d <= last; d++) {
    const dow = new Date(year, month - 1, d).getDay()
    if (parsed.dayOfMonth.has(d) && parsed.dayOfWeek.has(dow)) return d
  }
  return -1
}

/**
 * Compute the next time at or after `from` that the expression matches.
 * Operates in local time of the host process. Returns ms epoch.
 *
 * Why: keeping the math local-time avoids shipping a TZ database; for
 * server-bound cron jobs the host's local TZ is the right reference unless
 * a per-task timezone is provided (currently informational only).
 */
export function next(expression: string, from: Date | number = Date.now()): number {
  const parsed = parse(expression)
  const start = new Date(typeof from === "number" ? from : from.getTime())
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)
  const end = new Date(start.getTime())
  end.setFullYear(end.getFullYear() + MAX_SEARCH_YEARS)

  while (start.getTime() <= end.getTime()) {
    if (!parsed.month.has(start.getMonth() + 1)) {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      start.setMonth(start.getMonth() + 1)
      continue
    }
    const day = nextMatchingDay(parsed, start.getFullYear(), start.getMonth() + 1, start.getDate())
    if (day === -1) {
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      start.setMonth(start.getMonth() + 1)
      continue
    }
    if (day !== start.getDate()) {
      start.setHours(0, 0, 0, 0)
      start.setDate(day)
      continue
    }
    if (!parsed.hour.has(start.getHours())) {
      start.setMinutes(0)
      start.setHours(start.getHours() + 1)
      continue
    }
    if (!parsed.minute.has(start.getMinutes())) {
      start.setMinutes(start.getMinutes() + 1)
      continue
    }
    return start.getTime()
  }
  throw new CronParseError(`Could not find next time within ${MAX_SEARCH_YEARS} years for ${expression}`)
}

export * as CronExpression from "./expression"
