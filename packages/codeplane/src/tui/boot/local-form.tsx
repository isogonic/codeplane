// Create-local-instance form. Mirrors the desktop's `LocalInstanceForm`
// functionally: pick a label + binary version, install if missing (with
// progress bar), save, return.
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import path from "node:path"
import type { LocalInstallProgress, LocalStatus, LocalTarget, SavedInstance } from "@codeplane-ai/shared/instance"
import { localInstanceUrl } from "@codeplane-ai/shared/instance"
import type { InstanceService } from "../instance-service"
import { Banner, Header, palette, ProgressBar, SectionHeading, StatusBar, TextField } from "./primitives"

export type LocalFormResult = { instance: SavedInstance } | { cancel: true }

type Field = "label" | "version"

export function LocalInstanceForm(props: {
  service: InstanceService
  takenIds: Set<string>
  onDone: (result: LocalFormResult) => void
}) {
  const [label, setLabel] = createSignal("Local Codeplane")
  const [version, setVersion] = createSignal("")
  const [target, setTarget] = createSignal<LocalTarget | undefined>(undefined)
  const [status, setStatus] = createSignal<LocalStatus | undefined>(undefined)
  const [focused, setFocused] = createSignal<Field>("label")
  const [installing, setInstalling] = createSignal<LocalInstallProgress | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)
  const busy = createMemo(() => !!installing() || saving())

  // Use the saved preferred version (from instance-service.localTarget()) as
  // the default; users typically just hit Save and the install runs on first
  // use of the saved instance. Pre-installing here is optional but matches
  // the desktop flow when the user wants confirmation that the binary lands.
  onMount(async () => {
    try {
      const t = await props.service.localTarget()
      setTarget(t)
      const initial = t.defaultVersion ?? ""
      setVersion(initial)
      if (initial) {
        const s = await props.service.localStatus(initial)
        setStatus(s)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  })

  const refreshStatus = async () => {
    if (!version()) return
    try {
      setStatus(await props.service.localStatus(version()))
    } catch {
      setStatus(undefined)
    }
  }

  const install = async () => {
    if (busy()) return
    setError(undefined)
    setInstalling({ phase: "detect", message: "preparing", percent: 0, version: version() || "latest" })
    try {
      await props.service.installLocal(version() || undefined, (progress) => setInstalling(progress))
      setInstalling(undefined)
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInstalling(undefined)
    }
  }

  const save = async () => {
    if (busy()) return
    if (!label().trim()) {
      setError("Label is required")
      setFocused("label")
      return
    }
    setSaving(true)
    try {
      // Allocate a unique id from the label.
      const slug = (label().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "local").slice(0, 32)
      let id = slug
      let n = 1
      while (props.takenIds.has(id)) {
        n += 1
        id = `${slug}-${n}`
      }
      const created: SavedInstance = {
        id,
        url: localInstanceUrl(id),
        label: label().trim(),
        local: { binaryVersion: version() || "" },
      }
      await props.service.save(created)
      props.onDone({ instance: created })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // Keyboard handler for the form (single useKeyboard scoped to this view).
  useKeyboard((evt) => {
    if (busy()) {
      if (evt.ctrl && evt.name === "c") props.onDone({ cancel: true })
      return
    }
    if (evt.ctrl && evt.name === "c") return props.onDone({ cancel: true })
    if (evt.name === "escape") return props.onDone({ cancel: true })
    if (evt.name === "tab") {
      setFocused((f) => (f === "label" ? "version" : "label"))
      return
    }
    if (evt.name === "up") {
      setFocused((f) => (f === "version" ? "label" : "label"))
      return
    }
    if (evt.name === "down") {
      setFocused((f) => (f === "label" ? "version" : "version"))
      return
    }
    // Action shortcuts (work regardless of which field is focused)
    if (evt.ctrl && evt.name === "s") return void save()
    if (evt.ctrl && evt.name === "i") return void install()
    if (evt.name === "return" && focused() === "version") {
      // Enter on version → save (most common path)
      return void save()
    }
    if (evt.name === "return" && focused() === "label") {
      // Enter on label → move to version
      setFocused("version")
      return
    }
    // Field text edits
    if (focused() === "label") {
      if (evt.name === "backspace") {
        setLabel(label().slice(0, -1))
        return
      }
      if (evt.ctrl && evt.name === "u") {
        setLabel("")
        return
      }
      if (evt.sequence && !evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence.charCodeAt(0) >= 32) {
        setLabel(label() + evt.sequence)
      }
    } else if (focused() === "version") {
      if (evt.name === "backspace") {
        setVersion(version().slice(0, -1))
        void refreshStatus()
        return
      }
      if (evt.ctrl && evt.name === "u") {
        setVersion("")
        void refreshStatus()
        return
      }
      if (evt.sequence && !evt.ctrl && !evt.meta && evt.sequence.length === 1 && evt.sequence.charCodeAt(0) >= 32) {
        setVersion(version() + evt.sequence)
        void refreshStatus()
      }
    }
  })

  const installedHint = createMemo(() => {
    const s = status()
    if (!version()) return "(uses saved preferred version)"
    if (!s) return "checking…"
    if (s.installed) return `✓ installed at ${s.binaryPath ? path.basename(s.binaryPath) : "known path"}`
    return "not installed — Ctrl+I to install now or Ctrl+S to save & install on first use"
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette.bg}>
      <Header instance="setup" cwd="new local instance" status="form" statusColor={palette.info} />

      <SectionHeading>NEW LOCAL INSTANCE</SectionHeading>

      <box marginTop={1}>
        <TextField
          label="Label"
          value={label()}
          focused={focused() === "label"}
          placeholder="Local Codeplane"
          hint="shown in the picker"
          validate={() => ({ ok: !!label().trim(), message: label().trim() ? undefined : "required" })}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label="Binary version"
          value={version()}
          focused={focused() === "version"}
          placeholder={target()?.defaultVersion ?? "latest"}
          hint={installedHint()}
        />
      </box>

      <Show when={target()}>
        <box marginTop={1} paddingX={2}>
          <text fg={palette.fgDim}>
            target: {target()!.os}/{target()!.arch}  ·  binary {target()!.binaryName}  ·  {target()!.archiveName}
          </text>
        </box>
      </Show>

      <Show when={installing()}>
        <box marginTop={1} flexDirection="column">
          <box paddingX={2}>
            <text fg={palette.accent}>installing… </text>
            <text fg={palette.fgMuted}>{installing()!.phase}</text>
            <Show when={installing()!.binaryVersion}>
              <text fg={palette.fgDim}>  v{installing()!.binaryVersion}</text>
            </Show>
          </box>
          <box marginTop={0}>
            <ProgressBar percent={installing()!.percent ?? 0} message={installing()!.message} />
          </box>
        </box>
      </Show>

      <Show when={!installing() && status() && !status()!.installed && version()}>
        <box marginTop={1}>
          <Banner variant="warn">
            Binary not yet installed. Press Ctrl+I to install now, or Ctrl+S to save (it will install on first use).
          </Banner>
        </box>
      </Show>

      <Show when={!installing() && status()?.installed}>
        <box marginTop={1}>
          <Banner variant="success">Binary installed and ready.</Banner>
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
          { keys: "ctrl+s", label: "save" },
          { keys: "ctrl+i", label: "install now" },
          { keys: "tab", label: "next field" },
          { keys: "esc", label: "cancel" },
          { keys: "ctrl+c", label: "quit" },
        ]}
      />
    </box>
  )
}
