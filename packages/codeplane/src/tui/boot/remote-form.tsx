// Create-remote-instance form. Functional mirror of the desktop's
// `InstanceForm` (packages/desktop/src/setup/app.tsx) for the
// remote-server case: pick a label + URL + optional Basic Auth
// (username / password), validate via `service.probe()`, save, return.
//
// What the desktop form has that this one deliberately doesn't (to keep
// the TUI single-file and the field count low):
//   - Custom icon upload (no PNG support in opentui)
//   - Free-form headers blob (advanced) — for that, fall back to
//     `codeplane instance add <url> --header "X-Foo: bar"` from a shell
//   - Ignore-cert toggle — same workaround
//   - Sign-in-with-browser button — handled by `codeplane instance
//     sign-in <id>` from a shell after the instance is saved
//
// Anything not covered here is reachable via the CLI subcommands; the
// goal of THIS form is to make the most common case (label + URL +
// optional Basic Auth) discoverable inside the boot wizard.
import { createMemo, createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { InstanceService } from "../instance-service"
import { Banner, Header, palette, SectionHeading, StatusBar, TextField } from "./primitives"

export type RemoteFormResult = { instance: SavedInstance } | { cancel: true }

type Field = "label" | "url" | "username" | "password"
const FIELD_ORDER: Field[] = ["label", "url", "username", "password"]

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

function basicAuthHeader(user: string, pass: string): string {
  // Matches the desktop's `composedHeaders` formatting and the CLI's
  // `composeRemoteHeaders` so a TUI-saved instance authenticates the
  // same way against the same server as one created from any other
  // surface.
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`
}

export function RemoteInstanceForm(props: {
  service: InstanceService
  takenIds: Set<string>
  onDone: (result: RemoteFormResult) => void
}) {
  const [label, setLabel] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [focused, setFocused] = createSignal<Field>("label")
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)
  const [probe, setProbe] = createSignal<ProbeState>({ status: "idle" })
  const busy = createMemo(() => saving() || probe().status === "checking")

  const valueFor = (f: Field) =>
    f === "label" ? label() : f === "url" ? url() : f === "username" ? username() : password()
  const setterFor = (f: Field) =>
    f === "label" ? setLabel : f === "url" ? setUrl : f === "username" ? setUsername : setPassword

  const composedHeaders = (): Record<string, string> | undefined => {
    const u = username().trim()
    const p = password()
    if (!u && !p) return undefined
    return { Authorization: basicAuthHeader(u, p) }
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
    const slug = slugify(trimmedLabel, "remote")
    let id = slug
    let n = 1
    while (props.takenIds.has(id)) {
      n += 1
      id = `${slug}-${n}`
    }
    return {
      id,
      url: trimmedUrl,
      label: trimmedLabel,
      headers: composedHeaders(),
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

  const moveFocus = (delta: 1 | -1) => {
    const idx = FIELD_ORDER.indexOf(focused())
    const next = (idx + delta + FIELD_ORDER.length) % FIELD_ORDER.length
    setFocused(FIELD_ORDER[next])
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
    if (evt.name === "return") {
      // Enter on the last field (password) saves; otherwise advance.
      if (focused() === "password") return void save()
      moveFocus(1)
      return
    }
    // Field text editing
    const f = focused()
    const get = valueFor
    const set = setterFor(f)
    if (evt.name === "backspace") {
      set(get(f).slice(0, -1))
      // Re-probing after every keystroke would spam the server; the
      // user runs Ctrl+P explicitly when ready.
      if (probe().status !== "idle") setProbe({ status: "idle" })
      return
    }
    if (evt.ctrl && evt.name === "u") {
      set("")
      if (probe().status !== "idle") setProbe({ status: "idle" })
      return
    }
    if (evt.sequence && !evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence.charCodeAt(0) >= 32) {
      set(get(f) + evt.sequence)
      if (probe().status !== "idle") setProbe({ status: "idle" })
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

  const probeBanner = createMemo(() => {
    const p = probe()
    if (p.status === "checking") return { variant: "info" as const, text: "Probing /global/version…" }
    if (p.status === "ok")
      return {
        variant: "success" as const,
        text: p.version
          ? `Server reachable. Reports v${p.version}.`
          : "Server reachable but did not return a version (auth proxy?). Check the URL or use `codeplane instance sign-in <id>` after saving.",
      }
    if (p.status === "error") return { variant: "error" as const, text: `Probe failed: ${p.message}` }
    return undefined
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <Header instance="setup" cwd="new remote instance" status="form" statusColor={palette.info} />
      <SectionHeading>NEW REMOTE INSTANCE</SectionHeading>

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

      <Show when={probeBanner()}>
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
      <box marginTop={1} paddingX={2}>
        <text fg={palette.fgDim}>
          Cloudflare Access / SSO? Save first, then run `codeplane instance sign-in {label().trim() ? slugify(label().trim(), "remote") : "<id>"}` from a shell to capture the cookie automatically.
        </text>
      </box>
      <StatusBar
        hints={[
          { keys: "ctrl+s", label: "save" },
          { keys: "ctrl+p", label: "probe" },
          { keys: "tab/↑↓", label: "navigate" },
          { keys: "esc", label: "cancel" },
          { keys: "ctrl+c", label: "quit" },
        ]}
      />
    </box>
  )
}
