// Create-local-instance form. Mirrors the desktop's `LocalInstanceForm`
// functionally: pick a label + binary version, install if missing (with
// progress bar), save, return.
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import path from "node:path"
import type { LocalInstallProgress, LocalStatus, LocalTarget, SavedInstance } from "@codeplane-ai/shared/instance"
import { localInstanceUrl } from "@codeplane-ai/shared/instance"
import { fetchCodeplaneLatestVersion } from "@codeplane-ai/shared/local-runtime"
import type { InstanceService } from "../instance-service"
import { tuiT } from "@/tui/i18n"
import { Banner, Header, ProgressBar, SectionHeading, StatusBar, TextField, useBootPalette } from "./primitives"

export type LocalFormResult = { instance: SavedInstance } | { cancel: true }

type Field = "label" | "version"

export function LocalInstanceForm(props: {
  service: InstanceService
  takenIds: Set<string>
  existing?: SavedInstance
  onDone: (result: LocalFormResult) => void
}) {
  const palette = useBootPalette()
  const [label, setLabel] = createSignal(props.existing?.label ?? "Local Codeplane")
  const [version, setVersion] = createSignal("")
  const [target, setTarget] = createSignal<LocalTarget | undefined>(undefined)
  const [status, setStatus] = createSignal<LocalStatus | undefined>(undefined)
  const [focused, setFocused] = createSignal<Field>("label")
  const [installing, setInstalling] = createSignal<LocalInstallProgress | undefined>(undefined)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [saving, setSaving] = createSignal(false)
  const busy = createMemo(() => !!installing() || saving())

  // Pre-fill with the newest version from the npm registry so users get the
  // latest by default. Fall back to the saved preferred version (or empty)
  // when the registry is unreachable. Users typically just hit Save and the
  // install runs on first use of the saved instance.
  onMount(async () => {
    try {
      const [t, latest] = await Promise.all([
        props.service.localTarget(),
        fetchCodeplaneLatestVersion().catch(() => undefined),
      ])
      setTarget(t)
      const initial = props.existing?.local?.binaryVersion || latest || t.defaultVersion || ""
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
    const requested = version()
    if (!requested) return
    try {
      const s = await props.service.localStatus(requested)
      // Drop stale results: a later keystroke changed the field while this
      // lookup was in flight, so its status no longer matches what's shown.
      if (version() !== requested) return
      setStatus(s)
    } catch {
      if (version() !== requested) return
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
      setError(tuiT("boot.remote.labelRequired"))
      setFocused("label")
      return
    }
    setSaving(true)
    try {
      let id = props.existing?.id
      if (!id) {
        const slug = (label().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "local").slice(0, 32)
        id = slug
        let n = 1
        while (props.takenIds.has(id)) {
          n += 1
          id = `${slug}-${n}`
        }
      }
      const created: SavedInstance = {
        ...props.existing,
        id,
        url: props.existing?.url ?? localInstanceUrl(id),
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
    if (!version()) return tuiT("boot.local.usesSavedPreferredVersion")
    if (!s) return tuiT("boot.local.checking")
    if (s.installed) return tuiT("boot.local.installedAt", { path: s.binaryPath ? path.basename(s.binaryPath) : tuiT("boot.local.knownPath") })
    return tuiT("boot.local.notInstalledHint")
  })

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={palette().bg}>
      <Header
        instance="setup"
        cwd={props.existing ? `edit ${props.existing.id}` : "new local instance"}
        status={props.existing ? "Edit" : "Form"}
        statusColor={palette().info}
      />

      <SectionHeading>{props.existing ? tuiT("boot.local.heading.edit") : tuiT("boot.local.heading")}</SectionHeading>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.local.label")}
          value={label()}
          focused={focused() === "label"}
          placeholder={tuiT("boot.local.labelPlaceholder")}
          hint={tuiT("boot.local.labelHint")}
          validate={() => ({ ok: !!label().trim(), message: label().trim() ? undefined : tuiT("common.required") })}
        />
      </box>

      <box marginTop={1}>
        <TextField
          label={tuiT("boot.local.binaryVersion")}
          value={version()}
          focused={focused() === "version"}
          placeholder={target()?.defaultVersion ?? "latest"}
          hint={installedHint()}
        />
      </box>

      <Show when={target()}>
        <box marginTop={1} paddingX={2}>
          <text fg={palette().fgDim}>
            {tuiT("boot.local.target", {
              os: target()!.os,
              arch: target()!.arch,
              binary: target()!.binaryName,
              archive: target()!.archiveName,
            })}
          </text>
        </box>
      </Show>

      <Show when={installing()}>
        <box marginTop={1} flexDirection="column">
          <box paddingX={2}>
            <text fg={palette().accent}>{tuiT("boot.local.installing")} </text>
            <text fg={palette().fgMuted}>{installing()!.phase}</text>
            <Show when={installing()!.binaryVersion}>
              <text fg={palette().fgDim}>  v{installing()!.binaryVersion}</text>
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
            {tuiT("boot.local.notInstalledBanner")}
          </Banner>
        </box>
      </Show>

      <Show when={!installing() && status()?.installed}>
        <box marginTop={1}>
          <Banner variant="success">{tuiT("boot.local.installedBanner")}</Banner>
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
          { keys: "ctrl+i", label: tuiT("common.installNow") },
          { keys: "tab", label: tuiT("common.nextField") },
          { keys: "esc", label: tuiT("common.cancel") },
          { keys: "ctrl+c", label: tuiT("common.quit") },
        ]}
      />
    </box>
  )
}
