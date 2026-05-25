import * as i18n from "@solid-primitives/i18n"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import {
  detectLocaleFromNavigator,
  localeIntl,
  normalizeSupportedLocale,
  supportedLocales,
  type SupportedLocale,
} from "@codeplane-ai/shared/locale"
import { Persist, persisted } from "@/utils/persist"
import { dict as en } from "@/i18n/en"
import { dict as uiEn } from "@codeplane-ai/ui/i18n/en"

export type Locale = SupportedLocale

type RawDictionary = typeof en & typeof uiEn
type Dictionary = i18n.Flatten<RawDictionary>
type Source = { dict: Record<string, string> }
type DesktopStorageWindow = Window & {
  codeplaneDesktop?: {
    storage?: {
      getItem: (storageName: string | undefined, key: string) => string | null
    }
  }
}

function cookie(locale: Locale) {
  return `oc_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

const LOCALES: readonly Locale[] = supportedLocales
const INTL: Record<Locale, string> = localeIntl

const LABEL_KEY: Record<Locale, keyof Dictionary> = {
  en: "language.en",
  zh: "language.zh",
  zht: "language.zht",
  ko: "language.ko",
  de: "language.de",
  es: "language.es",
  fr: "language.fr",
  da: "language.da",
  ja: "language.ja",
  pl: "language.pl",
  ru: "language.ru",
  ar: "language.ar",
  no: "language.no",
  br: "language.br",
  th: "language.th",
  bs: "language.bs",
  tr: "language.tr",
}

const base = i18n.flatten({ ...en, ...uiEn })
const dicts = new Map<Locale, Dictionary>([["en", base]])

const merge = (app: Promise<Source>, ui: Promise<Source>) =>
  Promise.all([app, ui]).then(([a, b]) => ({ ...base, ...i18n.flatten({ ...a.dict, ...b.dict }) }) as Dictionary)

const loaders: Record<Exclude<Locale, "en">, () => Promise<Dictionary>> = {
  zh: () => merge(import("@/i18n/zh"), import("@codeplane-ai/ui/i18n/zh")),
  zht: () => merge(import("@/i18n/zht"), import("@codeplane-ai/ui/i18n/zht")),
  ko: () => merge(import("@/i18n/ko"), import("@codeplane-ai/ui/i18n/ko")),
  de: () => merge(import("@/i18n/de"), import("@codeplane-ai/ui/i18n/de")),
  es: () => merge(import("@/i18n/es"), import("@codeplane-ai/ui/i18n/es")),
  fr: () => merge(import("@/i18n/fr"), import("@codeplane-ai/ui/i18n/fr")),
  da: () => merge(import("@/i18n/da"), import("@codeplane-ai/ui/i18n/da")),
  ja: () => merge(import("@/i18n/ja"), import("@codeplane-ai/ui/i18n/ja")),
  pl: () => merge(import("@/i18n/pl"), import("@codeplane-ai/ui/i18n/pl")),
  ru: () => merge(import("@/i18n/ru"), import("@codeplane-ai/ui/i18n/ru")),
  ar: () => merge(import("@/i18n/ar"), import("@codeplane-ai/ui/i18n/ar")),
  no: () => merge(import("@/i18n/no"), import("@codeplane-ai/ui/i18n/no")),
  br: () => merge(import("@/i18n/br"), import("@codeplane-ai/ui/i18n/br")),
  th: () => merge(import("@/i18n/th"), import("@codeplane-ai/ui/i18n/th")),
  bs: () => merge(import("@/i18n/bs"), import("@codeplane-ai/ui/i18n/bs")),
  tr: () => merge(import("@/i18n/tr"), import("@codeplane-ai/ui/i18n/tr")),
}

function loadDict(locale: Locale) {
  const hit = dicts.get(locale)
  if (hit) return Promise.resolve(hit)
  if (locale === "en") return Promise.resolve(base)
  const load = loaders[locale]
  return load().then((next: Dictionary) => {
    dicts.set(locale, next)
    return next
  })
}

export function loadLocaleDict(locale: Locale) {
  return loadDict(locale).then(() => undefined)
}

function detectLocale(): Locale {
  return detectLocaleFromNavigator(typeof navigator === "object" ? navigator : undefined)
}

export function normalizeLocale(value: string): Locale {
  return normalizeSupportedLocale(value)
}

function readStoredLocale() {
  try {
    if (typeof window !== "object") return
    const storage = (window as DesktopStorageWindow).codeplaneDesktop?.storage
    const raw = storage
      ? storage.getItem("codeplane.global.dat", "language")
      : window.localStorage.getItem("codeplane.global.dat:language")
    if (!raw) return
    const next = JSON.parse(raw) as { locale?: string }
    if (typeof next?.locale !== "string") return
    return normalizeLocale(next.locale)
  } catch {
    return
  }
}

const warm = readStoredLocale() ?? detectLocale()
if (warm !== "en") void loadDict(warm)

export const { use: useLanguage, provider: LanguageProvider } = createSimpleContext({
  name: "Language",
  init: (props: { locale?: Locale }) => {
    const initial = props.locale ?? readStoredLocale() ?? detectLocale()
    const [store, setStore, _, ready] = persisted(
      Persist.global("language", ["language.v1"]),
      createStore({
        locale: initial,
      }),
    )

    const locale = createMemo<Locale>(() => normalizeLocale(store.locale))
    const intl = createMemo(() => INTL[locale()])

    const [dict] = createResource(locale, loadDict, {
      initialValue: dicts.get(initial) ?? base,
    })

    const t = i18n.translator(() => dict() ?? base, i18n.resolveTemplate) as (
      key: keyof Dictionary,
      params?: Record<string, string | number | boolean>,
    ) => string

    const label = (value: Locale) => t(LABEL_KEY[value])

    createEffect(() => {
      if (typeof document !== "object") return
      document.documentElement.lang = locale()
      document.cookie = cookie(locale())
    })

    return {
      ready,
      locale,
      intl,
      locales: LOCALES,
      label,
      t,
      setLocale(next: Locale) {
        setStore("locale", normalizeLocale(next))
      },
    }
  },
})
