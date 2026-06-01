import { detectLocaleFromEnvironment, type SupportedLocale } from "@codeplane-ai/shared/locale"

const en = {
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.clear": "Clear",
  "common.connected": "Connected",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.enterDir": "Enter dir",
  "common.home": "Home",
  "common.installNow": "Install now",
  "common.navigate": "Navigate",
  "common.newLocal": "New local",
  "common.newRemote": "New remote",
  "common.nextField": "Next field",
  "common.noResults": "No results found",
  "common.ok": "OK",
  "common.open": "Open",
  "common.openHere": "Open here",
  "common.probe": "Probe",
  "common.quit": "Quit",
  "common.required": "Required",
  "common.save": "Save",
  "common.search": "Search",
  "common.spaceToToggle": "Space toggles",
  "common.up": "Up",
  "common.update": "Update",
  "boot.instancePicker.heading": "Choose a Server",
  "boot.instancePicker.emptyPrefix": "No saved instances. Press ",
  "boot.instancePicker.emptyMiddle": " for a local one or ",
  "boot.instancePicker.emptySuffix": " for a remote one.",
  "boot.instancePicker.kind.local": "local",
  "boot.instancePicker.kind.remote": "remote",
  "boot.instancePicker.localHint": "binary {{version}}  ·  choose a directory next",
  "boot.instancePicker.localHostedHint": "binary {{version}}  ·  remote access {{host}}  ·  choose a directory next",
  "boot.instancePicker.remoteHint": "runs on {{host}}  ·  uses server cwd",
  "boot.directory.heading": "Choose a Working Directory",
  "boot.directory.pickForPrefix": "Choose a working directory for ",
  "boot.directory.controls": "Up/down selects  ·  Right enters  ·  Left goes up  ·  Return opens here",
  "boot.directory.noMatches": "No matches for \"{{search}}\".",
  "boot.directory.empty": "Empty directory.",
  "boot.directory.showing": "Showing {{start}}-{{end}} of {{total}}",
  "boot.directory.moreAbove": "{{count}} more above",
  "boot.directory.moreBelow": "{{count}} more below",
  "boot.directory.openHereOrDrillIn": "Drill in / open here",
  "boot.directory.search": "Search",
  "boot.local.heading": "New Local Instance",
  "boot.local.heading.edit": "Edit Local Instance",
  "boot.local.label": "Label",
  "boot.local.labelPlaceholder": "Local Codeplane",
  "boot.local.labelHint": "shown in the picker",
  "boot.local.binaryVersion": "Binary version",
  "boot.local.usesSavedPreferredVersion": "uses the saved preferred version",
  "boot.local.checking": "Checking...",
  "boot.local.installedAt": "installed at {{path}}",
  "boot.local.knownPath": "known path",
  "boot.local.notInstalledHint": "not installed  ·  Ctrl+I installs now  ·  Ctrl+S saves and installs on first use",
  "boot.local.target": "target: {{os}}/{{arch}}  ·  binary {{binary}}  ·  {{archive}}",
  "boot.local.installing": "Installing...",
  "boot.local.notInstalledBanner": "Binary not yet installed. Press Ctrl+I to install now, or Ctrl+S to save (it will install on first use).",
  "boot.local.installedBanner": "Binary installed and ready.",
  "boot.remote.heading.new": "New Remote Instance",
  "boot.remote.heading.edit": "Edit Remote Instance",
  "boot.remote.heading.editAccess": "Edit Remote Access",
  "boot.remote.label": "Label",
  "boot.remote.url": "URL",
  "boot.remote.urlPlaceholder": "https://codeplane.example.com",
  "boot.remote.urlHint": "https:// or http://",
  "boot.remote.username": "Username",
  "boot.remote.password": "Password",
  "boot.remote.otp": "One-time code",
  "boot.remote.otpHint": "shown only when the server requires a second factor",
  "boot.remote.otpVerified": "OTP verified",
  "boot.remote.otpVerifiedHint": "verified for this saved password",
  "boot.remote.ignoreCert": "Trust self-signed TLS certificates",
  "boot.remote.ignoreCertHint": "only enable for trusted internal / dev instances",
  "boot.remote.clearCache": "Clear local cache",
  "boot.remote.clearCacheNotice": "Cleared {{size}} MB of local cache for this instance.",
  "boot.remote.clearCacheSummary": "{{size}} MB cached for this instance.",
  "boot.remote.probing": "Checking auth and /global/version...",
  "boot.remote.probeOk": "Server reachable. Reports v{{version}}.",
  "boot.remote.probeOkNoVersion": "Server reachable but did not return a version.",
  "boot.remote.probeFailed": "Probe failed: {{message}}",
  "boot.remote.labelRequired": "Label is required",
  "boot.remote.urlRequired": "URL is required",
  "boot.remote.urlMustStart": "URL must start with http:// or https://",
  "boot.remote.optional": "(optional)",
  "boot.remote.loginHint": "Use the username and password from codeplane serve --password. OTP appears only when required.",
  "boot.remote.authInvalidPassword": "Username or password is incorrect.",
  "boot.remote.authOtpRequired": "Enter the one-time code for this server.",
  "boot.remote.authOtpInvalid": "One-time code is incorrect.",
  "boot.remote.authOtpRateLimited": "Too many attempts. Try again later.",
  "boot.remote.authOtpFailed": "Could not verify the one-time code.",
  "boot.remote.usernameHint": "defaults to codeplane when blank",
  "boot.remote.passwordHint": "leave empty if the server does not require a password",
  "boot.remote.passwordMaskedHint": "masked — Ctrl+U to clear",
  "boot.remote.localManagedHint":
    "This instance is still managed locally. These fields only change its saved remote access settings; use Update to change the local binary version.",
} as const

export type TuiTranslationKey = keyof typeof en
type Params = Record<string, string | number | boolean>

const overrides: Partial<Record<SupportedLocale, Partial<Record<TuiTranslationKey, string>>>> = {}
const locale = detectLocaleFromEnvironment()

export function makeTuiTranslator(nextLocale: SupportedLocale = locale) {
  const nextDict = { ...en, ...overrides[nextLocale] }
  return {
    locale: nextLocale,
    t(key: TuiTranslationKey, params?: Params) {
      const value = nextDict[key] ?? en[key]
      if (!params) return value
      return value.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(params[token] ?? ""))
    },
  }
}

export const tuiLocale = locale
const translator = makeTuiTranslator(locale)
export const tuiT = (key: TuiTranslationKey, params?: Params) => translator.t(key, params)

export const TuiI18n = {
  locale,
  t: tuiT,
}
