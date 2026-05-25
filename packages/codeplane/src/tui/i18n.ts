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
  "common.signIn": "Sign in",
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
  "boot.remote.username": "Basic Auth username",
  "boot.remote.password": "Basic Auth password",
  "boot.remote.headers": "Custom request headers",
  "boot.remote.headersPlaceholder": "Authorization: Bearer ...",
  "boot.remote.ignoreCert": "Trust self-signed TLS certificates",
  "boot.remote.ignoreCertHint": "only enable for trusted internal / dev instances",
  "boot.remote.clearCache": "Clear local cache",
  "boot.remote.clearCacheNotice": "Cleared {{size}} MB of local cache for this instance.",
  "boot.remote.clearCacheSummary": "{{size}} MB cached for this instance.",
  "boot.remote.signInBrowser": "Sign in via browser",
  "boot.remote.signInOpened": "Opened {{url}} in your default browser. Sign in there, copy the auth header (Cookie, Authorization, ...) from DevTools, then paste below.",
  "boot.remote.signInHint": "Open the sign-in page and paste the captured header back here.",
  "boot.remote.signInPaste": "Paste header",
  "boot.remote.signInPasteHint": "Format: Name: value  ·  Return verifies  ·  Esc cancels  ·  Ctrl+U clears",
  "boot.remote.signInPasteExample": "Example: Cookie: session=...  or  Authorization: Bearer ...",
  "boot.remote.signInVerifying": "Verifying captured header against /global/version...",
  "boot.remote.headersHintEmpty": "one Name: Value per line — Enter for newline",
  "boot.remote.headersHintCount.one": "{{count}} header — Enter newline, Ctrl+U clear",
  "boot.remote.headersHintCount.other": "{{count}} headers — Enter newline, Ctrl+U clear",
  "boot.remote.probing": "Probing /global/version...",
  "boot.remote.probeOk": "Server reachable. Reports v{{version}}.",
  "boot.remote.probeOkNoVersion": "Server reachable but did not return a version (auth proxy?). Use Ctrl+G to sign in via browser.",
  "boot.remote.probeFailed": "Probe failed: {{message}}",
  "boot.remote.urlRequiredToSignIn": "URL required to sign in",
  "boot.remote.invalidHeader": "Invalid header \"{{header}}...\". Use NAME: VALUE.",
  "boot.remote.headerNameValueRequired": "Both NAME and VALUE must be non-empty.",
  "boot.remote.saveFailedInvalidForm": "Save failed: invalid form state.",
  "boot.remote.authenticated": "Authenticated. Server reports v{{version}}.",
  "boot.remote.headerSavedButNoVersion": "Header saved but server still did not return a version (auth proxy may need more headers).",
  "boot.remote.headerSavedButProbeFailed": "Header saved but probe still failed: {{message}}",
  "boot.remote.labelRequired": "Label is required",
  "boot.remote.urlRequired": "URL is required",
  "boot.remote.urlMustStart": "URL must start with http:// or https://",
  "boot.remote.optional": "(optional)",
  "boot.remote.usernameHint": "leave empty if the server does not use Basic Auth",
  "boot.remote.passwordHint": "leave empty if the server does not use Basic Auth",
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
