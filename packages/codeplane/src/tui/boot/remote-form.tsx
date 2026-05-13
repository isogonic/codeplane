// Create-/edit-remote-instance form. Functional mirror of the desktop's
// `InstanceForm` (packages/desktop/src/setup/app.tsx) for the
// remote-server case: pick a label + URL + optional Basic Auth
// (username / password) + optional free-form headers + optional
// trust-self-signed-certs toggle. Validates via `service.probe()`,
// saves, returns.
//
// In-TUI sign-in flow: the "Sign in via browser" action opens the
// instance URL in the user's default browser and accepts a pasted
// header line back. The pasted value is merged into the headers blob
// (deduped by header name) and re-probed so the user gets immediate
// confirmation that the auth header satisfies the auth proxy.
//
// Editing: pass `existing` to pre-fill all fields and update in place
// instead of allocating a new id.
import { createMemo, createSignal, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import open from "open"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { InstanceService } from "../instance-service"
import { Banner, Header, palette, SectionHeading, StatusBar, TextField, ToggleField } from "./primitives"

export type RemoteFormResult = { instance: SavedInstance } | { cancel: true }

type Field = "label" | "url" | "username" | "password" | "headers" | "ignoreCert" | "signin"
const FIELD_ORDER: Field[] = ["label", "url", "username", "password", "headers", "ignoreCert", "signin"]

type ProbeState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; version?: string }
  | { status: "error"; message: string }

type SigninPhase =
  | { kind: "idle" }
  | { kind: "browser-open"; url: string }
  | { kind: "paste"; pasted: string }
  | { kind: "verifying" }
  | { kind: "result"; ok: boolean; message: string }

function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (slug || fallback).slice(0, 32)
}

