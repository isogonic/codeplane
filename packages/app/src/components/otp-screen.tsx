import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Mark } from "@codeplane-ai/ui/logo"
import { TextField } from "@codeplane-ai/ui/text-field"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"

// Second step of the login flow: after the password is accepted, the server
// reports that a TOTP second factor is required. This screen collects the
// 6-digit code from the user's authenticator app. Matches the LoginScreen
// styling (centered column, hairline inputs, primary action).
export function OtpScreen(props: {
  serverName: string
  error?: boolean
  busy?: boolean
  onSubmit: (code: string) => void
  onBack: () => void
}) {
  const language = useLanguage()
  const [code, setCode] = createSignal("")

  const normalized = () => code().replace(/\s+/g, "")
  const canSubmit = () => /^[0-9]{6}$/.test(normalized()) && !props.busy

  const submit = (event: Event) => {
    event.preventDefault()
    if (!canSubmit()) return
    props.onSubmit(normalized())
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base font-sans p-6">
      <form class="w-full max-w-xs flex flex-col items-stretch gap-7" onSubmit={submit} autocomplete="off">
        <div class="flex flex-col items-center gap-4 text-center">
          <Mark class="w-8 h-8 text-text-strong" />
          <div class="flex flex-col gap-1.5">
            <h1 class="text-16-medium text-text-strong">{language.t("login.otp.title")}</h1>
            <p class="text-13-regular text-text-weak">{language.t("login.otp.subtitle")}</p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <TextField
            label={language.t("login.otp.code")}
            name="otp"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder={language.t("login.otp.placeholder")}
            value={code()}
            onChange={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))}
            validationState={props.error ? "invalid" : "valid"}
            disabled={props.busy}
          />

          <Show when={props.error}>
            <div class="flex items-center gap-1.5 text-13-regular text-text-error-base">
              <Icon name="warning" size="x-small" />
              <span>{language.t("login.otp.error")}</span>
            </div>
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <Button type="submit" variant="primary" size="large" disabled={!canSubmit()} class="w-full justify-center">
            {props.busy ? language.t("login.otp.verifying") : language.t("login.otp.verify")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="large"
            disabled={props.busy}
            class="w-full justify-center"
            onClick={() => props.onBack()}
          >
            {language.t("login.otp.back")}
          </Button>
        </div>

        <p class="text-12-regular text-text-weak text-center">{language.t("login.otp.hint")}</p>
      </form>
    </div>
  )
}
