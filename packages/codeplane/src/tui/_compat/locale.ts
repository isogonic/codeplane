// TUI-local namespace barrel for locale.
import * as LocaleImpl from "@/util/locale"

export const Locale = {
  titlecase: LocaleImpl.titlecase,
  time: LocaleImpl.time,
  datetime: LocaleImpl.datetime,
  todayTimeOrDateTime: LocaleImpl.todayTimeOrDateTime,
  number: LocaleImpl.number,
  duration: LocaleImpl.duration,
  truncate: LocaleImpl.truncate,
  truncateMiddle: LocaleImpl.truncateMiddle,
  pluralize: LocaleImpl.pluralize,
} as const
