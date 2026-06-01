import { Component, Show, createSignal, createEffect } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { composeRemoteAuthHeaders, splitRemoteAuthHeaders, type VerifyRemoteTotpResult } from "@codeplane-ai/shared/remote-auth"
import type { CodeplaneMobileAPI } from "../platform/api"

/**
 * Full-screen edit form for a single instance.
 *
 * Mirrors the fields the desktop picker collects (label, URL, username,
 * password, conditional OTP, ignore-cert toggle) but with a stacked, scroll-friendly
 * layout. We deliberately don't reuse the desktop's two-column layout
 * here — on phones it just compresses to garbage.
 *
 * Saving emits a `SavedInstance` with the current header dictionary;
 * the platform store splits secrets out before persisting.
 *
 * Styling uses the `mobile-*` classes defined in `styles/mobile.css`
 * so this component stays free of inline visual tokens — change the
 * brand accent in one place and every form picks it up.
 */
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

type Draft = {
  id: string
  url: string
  label: string
  username: string
  password: string
  otpToken: string
  otpCode: string
  otpVisible: boolean
  ignoreCertificateErrors: boolean
  liveActivitiesEnabled: boolean
}

const draftFromInstance = (
  instance?: SavedInstance,
  plaintextHeaders?: Record<string, string>,
  liveActivitiesEnabled?: boolean,
): Draft => {
  const auth = splitRemoteAuthHeaders(plaintextHeaders)
  return {
    id: instance?.id ?? uid(),
    url: instance?.url ?? "",
    label: instance?.label ?? "",
    username: auth.username ?? "",
    password: auth.password ?? "",
    otpToken: auth.otpToken ?? "",
    otpCode: "",
    otpVisible: false,
    ignoreCertificateErrors: !!instance?.ignoreCertificateErrors,
    liveActivitiesEnabled: liveActivitiesEnabled ?? true,
  }
}

