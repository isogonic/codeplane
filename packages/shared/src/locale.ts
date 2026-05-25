export const supportedLocales = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "ar",
  "no",
  "br",
  "th",
  "bs",
  "tr",
] as const

export type SupportedLocale = (typeof supportedLocales)[number]

export const localeIntl: Record<SupportedLocale, string> = {
  en: "en",
  zh: "zh-Hans",
  zht: "zh-Hant",
  ko: "ko",
  de: "de",
  es: "es",
  fr: "fr",
  da: "da",
  ja: "ja",
  pl: "pl",
  ru: "ru",
  ar: "ar",
  no: "nb-NO",
  br: "pt-BR",
  th: "th",
  bs: "bs",
  tr: "tr",
}

const matchers: Array<{ locale: SupportedLocale; match: (value: string) => boolean }> = [
  { locale: "en", match: (value) => value.startsWith("en") },
  { locale: "zht", match: (value) => value.startsWith("zh") && (value.includes("hant") || value.includes("tw") || value.includes("hk")) },
  { locale: "zh", match: (value) => value.startsWith("zh") },
  { locale: "ko", match: (value) => value.startsWith("ko") },
  { locale: "de", match: (value) => value.startsWith("de") },
  { locale: "es", match: (value) => value.startsWith("es") },
  { locale: "fr", match: (value) => value.startsWith("fr") },
  { locale: "da", match: (value) => value.startsWith("da") },
  { locale: "ja", match: (value) => value.startsWith("ja") },
  { locale: "pl", match: (value) => value.startsWith("pl") },
  { locale: "ru", match: (value) => value.startsWith("ru") },
  { locale: "ar", match: (value) => value.startsWith("ar") },
  { locale: "no", match: (value) => value.startsWith("no") || value.startsWith("nb") || value.startsWith("nn") },
  { locale: "br", match: (value) => value.startsWith("pt") },
  { locale: "th", match: (value) => value.startsWith("th") },
  { locale: "bs", match: (value) => value.startsWith("bs") },
  { locale: "tr", match: (value) => value.startsWith("tr") },
]

function matchSupportedLocale(value: string | undefined | null) {
  if (!value) return
  const normalized = value.toLowerCase().replaceAll("_", "-")
  const direct = supportedLocales.find((locale) => locale === normalized)
  if (direct) return direct
  return matchers.find((entry) => entry.match(normalized))?.locale
}

export function normalizeSupportedLocale(value: string | undefined | null, fallback: SupportedLocale = "en"): SupportedLocale {
  return matchSupportedLocale(value) ?? fallback
}

export function detectSupportedLocale(input: Iterable<string | undefined | null>, fallback: SupportedLocale = "en"): SupportedLocale {
  for (const value of input) {
    const locale = matchSupportedLocale(value)
    if (locale) return locale
  }
  return fallback
}

export function detectLocaleFromNavigator(
  navigatorLike?: { languages?: readonly string[]; language?: string | null } | null,
  fallback: SupportedLocale = "en",
) {
  if (!navigatorLike) return fallback
  const languages = navigatorLike.languages?.length ? navigatorLike.languages : [navigatorLike.language]
  return detectSupportedLocale(languages, fallback)
}

export function localeCandidatesFromEnvironment(env: Record<string, string | undefined>) {
  return [env.CODEPLANE_LOCALE, env.LC_ALL, env.LC_MESSAGES, env.LANG]
}

export function detectLocaleFromEnvironment(env: Record<string, string | undefined> = process.env, fallback: SupportedLocale = "en") {
  return detectSupportedLocale(localeCandidatesFromEnvironment(env), fallback)
}

export * as Locale from "./locale"
