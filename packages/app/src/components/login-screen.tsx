import { Button } from "@codeplane-ai/ui/button"
import { Icon } from "@codeplane-ai/ui/icon"
import { Mark } from "@codeplane-ai/ui/logo"
import { TextField } from "@codeplane-ai/ui/text-field"
import { createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"

export type LoginSubmit = { username: string; password: string }

// Clean, minimal, card-less sign-in screen. Replaces the browser's native
// HTTP Basic Auth popup with an in-app form that matches the rest of the
// Codeplane design (centered column, hairline-bordered inputs, primary
// action button — no boxes or drop shadows).
export function LoginScreen(props: {
  serverName: string
  error?: boolean
  busy?: boolean
  notice?: string
  onSubmit: (input: LoginSubmit) => void
}) {
  const language = useLanguage()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [reveal, setReveal] = createSignal(false)

  const canSubmit = () => password().length > 0 && !props.busy

  const submit = (event: Event) => {
    event.preventDefault()
    if (!canSubmit()) return
    props.onSubmit({ username: username().trim(), password: password() })
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base font-sans p-6">
      <form class="w-full max-w-xs flex flex-col items-stretch gap-7" onSubmit={submit} autocomplete="on">
        <div class="flex flex-col items-center gap-4 text-center">
          <Mark class="w-8 h-8 text-text-strong" />
          <div class="flex flex-col gap-1.5">
            <h1 class="text-16-medium text-text-strong">{language.t("login.title")}</h1>
            <p class="text-13-regular text-text-weak">
              {language.t("login.subtitle", { server: props.serverName })}
            </p>
          </div>
        </div>

        <Show when={props.notice}>
          <div class="flex items-center gap-1.5 text-13-regular text-text-base bg-surface-base rounded-md px-3 py-2">
            <Icon name="warning" size="x-small" />
            <span>{props.notice}</span>
          </div>
        </Show>

        <div class="flex flex-col gap-3">
          <TextField
            label={language.t("login.username")}
            name="username"
            autocomplete="username"
            placeholder={language.t("login.usernamePlaceholder")}
            value={username()}
            onChange={setUsername}
            disabled={props.busy}
          />

          <div class="relative">
            <TextField
              label={language.t("login.password")}
              name="password"
              type={reveal() ? "text" : "password"}
              autocomplete="current-password"
              placeholder={language.t("login.passwordPlaceholder")}
              value={password()}
              onChange={setPassword}
              validationState={props.error ? "invalid" : "valid"}
              disabled={props.busy}
            />
            <button
              type="button"
              tabindex={-1}
              class="absolute right-2.5 bottom-1.5 size-7 flex items-center justify-center rounded-md text-text-weak hover:text-text-strong transition-colors"
              aria-label={reveal() ? language.t("login.hidePassword") : language.t("login.showPassword")}
              onClick={() => setReveal((v) => !v)}
            >
              <Icon name={reveal() ? "glasses" : "eye"} size="small" />
            </button>
          </div>

          <Show when={props.error}>
            <div class="flex items-center gap-1.5 text-13-regular text-text-error-base">
              <Icon name="warning" size="x-small" />
              <span>{language.t("login.error")}</span>
            </div>
          </Show>
        </div>

        <Button type="submit" variant="primary" size="large" disabled={!canSubmit()} class="w-full justify-center">
          {props.busy ? language.t("login.signingIn") : language.t("login.signIn")}
        </Button>

        <p class="text-12-regular text-text-weak text-center">{language.t("login.hint")}</p>
      </form>
    </div>
  )
}
