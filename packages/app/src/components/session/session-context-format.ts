import { DateTime } from "luxon"

export function createSessionContextFormatter(locale: string) {
  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      return value.toLocaleString(locale) + "%"
    },
    tokensPerSecond(value: number | null | undefined) {
      if (value === undefined) return "—"
      if (value === null) return "—"
      const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
      return `${value.toLocaleString(locale, { maximumFractionDigits: digits })}/s`
    },
    time(value: number | undefined) {
      if (!value) return "—"
      return DateTime.fromMillis(value).setLocale(locale).toLocaleString(DateTime.DATETIME_MED)
    },
  }
}
