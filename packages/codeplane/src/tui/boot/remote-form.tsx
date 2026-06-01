// Create-/edit-remote-instance form. Remote login is intentionally limited to
// username + password, with OTP revealed only when the server asks for it.
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { checkRemoteAuth, composeRemoteAuthHeaders, splitRemoteAuthHeaders, verifyRemoteTotp, type VerifyRemoteTotpResult } from "@codeplane-ai/shared/remote-auth"
import { tuiT } from "@/tui/i18n"
import type { InstanceService } from "../instance-service"
import { Banner, Header, SectionHeading, StatusBar, TextField, ToggleField, useBootPalette } from "./primitives"

export type RemoteFormResult = { instance: SavedInstance } | { cancel: true }

type Field = "label" | "url" | "username" | "password" | "otp" | "ignoreCert" | "clearCache"
const FIELD_ORDER: Field[] = ["label", "url", "username", "password", "ignoreCert"]

type ProbeState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; version?: string }
  | { status: "error"; message: string }

function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (slug || fallback).slice(0, 32)
}

function isHttpUrl(input: string) {
  try {
    const parsed = new URL(input)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function decomposeExisting(existing?: SavedInstance) {
  const empty = {
    label: "",
    url: "",
    username: "",
    password: "",
    otpToken: "",
    ignoreCert: false,
  }
  if (!existing) return empty
  const auth = splitRemoteAuthHeaders(existing.headers)
  return {
    label: existing.label ?? "",
    url: existing.url ?? "",
    username: auth.username ?? "",
    password: auth.password ?? "",
    otpToken: auth.otpToken ?? "",
    ignoreCert: !!existing.ignoreCertificateErrors,
  }
}

export function RemoteInstanceForm(props: {
  service: InstanceService
  takenIds: Set<string>
  existing?: SavedInstance
  onDone: (result: RemoteFormResult) => void
}) {
  const palette = useBootPalette()
  const initial = decomposeExisting(props.existing)
  const [label, setLabel] = createSignal(initial.label)
  const [url, setUrl] = createSignal(initial.url)
  const [username, setUsername] = createSignal(initial.username)
  const [password, setPassword] = createSignal(initial.password)
  const [otpToken, setOtpToken] = createSignal(initial.otpToken)
  const [otpCode, setOtpCode] = createSignal("")
  const [otpVisible, setOtpVisible] = createSignal(false)
  const [ignoreCert, setIgnoreCert] = createSignal(initial.ignoreCert)
  const [focused, setFocused] = createSignal<Field>("label")
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)
  const [probe, setProbe] = createSignal<ProbeState>({ status: "idle" })
  const [cacheInfo, setCacheInfo] = createSignal<Awaited<ReturnType<InstanceService["cacheInfo"]>>>()
  const [cacheNotice, setCacheNotice] = createSignal<{ ok: boolean; message: string }>()
  const [clearingCache, setClearingCache] = createSignal(false)
  const cacheAvailable = createMemo(() => !!props.existing && !!cacheInfo()?.exists)
  const fields = createMemo(() => {
    const next = FIELD_ORDER.slice()
    if (otpVisible()) next.splice(next.indexOf("ignoreCert"), 0, "otp")
    if (!cacheAvailable()) return next
    next.splice(next.indexOf("ignoreCert"), 0, "clearCache")
    return next
  })
  const busy = createMemo(() => saving() || probe().status === "checking" || clearingCache())
  const editingLocalManaged = createMemo(() => !!props.existing?.local)

  const refreshCacheInfo = async () => {
    if (!props.existing) return
    try {
      setCacheInfo(await props.service.cacheInfo(props.existing.id))
    } catch (err) {
      setCacheInfo({ exists: false, bytes: 0, areas: [] })
      setCacheNotice({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  onMount(() => void refreshCacheInfo())

  const valueFor = (f: Field) =>
    f === "label"
      ? label()
      : f === "url"
        ? url()
        : f === "username"
          ? username()
          : f === "password"
            ? password()
            : f === "otp"
              ? otpCode()
              : ""
  const setterFor = (f: Field) =>
    f === "label"
      ? setLabel
      : f === "url"
        ? (v: string) => {
            setUrl(v)
            setOtpToken("")
            setOtpCode("")
            setOtpVisible(false)
          }
        : f === "username"
          ? (v: string) => {
              setUsername(v)
              setOtpToken("")
              setOtpCode("")
            }
          : f === "password"
            ? (v: string) => {
                setPassword(v)
                setOtpToken("")
                setOtpCode("")
              }
            : f === "otp"
              ? setOtpCode
              : (() => {}) as (v: string) => void

  const composedHeaders = (): Record<string, string> | undefined => {
    return composeRemoteAuthHeaders({
      username: username(),
      password: password(),
      otpToken: otpToken(),
    })
  }

  const buildInstance = (): SavedInstance | undefined => {
    const trimmedLabel = label().trim()
    if (!trimmedLabel) {
      setError(tuiT("boot.remote.labelRequired"))
      setFocused("label")
      return undefined
    }
    const trimmedUrl = url().trim()
    if (!trimmedUrl) {
      setError(tuiT("boot.remote.urlRequired"))
      setFocused("url")
      return undefined
    }
    if (!isHttpUrl(trimmedUrl)) {
      setError(tuiT("boot.remote.urlMustStart"))
      setFocused("url")
      return undefined
    }
    let id = props.existing?.id
    if (!id) {
      const slug = slugify(trimmedLabel, "remote")
      id = slug
      let n = 1
      while (props.takenIds.has(id)) {
        n += 1
        id = `${slug}-${n}`
      }
    }
    return {
      ...props.existing,
      id,
      url: trimmedUrl,
      label: trimmedLabel,
      headers: composedHeaders(),
      ignoreCertificateErrors: ignoreCert() || undefined,
    }
  }

  const headersWithoutOtp = () =>
    composeRemoteAuthHeaders({
      username: username(),
      password: password(),
    })

  const otpFailureMessage = (reason: Extract<VerifyRemoteTotpResult, { ok: false }>["reason"]) =>
    reason === "invalid-code"
      ? tuiT("boot.remote.authOtpInvalid")
      : reason === "rate-limited"
        ? tuiT("boot.remote.authOtpRateLimited")
        : tuiT("boot.remote.authOtpFailed")

  const resolveAuthHeaders = async (
    candidate: SavedInstance,
  ): Promise<{ ok: true; headers?: Record<string, string> } | { ok: false; message: string }> => {
    const status = await checkRemoteAuth({ url: candidate.url, headers: candidate.headers }, fetch, { timeoutMs: 8000 })
    if (!status.reachable) return { ok: true, headers: candidate.headers }
    if (!status.required) {
      setOtpVisible(false)
      setOtpToken("")
      setOtpCode("")
      return { ok: true, headers: headersWithoutOtp() }
    }
    if (status.authenticated && !status.totpRequired) {
      setOtpVisible(false)
      setOtpToken("")
      setOtpCode("")
      return { ok: true, headers: headersWithoutOtp() }
    }
    if (!status.passwordValid || !status.totpRequired) {
      setOtpVisible(false)
      setOtpToken("")
      return { ok: false, message: tuiT("boot.remote.authInvalidPassword") }
    }
    setOtpVisible(true)
    if (!otpCode().trim()) {
      setFocused("otp")
      return { ok: false, message: tuiT("boot.remote.authOtpRequired") }
    }
    const verified = await verifyRemoteTotp(
      {
        url: candidate.url,
        username: username(),
        password: password(),
        code: otpCode(),
      },
      fetch,
      { timeoutMs: 8000 },
    )
    if (!verified.ok) return { ok: false, message: otpFailureMessage(verified.reason) }
    setOtpToken(verified.token)
    setOtpCode("")
    return {
      ok: true,
      headers: composeRemoteAuthHeaders({
        username: username(),
        password: password(),
        otpToken: verified.token,
      }),
    }
  }

  const probeNow = async () => {
    if (busy()) return
    setError(undefined)
    const candidate = buildInstance()
    if (!candidate) return
    setProbe({ status: "checking" })
    try {
      const auth = await resolveAuthHeaders(candidate)
      if (!auth.ok) {
        setProbe({ status: "error", message: auth.message })
        return
      }
      const result = await props.service.probe({ ...candidate, headers: auth.headers })
      if (!result.ok) {
        setProbe({
          status: "error",
          message: result.status ? `HTTP ${result.status}` : result.error || "Unreachable",
        })
        return
      }
      setProbe({ status: "ok", version: result.version ?? undefined })
    } catch (err) {
      setProbe({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const save = async () => {
    if (busy()) return
    setError(undefined)
    const candidate = buildInstance()
    if (!candidate) return
    setSaving(true)
    try {
      const auth = await resolveAuthHeaders(candidate)
      if (!auth.ok) {
        setError(auth.message)
        return
      }
      const instance = { ...candidate, headers: auth.headers }
      await props.service.save(instance)
      props.onDone({ instance })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const clearCache = async () => {
    if (!props.existing || busy()) return
    setClearingCache(true)
    setCacheNotice(undefined)
    try {
      const cleared = await props.service.clearCache(props.existing.id)
      setCacheNotice({
        ok: true,
        message: tuiT("boot.remote.clearCacheNotice", { size: (cleared.bytes / 1024 / 1024).toFixed(1) }),
      })
      await refreshCacheInfo()
      if (focused() === "clearCache") setFocused("ignoreCert")
    } catch (err) {
      setCacheNotice({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setClearingCache(false)
    }
  }

  const moveFocus = (delta: 1 | -1) => {
    const order = fields()
    const idx = Math.max(0, order.indexOf(focused()))
    const next = (idx + delta + order.length) % order.length
    setFocused(order[next])
  }

  // Single-source keyboard handler for the form. Action keys (Ctrl+S,
  // Ctrl+P, Esc, Tab) work regardless of which field is focused; field
  // editing keys mutate the focused field's signal.
  useKeyboard((evt) => {
    if (busy()) {
      if (evt.ctrl && evt.name === "c") props.onDone({ cancel: true })
      return
    }

    if (evt.ctrl && evt.name === "c") return props.onDone({ cancel: true })
    if (evt.name === "escape") return props.onDone({ cancel: true })
    if (evt.name === "tab") return moveFocus(1)
    if (evt.name === "up") return moveFocus(-1)
    if (evt.name === "down") return moveFocus(1)
    if (evt.ctrl && evt.name === "s") return void save()
    if (evt.ctrl && evt.name === "p") return void probeNow()
    if (evt.ctrl && evt.name === "k" && cacheAvailable()) return void clearCache()

    const f = focused()

    // Non-text fields handle their own keys.
    if (f === "ignoreCert") {
      if (evt.name === "space" || evt.sequence === " ") {
        setIgnoreCert(!ignoreCert())
        if (probe().status !== "idle") setProbe({ status: "idle" })
        return
      }
      if (evt.name === "return") {
        setIgnoreCert(!ignoreCert())
        if (probe().status !== "idle") setProbe({ status: "idle" })
        return
      }
      return
    }
    if (f === "clearCache") {
      if (evt.name === "return" || evt.name === "space" || evt.sequence === " ") {
        return void clearCache()
      }
      return
    }
    // Single-line text fields: label / url / username / password / OTP.
    const get = valueFor
    const set = setterFor(f)
    if (evt.name === "backspace") {
      set(get(f).slice(0, -1))
      if (probe().status !== "idle") setProbe({ status: "idle" })
      return
    }
    if (evt.ctrl && evt.name === "u") {
      set("")
      if (probe().status !== "idle") setProbe({ status: "idle" })
      return
    }
    if (evt.name === "return") {
      // Enter on the last single-line field saves; otherwise advance.
      moveFocus(1)
      return
    }
    if (evt.sequence && !evt.ctrl && !evt.meta && evt.sequence.length >= 1) {
      // Filter control characters while preserving printable chars
      // from bracketed paste. Newlines don't make sense in any of
      // these fields, so they're stripped.
      const cleaned = evt.sequence.replace(/[\x00-\x1f\x7f]/g, "")
      if (cleaned) {
        set(get(f) + cleaned)
        if (probe().status !== "idle") setProbe({ status: "idle" })
      }
    }
  })

  // Mask the password field so it doesn't leak over someone's shoulder
  // or into screen-share / terminal recordings. Length-preserving keeps
  // enough cursor/length feedback without exposing any trailing secret char.
  const passwordDisplay = createMemo(() => {
    const value = password()
    return value ? "•".repeat(value.length) : ""
  })

  const probeBanner = createMemo(() => {
    const p = probe()
    if (p.status === "checking") return { variant: "info" as const, text: tuiT("boot.remote.probing") }
    if (p.status === "ok")
      return {
        variant: "success" as const,
        text: p.version
          ? tuiT("boot.remote.probeOk", { version: p.version })
          : tuiT("boot.remote.probeOkNoVersion"),
      }
    if (p.status === "error") return { variant: "error" as const, text: tuiT("boot.remote.probeFailed", { message: p.message }) }
    return undefined
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette().bg}>
      <Header
        instance="setup"
        cwd={props.existing ? `edit ${props.existing.id}` : "new remote instance"}
        status={props.existing ? "Edit" : "Form"}
        statusColor={palette().info}
      />
      <SectionHeading>
        {props.existing
          ? editingLocalManaged()
            ? tuiT("boot.remote.heading.editAccess")
            : tuiT("boot.remote.heading.edit")
          : tuiT("boot.remote.heading.new")}
      </SectionHeading>

      <Show when={editingLocalManaged()}>
        <box marginTop={1}>
          <Banner variant="info">{tuiT("boot.remote.localManagedHint")}</Banner>
        </box>
      </Show>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.remote.label")}
          value={label()}
          focused={focused() === "label"}
          placeholder="My Codeplane Server"
          hint={tuiT("boot.local.labelHint")}
          validate={() => ({ ok: !!label().trim(), message: label().trim() ? undefined : tuiT("common.required") })}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.remote.url")}
          value={url()}
          focused={focused() === "url"}
          placeholder={tuiT("boot.remote.urlPlaceholder")}
          hint={tuiT("boot.remote.urlHint")}
          validate={() => {
            const v = url().trim()
            if (!v) return { ok: false, message: tuiT("common.required") }
            if (!isHttpUrl(v)) return { ok: false, message: tuiT("boot.remote.urlMustStart") }
            return { ok: true }
          }}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.remote.username")}
          value={username()}
          focused={focused() === "username"}
          placeholder={tuiT("boot.remote.optional")}
          hint={tuiT("boot.remote.usernameHint")}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.remote.password")}
          value={passwordDisplay()}
          focused={focused() === "password"}
          placeholder={tuiT("boot.remote.optional")}
          hint={password() ? tuiT("boot.remote.passwordMaskedHint") : tuiT("boot.remote.passwordHint")}
        />
      </box>

      <box marginTop={1} paddingX={2}>
        <text fg={palette().fgDim}>{tuiT("boot.remote.loginHint")}</text>
      </box>

      <Show when={otpVisible()}>
        <box marginTop={1}>
          <TextField
            label={tuiT("boot.remote.otp")}
            value={otpCode()}
            focused={focused() === "otp"}
            placeholder={otpToken() ? tuiT("boot.remote.otpVerified") : "123456"}
            hint={otpToken() ? tuiT("boot.remote.otpVerifiedHint") : tuiT("boot.remote.otpHint")}
          />
        </box>
      </Show>

      <box marginTop={1}>
        <ToggleField
          label={tuiT("boot.remote.ignoreCert")}
          value={ignoreCert()}
          focused={focused() === "ignoreCert"}
          hint={tuiT("boot.remote.ignoreCertHint")}
        />
      </box>

      <Show when={cacheAvailable()}>
        <box marginTop={1} paddingX={2} flexDirection="row">
          <text fg={focused() === "clearCache" ? palette().accent : palette().fgDim}>
            {focused() === "clearCache" ? "▍ " : "  "}
          </text>
          <text fg={focused() === "clearCache" ? palette().fg : palette().fgMuted}>
            [ {tuiT("boot.remote.clearCache")} ]
          </text>
          <text fg={palette().fgDim}>
            {`  ${tuiT("boot.remote.clearCacheSummary", {
              size: (cacheInfo()!.bytes / 1024 / 1024).toFixed(1),
            })}`}
          </text>
        </box>
      </Show>

      <Show when={probeBanner()}>
        <box marginTop={1}>
          <Banner variant={probeBanner()!.variant}>{probeBanner()!.text}</Banner>
        </box>
      </Show>

      <Show when={cacheNotice()}>
        <box marginTop={1}>
          <Banner variant={cacheNotice()!.ok ? "success" : "error"}>{cacheNotice()!.message}</Banner>
        </box>
      </Show>

      <Show when={error()}>
        <box marginTop={1}>
          <Banner variant="error">{error()!}</Banner>
        </box>
      </Show>

      <box flexGrow={1} />
      <StatusBar
        hints={[
          { keys: "ctrl+s", label: tuiT("common.save") },
          { keys: "ctrl+p", label: tuiT("common.probe") },
          ...(cacheAvailable() ? [{ keys: "ctrl+k", label: tuiT("boot.remote.clearCache") }] : []),
          { keys: "tab/↑↓", label: tuiT("common.navigate") },
          { keys: "esc", label: tuiT("common.cancel") },
          { keys: "ctrl+c", label: tuiT("common.quit") },
        ]}
      />
    </box>
  )
}
