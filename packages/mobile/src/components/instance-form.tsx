import { Component, Show, createSignal, createEffect } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { formatHeaders, parseHeaders } from "@codeplane-ai/shared/headers"

/**
 * Full-screen edit form for a single instance.
 *
 * Mirrors the fields the desktop picker collects (label, URL, auth
 * headers, ignore-cert toggle) but with a stacked, scroll-friendly
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
  headersText: string
  ignoreCertificateErrors: boolean
  liveActivitiesEnabled: boolean
}

const draftFromInstance = (
  instance?: SavedInstance,
  plaintextHeaders?: Record<string, string>,
  liveActivitiesEnabled?: boolean,
): Draft => ({
  id: instance?.id ?? uid(),
  url: instance?.url ?? "",
  label: instance?.label ?? "",
  headersText: plaintextHeaders ? formatHeaders(plaintextHeaders) : "",
  ignoreCertificateErrors: !!instance?.ignoreCertificateErrors,
  liveActivitiesEnabled: liveActivitiesEnabled ?? true,
})

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
  onSubmit: (
    instance: SavedInstance,
    plaintextHeaders: Record<string, string>,
    prefs: { liveActivitiesEnabled: boolean },
  ) => void
  onCancel: () => void
  onDelete?: (id: string) => void
}> = (props) => {
  const [draft, setDraft] = createSignal<Draft>(
    draftFromInstance(props.instance, props.plaintextHeaders, props.liveActivitiesEnabled),
  )
  const [error, setError] = createSignal<string | null>(null)

  createEffect(() => {
    setDraft(draftFromInstance(props.instance, props.plaintextHeaders, props.liveActivitiesEnabled))
  })

  const submit = () => {
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
    let parsedHeaders: Record<string, string> = {}
    if (current.headersText.trim()) {
      try {
        parsedHeaders = parseHeaders(current.headersText)
      } catch (e) {
        setError(`Headers: ${(e as Error).message}`)
        return
      }
    }
    setError(null)
    const saved: SavedInstance = {
      id: current.id,
      url: normalizedUrl,
      label: current.label.trim() || undefined,
      headers: Object.keys(parsedHeaders).length ? parsedHeaders : undefined,
      ignoreCertificateErrors: current.ignoreCertificateErrors || undefined,
    }
    props.onSubmit(saved, parsedHeaders, {
      liveActivitiesEnabled: current.liveActivitiesEnabled,
    })
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
        submit()
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
          onInput={(e) => setDraft({ ...draft(), url: e.currentTarget.value })}
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
        <label class="mobile-label" for="cp-mobile-headers">
          Auth headers
        </label>
        <textarea
          id="cp-mobile-headers"
          class="mobile-textarea"
          rows={4}
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          placeholder={"CF-Access-Client-Id: …\nCF-Access-Client-Secret: …"}
          value={draft().headersText}
          onInput={(e) => setDraft({ ...draft(), headersText: e.currentTarget.value })}
        />
        <p class="mobile-help">
          One per line, formatted <code>Key: Value</code>. Stored in the OS keychain and attached to every
          request to this instance.
        </p>
      </div>

      <div class="mobile-setting-row">
        <div class="mobile-setting-row__body">
          <div class="mobile-setting-row__title">Allow self-signed certificates</div>
          <div class="mobile-setting-row__help">Only enable if you trust the server.</div>
        </div>
        <Switch
          ariaLabel="Allow self-signed certificates"
          checked={draft().ignoreCertificateErrors}
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
          onClick={() => props.onCancel()}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="mobile-button mobile-button--primary"
          style={{ flex: "1.4 1 0" }}
        >
          {props.instance ? "Save changes" : "Add server"}
        </button>
      </div>

      <Show when={props.instance && props.onDelete}>
        <div style={{ padding: "4px 16px 0" }}>
          <button
            type="button"
            class="mobile-button mobile-button--danger-ghost mobile-button--block"
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
