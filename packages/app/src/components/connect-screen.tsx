import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Mark } from "@codeplane-ai/ui/logo"
import { TextField } from "@codeplane-ai/ui/text-field"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { looksConnectable, parseConnectTarget } from "@/utils/connect-target"

export type ConnectSubmit = { url: string; label: string }

// First step of the simplified login flow: one smart field that accepts
// "local", a bare IP, or a domain (auto-adds http/https + a default local
// port), then a single Sign In button. Pressing Sign In probes the target and
// the AuthGate advances to the password step (or straight into the app if the
// server needs no auth).
//
// Matches LoginScreen styling: centered column, hairline input, primary
// action button — no cards or shadows.
export function ConnectScreen(props: {
  initial?: string
  error?: boolean
  busy?: boolean
  onSubmit: (input: ConnectSubmit) => void
}) {
  const language = useLanguage()
  const [value, setValue] = createSignal(props.initial ?? "")

  const canSubmit = () => looksConnectable(value()) && !props.busy

  const submit = (event: Event) => {
    event.preventDefault()
    const target = parseConnectTarget(value())
    if (!target || props.busy) return
    props.onSubmit(target)
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base font-sans p-6">
      <form class="w-full max-w-xs flex flex-col items-stretch gap-7" onSubmit={submit} autocomplete="off">
        <div class="flex flex-col items-center gap-4 text-center">
          <Mark class="w-8 h-8 text-text-strong" />
          <div class="flex flex-col gap-1.5">
            <h1 class="text-16-medium text-text-strong">{language.t("connect.title")}</h1>
            <p class="text-13-regular text-text-weak">{language.t("connect.subtitle")}</p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <TextField
            label={language.t("connect.address")}
            name="server"
            inputmode="url"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            placeholder={language.t("connect.placeholder")}
            value={value()}
            onChange={setValue}
            validationState={props.error ? "invalid" : "valid"}
            disabled={props.busy}
          />

          <Show
            when={props.error}
            fallback={<p class="text-12-regular text-text-weak">{language.t("connect.hint")}</p>}
          >
            <div class="flex items-center gap-1.5 text-13-regular text-text-error-base">
              <Icon name="warning" size="x-small" />
              <span>{language.t("connect.error")}</span>
            </div>
          </Show>
        </div>

        <Button type="submit" variant="primary" size="large" disabled={!canSubmit()} class="w-full justify-center">
          {props.busy ? language.t("connect.connecting") : language.t("connect.signIn")}
        </Button>
      </form>
    </div>
  )
}