function basicAuthHeader(user: string, pass: string): string {
  // Matches the desktop's `composedHeaders` formatting and the CLI's
  // `composeRemoteHeaders` so a TUI-saved instance authenticates the
  // same way against the same server as one created from any other
  // surface.
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`
}

// Parse a free-form headers blob (one `Name: value` per line) into a
// case-preserving record. Blank lines and leading/trailing whitespace
// are tolerated. Lines without a colon are silently skipped — same
// behaviour as the desktop form's `parseHeaders`.
function parseHeaderLines(blob: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of blob.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!name) continue
    out[name] = value
  }
  return out
}

// Pretty-print a record back to a `Name: value` blob. Stable insertion
// order so re-rendering the form after edit shows the same lines the
// user (or a previous Sign-in) typed.
function formatHeaderLines(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
}

// Decompose a saved instance into form values: split the basic-auth
// `Authorization` header back out into username/password if it's in
// the canonical `Basic base64(user:pass)` form, leave anything else in
// the headers blob.
function decomposeExisting(existing?: SavedInstance) {
  const empty = {
    label: "",
    url: "",
    username: "",
    password: "",
    headersText: "",
    ignoreCert: false,
  }
  if (!existing) return empty
  const headers = { ...existing.headers }
  let username = ""
  let password = ""
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization")
  if (authKey) {
    const value = headers[authKey] ?? ""
    const match = /^\s*Basic\s+(.+)\s*$/i.exec(value)
    if (match) {
      try {
        const decoded = Buffer.from(match[1] ?? "", "base64").toString("utf8")
        const colon = decoded.indexOf(":")
        if (colon >= 0) {
          username = decoded.slice(0, colon)
          password = decoded.slice(colon + 1)
          delete headers[authKey]
        }
      } catch {
        // not valid base64 — leave the header as-is for the blob
      }
    }
  }
  return {
    label: existing.label ?? "",
    url: existing.url ?? "",
    username,
    password,
    headersText: formatHeaderLines(headers),
    ignoreCert: !!existing.ignoreCertificateErrors,
  }
}

export function RemoteInstanceForm(props: {
  service: InstanceService
  takenIds: Set<string>
  existing?: SavedInstance
  onDone: (result: RemoteFormResult) => void
}) {
  const initial = decomposeExisting(props.existing)
  const [label, setLabel] = createSignal(initial.label)
  const [url, setUrl] = createSignal(initial.url)
  const [username, setUsername] = createSignal(initial.username)
  const [password, setPassword] = createSignal(initial.password)
  const [headersText, setHeadersText] = createSignal(initial.headersText)
  const [ignoreCert, setIgnoreCert] = createSignal(initial.ignoreCert)
  const [focused, setFocused] = createSignal<Field>("label")
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)
  const [probe, setProbe] = createSignal<ProbeState>({ status: "idle" })
  const [signin, setSignin] = createSignal<SigninPhase>({ kind: "idle" })
  const busy = createMemo(() => saving() || probe().status === "checking" || signin().kind === "verifying")
  const inSignin = createMemo(() => {
    const s = signin().kind
    return s === "browser-open" || s === "paste"
  })

  const valueFor = (f: Field) =>
    f === "label"
      ? label()
      : f === "url"
        ? url()
        : f === "username"
          ? username()
          : f === "password"
            ? password()
            : f === "headers"
              ? headersText()
              : ""
  const setterFor = (f: Field) =>
    f === "label"
      ? setLabel
      : f === "url"
        ? setUrl
        : f === "username"
          ? setUsername
          : f === "password"
            ? setPassword
            : f === "headers"
              ? setHeadersText
              : (() => {}) as (v: string) => void

  // Compose the final headers map saved on the instance:
  //   - Start from the parsed `headersText` blob (lets the user supply
  //     any number of free-form auth headers — Cookie, X-API-Key, etc.)
  //   - If username/password is set, overlay an `Authorization: Basic …`
  //     line that wins (case-insensitive) over any Authorization in
  //     the blob. This matches `composeRemoteHeaders` in the CLI.
  const composedHeaders = (): Record<string, string> | undefined => {
    const parsed = parseHeaderLines(headersText())
    const u = username().trim()
    const p = password()
    if (u || p) {
      const authKey = Object.keys(parsed).find((k) => k.toLowerCase() === "authorization")
      if (authKey) delete parsed[authKey]
      parsed["Authorization"] = basicAuthHeader(u, p)
    }
    return Object.keys(parsed).length ? parsed : undefined
  }

  const buildInstance = (): SavedInstance | undefined => {
    const trimmedLabel = label().trim()
    if (!trimmedLabel) {
      setError("Label is required")
      setFocused("label")
      return undefined
    }
    const trimmedUrl = url().trim()
    if (!trimmedUrl) {
      setError("URL is required")
      setFocused("url")
      return undefined
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("URL must start with http:// or https://")
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

  const probeNow = async () => {
    if (busy()) return
    setError(undefined)
    const candidate = buildInstance()
    if (!candidate) return
    setProbe({ status: "checking" })
    try {
      const result = await props.service.probe(candidate)
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
      await props.service.save(candidate)
      props.onDone({ instance: candidate })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Sign-In-with-Browser, in-TUI:
  //   1. Validate URL.
  //   2. Open the URL in the user's default browser via `open`.
  //   3. Switch the form into "paste" mode: a single-line input that
  //      accepts a `Name: value` header line (Cookie / Authorization /
  //      X-API-Key / etc). Bracketed paste is preserved verbatim, so
  //      multi-cookie `Cookie: a=…; b=…` lines copy in cleanly.
  //   4. Merge the captured header into the blob (case-insensitive
  //      dedupe) and re-probe to confirm the auth header gets us past
  //      the auth proxy. If `service.probe()` returns `ok: true` with
  //      a parsed version, the cookie is good and we surface a
  //      success banner. Failure surfaces as an error and the header
  //      is still saved on the form so the user can tweak.
  const startSignin = async () => {
    if (busy()) return
    const trimmedUrl = url().trim()
    if (!trimmedUrl) {
      setError("URL required to sign in")
      setFocused("url")
      return
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError("URL must start with http:// or https://")
      setFocused("url")
      return
    }
    setError(undefined)
    setSignin({ kind: "browser-open", url: trimmedUrl })
    await open(trimmedUrl).catch(() => undefined)
    setSignin({ kind: "paste", pasted: "" })
  }

  const cancelSignin = () => {
    setSignin({ kind: "idle" })
  }

  const submitSigninPaste = async () => {
    const phase = signin()
    if (phase.kind !== "paste") return
    const line = phase.pasted.trim()
    if (!line) {
      cancelSignin()
      return
    }
    const colon = line.indexOf(":")
    if (colon <= 0) {
      setSignin({
        kind: "result",
        ok: false,
        message: `Invalid header "${line.slice(0, 40)}…". Use NAME: VALUE.`,
      })
      return
    }
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (!name || !value) {
      setSignin({
        kind: "result",
        ok: false,
        message: "Both NAME and VALUE must be non-empty.",
      })
      return
    }
    // Merge into headers blob (case-insensitive dedupe — last write wins).
    const parsed = parseHeaderLines(headersText())
    const existingKey = Object.keys(parsed).find((k) => k.toLowerCase() === name.toLowerCase())
    if (existingKey) delete parsed[existingKey]
    parsed[name] = value
    setHeadersText(formatHeaderLines(parsed))
    // Re-probe with the new headers to confirm the auth proxy lets us in.
    setSignin({ kind: "verifying" })
    const candidate = buildInstance()
    if (!candidate) {
      setSignin({ kind: "result", ok: false, message: "Save failed: invalid form state." })
      return
    }
    const result = await props.service.probe(candidate)
    if (result.ok && result.version) {
      setSignin({ kind: "result", ok: true, message: `Authenticated. Server reports v${result.version}.` })
      return
    }
    if (result.ok && !result.version) {
      setSignin({
        kind: "result",
        ok: false,
        message: "Header saved but server still didn't return a version (auth proxy may need more headers).",
      })
      return
    }
    setSignin({
      kind: "result",
      ok: false,
      message: `Header saved but probe still failed: ${
        !result.ok && result.status ? `HTTP ${result.status}` : !result.ok ? result.error : "(unknown)"
      }`,
    })
  }

  const moveFocus = (delta: 1 | -1) => {
    const idx = FIELD_ORDER.indexOf(focused())
    const next = (idx + delta + FIELD_ORDER.length) % FIELD_ORDER.length
    setFocused(FIELD_ORDER[next])
  }

  // Single-source keyboard handler for the form. Action keys (Ctrl+S,
  // Ctrl+P, Ctrl+G, Esc, Tab) work regardless of which field is
  // focused; field editing keys mutate the focused field's signal.
  useKeyboard((evt) => {
    if (busy()) {
      if (evt.ctrl && evt.name === "c") props.onDone({ cancel: true })
      return
    }

    // Sign-in paste mode owns the keyboard until cancelled or submitted.
    if (inSignin()) {
      const phase = signin()
      if (phase.kind === "browser-open") {
        // Once the browser has been launched, immediately accept paste.
        setSignin({ kind: "paste", pasted: "" })
      }
      const current = signin()
      if (current.kind !== "paste") return
      if (evt.ctrl && evt.name === "c") return cancelSignin()
      if (evt.name === "escape") return cancelSignin()
      if (evt.name === "return") return void submitSigninPaste()
      if (evt.name === "backspace") {
        setSignin({ kind: "paste", pasted: current.pasted.slice(0, -1) })
        return
      }
      if (evt.ctrl && evt.name === "u") {
        setSignin({ kind: "paste", pasted: "" })
        return
      }
      if (evt.sequence && !evt.ctrl && !evt.meta) {
        // Bracketed paste sends the whole pasted blob in `evt.sequence`.
        // Single keystrokes also arrive as `evt.sequence` of length 1.
        // Strip control chars but preserve everything printable.
        const cleaned = evt.sequence.replace(/[\x00-\x08\x0a-\x1f\x7f]/g, "")
        if (cleaned) {
          setSignin({ kind: "paste", pasted: current.pasted + cleaned })
        }
      }
      return
    }

    // Result/info banner: any key dismisses.
    if (signin().kind === "result") {
      setSignin({ kind: "idle" })
      // fall through to normal handling for the same key — saves a
      // keystroke when the user wants to immediately probe/save again.
    }

    if (evt.ctrl && evt.name === "c") return props.onDone({ cancel: true })
    if (evt.name === "escape") return props.onDone({ cancel: true })
    if (evt.name === "tab") return moveFocus(1)
    if (evt.name === "up") return moveFocus(-1)
    if (evt.name === "down") return moveFocus(1)
    if (evt.ctrl && evt.name === "s") return void save()
    if (evt.ctrl && evt.name === "p") return void probeNow()
    if (evt.ctrl && evt.name === "g") return void startSignin()

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
    if (f === "signin") {
      if (evt.name === "return" || evt.name === "space" || evt.sequence === " ") {
        return void startSignin()
      }
      return
    }

    // Headers field: multi-line text. Enter inserts a newline; pasted
    // blobs (including newline characters) land verbatim. Backspace
    // removes one char, including newlines, so the user can correct
    // typos without leaving the field.
    if (f === "headers") {
      if (evt.name === "return") {
        setHeadersText(headersText() + "\n")
        if (probe().status !== "idle") setProbe({ status: "idle" })
        return
      }
      if (evt.name === "backspace") {
        setHeadersText(headersText().slice(0, -1))
        if (probe().status !== "idle") setProbe({ status: "idle" })
        return
      }
      if (evt.ctrl && evt.name === "u") {
        setHeadersText("")
        if (probe().status !== "idle") setProbe({ status: "idle" })
        return
      }
      if (evt.sequence && !evt.ctrl && !evt.meta) {
        // Preserve newlines from bracketed paste; strip other control
        // chars so weird terminal artefacts don't sneak into headers.
        const cleaned = evt.sequence.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
        if (cleaned) {
          setHeadersText(headersText() + cleaned)
          if (probe().status !== "idle") setProbe({ status: "idle" })
        }
      }
      return
    }

    // Single-line text fields: label / url / username / password.
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
  // (or screen-share). Length-preserving so the cursor/length cues still
  // help the user. Preserves a single trailing char as a "show last"
  // affordance when actively typing — matches common terminal patterns.
  const passwordDisplay = createMemo(() => {
    const value = password()
    if (focused() !== "password") return value ? "•".repeat(value.length) : ""
    if (value.length === 0) return ""
    return "•".repeat(Math.max(0, value.length - 1)) + value.slice(-1)
  })

  const headersDisplay = createMemo(() => {
    // For the TextField primitive (single-line cursor), show only the
    // last line + a "(N more)" hint. Multi-line preview is rendered
    // separately below.
    const blob = headersText()
    if (!blob) return ""
    const lines = blob.split("\n")
    if (lines.length === 1) return lines[0] ?? ""
    const last = lines[lines.length - 1] ?? ""
    return last
  })

  const headersHint = createMemo(() => {
    const blob = headersText()
    const lines = blob ? blob.split("\n") : []
    const nonEmpty = lines.filter((l) => l.trim()).length
    if (nonEmpty === 0) return "one Name: Value per line — Enter for newline"
    return `${nonEmpty} header${nonEmpty === 1 ? "" : "s"} — Enter newline, Ctrl+U clear`
  })

  const probeBanner = createMemo(() => {
    const p = probe()
    if (p.status === "checking") return { variant: "info" as const, text: "Probing /global/version…" }
    if (p.status === "ok")
      return {
        variant: "success" as const,
        text: p.version
          ? `Server reachable. Reports v${p.version}.`
          : "Server reachable but did not return a version (auth proxy?). Use Ctrl+G to sign in via browser.",
      }
    if (p.status === "error") return { variant: "error" as const, text: `Probe failed: ${p.message}` }
    return undefined
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <Header
        instance="setup"
        cwd={props.existing ? `edit ${props.existing.id}` : "new remote instance"}
        status={props.existing ? "edit" : "form"}
        statusColor={palette.info}
      />
      <SectionHeading>{props.existing ? "EDIT REMOTE INSTANCE" : "NEW REMOTE INSTANCE"}</SectionHeading>

      <box marginTop={1}>
        <TextField
          label="Label"
          value={label()}
          focused={focused() === "label"}
          placeholder="My Codeplane Server"
          hint="shown in the picker"
          validate={() => ({ ok: !!label().trim(), message: label().trim() ? undefined : "required" })}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label="URL"
          value={url()}
          focused={focused() === "url"}
          placeholder="https://codeplane.example.com"
          hint="https:// or http://"
          validate={() => {
            const v = url().trim()
            if (!v) return { ok: false, message: "required" }
            if (!/^https?:\/\//i.test(v)) return { ok: false, message: "must start with http:// or https://" }
            return { ok: true }
          }}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label="Basic Auth username"
          value={username()}
          focused={focused() === "username"}
          placeholder="(optional)"
          hint="leave empty if the server doesn't use Basic Auth"
        />
      </box>

      <box marginTop={1}>
        <TextField
          label="Basic Auth password"
          value={passwordDisplay()}
          focused={focused() === "password"}
          placeholder="(optional)"
          hint={password() ? "masked — Ctrl+U to clear" : "leave empty if the server doesn't use Basic Auth"}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label="Custom request headers"
          value={headersDisplay()}
          focused={focused() === "headers"}
          placeholder="Cookie: CF_Authorization=…"
          hint={headersHint()}
        />
        <Show when={headersText().split("\n").filter((l) => l.trim()).length > 1 || (headersText().includes("\n") && focused() === "headers")}>
          <box flexDirection="column" paddingX={4}>
            <For each={headersText().split("\n").slice(0, -1)}>
              {(line) => (
                <text fg={palette.fgDim}>{line || " "}</text>
              )}
            </For>
          </box>
        </Show>
      </box>

      <box marginTop={1}>
        <ToggleField
          label="Trust self-signed TLS certificates"
          value={ignoreCert()}
          focused={focused() === "ignoreCert"}
          hint="only enable for trusted internal / dev instances"
        />
      </box>

      <box marginTop={1} paddingX={2} flexDirection="row">
        <text fg={focused() === "signin" ? palette.accent : palette.fgDim}>
          {focused() === "signin" ? "▍ " : "  "}
        </text>
        <text fg={focused() === "signin" ? palette.accent : palette.fgMuted}>
          [ Sign in via browser ]
        </text>
        <text fg={palette.fgDim}>  Cloudflare Access / SSO — opens URL, captures pasted header</text>
      </box>

      <Show when={signin().kind === "browser-open"}>
        <box marginTop={1}>
          <Banner variant="info">{`Opened ${(signin() as { url: string }).url} in your default browser. Sign in there, copy the auth header (Cookie, Authorization, …) from DevTools, then paste below.`}</Banner>
        </box>
      </Show>

      <Show when={signin().kind === "paste"}>
        <box marginTop={1} paddingX={2} flexDirection="column">
          <box flexDirection="row">
            <text fg={palette.accent}>paste header </text>
            <text fg={palette.divider}>›</text>
            <text fg={palette.fg}> {(signin() as { pasted: string }).pasted || " "}</text>
            <text fg={palette.accent}>▎</text>
          </box>
          <text fg={palette.fgDim}>  Format: Name: value  ·  Enter to verify  ·  Esc to cancel  ·  Ctrl+U clear</text>
          <text fg={palette.fgDim}>  e.g. Cookie: CF_Authorization=eyJ…  or  Authorization: Bearer eyJ…</text>
        </box>
      </Show>

      <Show when={signin().kind === "verifying"}>
        <box marginTop={1}>
          <Banner variant="info">Verifying captured header against /global/version…</Banner>
        </box>
      </Show>

      <Show when={signin().kind === "result"}>
        <box marginTop={1}>
          <Banner
            variant={(signin() as { ok: boolean }).ok ? "success" : "error"}
          >{(signin() as { message: string }).message}</Banner>
        </box>
      </Show>

      <Show when={probeBanner() && signin().kind === "idle"}>
        <box marginTop={1}>
          <Banner variant={probeBanner()!.variant}>{probeBanner()!.text}</Banner>
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
          { keys: "ctrl+s", label: props.existing ? "save changes" : "save" },
          { keys: "ctrl+p", label: "probe" },
          { keys: "ctrl+g", label: "sign-in" },
          { keys: "tab/↑↓", label: "navigate" },
          { keys: "esc", label: "cancel" },
          { keys: "ctrl+c", label: "quit" },
        ]}
      />
    </box>
  )
}