export const InstanceForm: Component<{
  instance?: SavedInstance
  /**
   * Plaintext auth headers, fetched from the secure store right before
   * the form opens. We require the parent to fetch+pass them so the
   * form itself never touches the keychain directly.
   */
  plaintextHeaders?: Record<string, string>
  /** Initial value of the per-instance Live Activities toggle. */
  liveActivitiesEnabled?: boolean
  /** Whether the device actually supports Live Activities (iOS 16.2+). */
  liveActivitiesSupported?: boolean
  authStatus: CodeplaneMobileAPI["instances"]["authStatus"]
  verifyOtp: CodeplaneMobileAPI["instances"]["verifyOtp"]
  onSubmit: (
    instance: SavedInstance,
    plaintextHeaders: Record<string, string>,
    prefs: { liveActivitiesEnabled: boolean },
  ) => void | Promise<void>
  onCancel: () => void
  onDelete?: (id: string) => void
}> = (props) => {
  const [draft, setDraft] = createSignal<Draft>(
    draftFromInstance(props.instance, props.plaintextHeaders, props.liveActivitiesEnabled),
  )
  const [error, setError] = createSignal<string | null>(null)
  const [saving, setSaving] = createSignal(false)

  createEffect(() => {
    setDraft(draftFromInstance(props.instance, props.plaintextHeaders, props.liveActivitiesEnabled))
  })

  const authHeaders = (current: Draft, otpToken = current.otpToken) =>
    composeRemoteAuthHeaders({
      username: current.username,
      password: current.password,
      otpToken,
    }) ?? {}

  const authHeadersWithoutOtp = (current: Draft) =>
    composeRemoteAuthHeaders({
      username: current.username,
      password: current.password,
    }) ?? {}

  const otpFailureMessage = (reason: Extract<VerifyRemoteTotpResult, { ok: false }>["reason"]) =>
    reason === "invalid-code"
      ? "One-time code is incorrect."
      : reason === "rate-limited"
        ? "Too many attempts. Try again later."
        : "Could not verify the one-time code."

  const resolveAuthHeaders = async (instance: SavedInstance, current: Draft) => {
    const status = await props.authStatus(instance)
    if (!status.reachable) return { ok: true as const, headers: authHeaders(current) }
    if (!status.required) {
      setDraft({ ...draft(), otpVisible: false, otpToken: "", otpCode: "" })
      return { ok: true as const, headers: authHeadersWithoutOtp(current) }
    }
    if (status.authenticated && !status.totpRequired) {
      setDraft({ ...draft(), otpVisible: false, otpToken: "", otpCode: "" })
      return { ok: true as const, headers: authHeadersWithoutOtp(current) }
    }
    if (!status.passwordValid || !status.totpRequired) {
      setDraft({ ...draft(), otpVisible: false, otpToken: "" })
      return { ok: false as const, message: "Username or password is incorrect." }
    }
    setDraft({ ...draft(), otpVisible: true })
    if (!current.otpCode.trim()) return { ok: false as const, message: "Enter the one-time code for this server." }
    const verified = await props.verifyOtp({
      instance: { ...instance, headers: authHeadersWithoutOtp(current) },
      code: current.otpCode,
    })
    if (!verified.ok) return { ok: false as const, message: otpFailureMessage(verified.reason) }
    setDraft({ ...draft(), otpVisible: true, otpToken: verified.token, otpCode: "" })
    return { ok: true as const, headers: authHeaders(current, verified.token) }
  }

  const submit = async () => {
    if (saving()) return
    const current = draft()
    if (!current.url.trim()) {
      setError("Server URL is required")
      return
    }
    let normalizedUrl: string
    try {
      const parsed = new URL(current.url.trim())
      normalizedUrl = parsed.toString().replace(/\/$/, "")
    } catch {
      setError("Server URL must be a valid URL (https://…)")
      return
    }
    setError(null)
    setSaving(true)
    try {
      const saved: SavedInstance = {
        id: current.id,
        url: normalizedUrl,
        label: current.label.trim() || undefined,
        headers: Object.keys(authHeaders(current)).length ? authHeaders(current) : undefined,
        ignoreCertificateErrors: current.ignoreCertificateErrors || undefined,
      }
      const auth = await resolveAuthHeaders(saved, current)
      if (!auth.ok) {
        setError(auth.message)
        return
      }
      const headers = auth.headers
      await props.onSubmit(
        {
          ...saved,
          headers: Object.keys(headers).length ? headers : undefined,
        },
        headers,
        {
          liveActivitiesEnabled: current.liveActivitiesEnabled,
        },
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      class="mobile-scroll"
      style={{
        flex: "1 1 auto",
        display: "flex",
        "flex-direction": "column",
        gap: "16px",
        padding: "8px 0 16px",
      }}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div class="mobile-field">
        <label class="mobile-label" for="cp-mobile-url">
          Server URL
        </label>
        <input
          id="cp-mobile-url"
          class="mobile-input"
          type="url"
          inputmode="url"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          required
          placeholder="https://codeplane.example.com"
          value={draft().url}
          onInput={(e) => setDraft({ ...draft(), url: e.currentTarget.value, otpToken: "", otpCode: "", otpVisible: false })}
        />
      </div>

      <div class="mobile-field">
        <label class="mobile-label" for="cp-mobile-label">
          Label (optional)
        </label>
        <input
          id="cp-mobile-label"
          class="mobile-input"
          type="text"
          autocapitalize="words"
          placeholder="Production"
          value={draft().label}
          onInput={(e) => setDraft({ ...draft(), label: e.currentTarget.value })}
        />
      </div>

      <div class="mobile-field">
        <label class="mobile-label" for="cp-mobile-username">
          Username
        </label>
        <input
          id="cp-mobile-username"
          class="mobile-input"
          type="text"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          autocomplete="username"
          placeholder="codeplane"
          value={draft().username}
          onInput={(e) => setDraft({ ...draft(), username: e.currentTarget.value, otpToken: "", otpCode: "" })}
        />
      </div>

      <div class="mobile-field">
        <label class="mobile-label" for="cp-mobile-password">
          Password
        </label>
        <input
          id="cp-mobile-password"
          class="mobile-input"
          type="password"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          autocomplete="current-password"
          placeholder="Password"
          value={draft().password}
          onInput={(e) => setDraft({ ...draft(), password: e.currentTarget.value, otpToken: "", otpCode: "" })}
        />
        <p class="mobile-help">
          Use the credentials from <code>codeplane serve --password</code>. The one-time code field appears
          only when the server requires it.
        </p>
      </div>

      <Show when={draft().otpVisible}>
        <div class="mobile-field">
          <label class="mobile-label" for="cp-mobile-otp">
            One-time code
          </label>
          <input
            id="cp-mobile-otp"
            class="mobile-input"
            type="text"
            inputmode="numeric"
            autocapitalize="none"
            autocorrect="off"
            spellcheck={false}
            autocomplete="one-time-code"
            placeholder={draft().otpToken ? "OTP verified" : "123456"}
            value={draft().otpCode}
            onInput={(e) => setDraft({ ...draft(), otpCode: e.currentTarget.value })}
          />
        </div>
      </Show>

      <div class="mobile-setting-row">
        <div class="mobile-setting-row__body">
          <div class="mobile-setting-row__title">Allow self-signed certificates</div>
          <div class="mobile-setting-row__help">Only enable if you trust the server.</div>
        </div>
        <Switch
          ariaLabel="Allow self-signed certificates"
          checked={draft().ignoreCertificateErrors}
          disabled={saving()}
          onChange={(v) => setDraft({ ...draft(), ignoreCertificateErrors: v })}
        />
      </div>

      <Show when={props.liveActivitiesSupported !== false}>
        <div class="mobile-setting-row">
          <div class="mobile-setting-row__body">
            <div class="mobile-setting-row__title">Live Activities</div>
            <div class="mobile-setting-row__help">
              Show queue depth and progress on the Lock Screen and Dynamic Island for long-running tasks.
              iOS 16.2+ only.
            </div>
          </div>
          <Switch
            ariaLabel="Live Activities"
            checked={draft().liveActivitiesEnabled}
            disabled={saving()}
            onChange={(v) => setDraft({ ...draft(), liveActivitiesEnabled: v })}
          />
        </div>
      </Show>

      <Show when={error()}>
        <div role="alert" class="mobile-alert mobile-alert--danger">
          <span aria-hidden style={{ "font-weight": 700, "margin-top": "1px" }}>
            !
          </span>
          <span>{error()}</span>
        </div>
      </Show>

      <div style={{ display: "flex", gap: "10px", padding: "4px 16px 0" }}>
        <button
          type="button"
          class="mobile-button mobile-button--secondary"
          style={{ flex: "1 1 0" }}
          disabled={saving()}
          onClick={() => props.onCancel()}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="mobile-button mobile-button--primary"
          style={{ flex: "1.4 1 0" }}
          disabled={saving()}
        >
          {saving() ? "Saving..." : props.instance ? "Save changes" : "Add server"}
        </button>
      </div>

      <Show when={props.instance && props.onDelete}>
        <div style={{ padding: "4px 16px 0" }}>
          <button
            type="button"
            class="mobile-button mobile-button--danger-ghost mobile-button--block"
            disabled={saving()}
            onClick={() => props.onDelete?.(props.instance!.id)}
          >
            Remove this server
          </button>
        </div>
      </Show>
    </form>
  )
}

/**
 * Self-contained iOS-style switch. Driven by an invisible
 * `<input type="checkbox">` for native a11y/keyboard support, with the
 * pill+thumb painted by the sibling `.mobile-switch__track`.
 */
const Switch: Component<{
  checked: boolean
  ariaLabel: string
  disabled?: boolean
  onChange: (next: boolean) => void
}> = (props) => {
  return (
    <label class="mobile-switch" aria-label={props.ariaLabel}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="mobile-switch__track" aria-hidden />
    </label>
  )
}
