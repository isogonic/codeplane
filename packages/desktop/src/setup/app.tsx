import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { marked } from "marked"
import DOMPurify from "dompurify"
import { Button } from "@codeplane-ai/ui/button"
import { TextField } from "@codeplane-ai/ui/text-field"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Progress } from "@codeplane-ai/ui/progress"
import { Switch } from "@codeplane-ai/ui/switch"
import { Mark } from "@codeplane-ai/ui/logo"
import { showToast } from "@codeplane-ai/ui/toast"
import type {
  LocalTarget,
  OpenProgress,
  PrepareProgress as PrepareState,
  SavedInstance,
} from "@codeplane-ai/shared/instance"
import { formatHeaders as serializeHeaders, parseHeaders as parseHeaderInput } from "@codeplane-ai/shared/headers"
import type { CodeplaneDesktopAPI } from "../main/preload"

type LocalInstallState = {
  phase: "detect" | "download" | "extract" | "start" | "ready"
  message: string
  percent: number
  binaryVersion?: string
  transferred?: number
  total?: number
}

declare global {
  interface Window {
    codeplaneDesktop: CodeplaneDesktopAPI
  }
}

const api = window.codeplaneDesktop

const logSetup = (event: string, data?: unknown) => api.debug.log(event, data, "setup")

function instanceSummary(instance: SavedInstance) {
  return {
    id: instance.id,
    url: instance.url,
    label: instance.label,
    hasHeaders: !!instance.headers && Object.keys(instance.headers).length > 0,
    ignoreCertificateErrors: !!instance.ignoreCertificateErrors,
    clientCertConfigured: !!instance.clientCertSubject,
    local: instance.local ? { binaryVersion: instance.local.binaryVersion } : undefined,
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const parseHeaders = parseHeaderInput
const formatHeaders = (headers: Record<string, string> | undefined) => serializeHeaders(headers, "newline")

type NotificationSettingsState = {
  agent: boolean
  permissions: boolean
  errors: boolean
}

const defaultNotificationSettings: NotificationSettingsState = {
  agent: true,
  permissions: true,
  errors: false,
}

function readStoredSettings() {
  const raw = api.storage.getItem(undefined, "settings.v3")
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch (error) {
    logSetup("settings.read-error", { error })
  }
  return {}
}

function readNotificationSettings(): NotificationSettingsState {
  const notifications = readStoredSettings().notifications as Record<string, unknown> | undefined
  if (!notifications || typeof notifications !== "object") return defaultNotificationSettings
  return {
    agent: typeof notifications.agent === "boolean" ? notifications.agent : defaultNotificationSettings.agent,
    permissions:
      typeof notifications.permissions === "boolean"
        ? notifications.permissions
        : defaultNotificationSettings.permissions,
    errors: typeof notifications.errors === "boolean" ? notifications.errors : defaultNotificationSettings.errors,
  }
}

function writeNotificationSettings(settings: NotificationSettingsState) {
  api.storage.setItem(
    undefined,
    "settings.v3",
    JSON.stringify({
      ...readStoredSettings(),
      notifications: settings,
    }),
  )
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const InstanceIcon: Component<{ instance: SavedInstance; size?: "tile" | "row" }> = (props) => {
  const size = () => (props.size === "tile" ? "size-7" : "size-7")
  return (
    <Show
      when={props.instance.iconDataUrl}
      fallback={
        <div
          class={`flex shrink-0 items-center justify-center rounded-md ${size()}`}
          classList={{
            "bg-surface-success-weak text-icon-success-active": !!props.instance.local,
            "bg-surface-interactive-weak text-text-interactive-base": !props.instance.local,
          }}
        >
          <Icon name={props.instance.local ? "server" : "globe"} size="small" />
        </div>
      }
    >
      <img
        src={props.instance.iconDataUrl}
        alt=""
        class={`${size()} shrink-0 rounded-md object-cover`}
        draggable={false}
      />
    </Show>
  )
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsDataURL(file)
  })
}

type DesktopUpdateState =
  | { kind: "loading" }
  | { kind: "idle"; current: string; latest: string | null }
  | { kind: "checking"; current: string }
  | { kind: "available"; current: string; latest: string }
  | {
      kind: "downloading"
      current: string
      latest: string
      percent: number
      transferred?: number
      total?: number
    }
  | { kind: "downloaded"; current: string; latest: string }
  | { kind: "manual-required"; current: string; latest: string | null; url: string }
  | { kind: "error"; current: string; message: string }

// This card updates the desktop Electron shell itself. It checks GitHub
// releases via electron-updater, downloads the matching installer, and
// relaunches the app once the download is in place so the new shell takes
// effect.
const DesktopUpdateCard: Component = () => {
  const [state, setState] = createSignal<DesktopUpdateState>({ kind: "loading" })
  const [notes, setNotes] = createSignal<{ version: string; body: string | null; url: string | null } | null>(null)
  const [notesOpen, setNotesOpen] = createSignal(false)

  const notesHtml = createMemo(() => {
    const body = notes()?.body
    if (!body) return ""
    const raw = marked.parse(body, { async: false, gfm: true, breaks: false }) as string
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "rel"] })
  })

  const currentVersion = () => {
    const next = state()
    if (next.kind === "loading") return "unknown"
    return next.current
  }

  const loadNotes = async (version: string) => {
    if (notes()?.version === version) return
    try {
      const result = await api.desktopUpdater.releaseNotes(version)
      logSetup("desktop-update.release-notes", { found: !!result, version })
      setNotes(result ? { version, body: result.body, url: result.url } : { version, body: null, url: null })
    } catch (error) {
      logSetup("desktop-update.release-notes-error", { error, version })
      setNotes({ version, body: null, url: null })
    }
  }

  const refreshStatus = async () => {
    try {
      const status = await api.desktopUpdater.status()
      logSetup("desktop-update.status", status)
      if (status.hasUpdate && status.latest) {
        setState({ kind: "available", current: status.current, latest: status.latest })
        void loadNotes(status.latest)
      } else {
        setState({ kind: "idle", current: status.current, latest: status.latest })
      }
    } catch (error) {
      logSetup("desktop-update.status-error", { error })
      setState({
        kind: "error",
        current: api.version,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const onCheck = async () => {
    const before = state()
    const current = before.kind === "loading" ? api.version : before.current
    setState({ kind: "checking", current })
    try {
      const result = await api.desktopUpdater.check()
      logSetup("desktop-update.check", result)
      if (!result.ok) {
        setState({ kind: "error", current, message: result.error })
        return
      }
      if (!result.updateAvailable) {
        setState({ kind: "idle", current, latest: current })
        return
      }
      const latest = result.version ?? current
      setState({ kind: "available", current, latest })
      void loadNotes(latest)
    } catch (error) {
      logSetup("desktop-update.check-error", { error })
      setState({ kind: "error", current, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const onDownload = async () => {
    const s = state()
    if (s.kind !== "available" && s.kind !== "error") return
    const current = s.kind === "available" ? s.current : currentVersion()
    const latest = s.kind === "available" ? s.latest : currentVersion()
    setState({ kind: "downloading", current, latest, percent: 0 })
    try {
      const result = await api.desktopUpdater.download()
      logSetup("desktop-update.download", result)
      if (!result.ok) setState({ kind: "error", current, message: result.error })
    } catch (error) {
      logSetup("desktop-update.download-error", { error })
      setState({ kind: "error", current, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const onOpenNotesUrl = async () => {
    const url = notes()?.url
    if (url) await api.auth.openExternal(url)
  }

  const offAvailable = api.desktopUpdater.onUpdateAvailable((info) => {
    logSetup("desktop-update.event.available", info)
    setState((prev) => {
      const current = prev.kind === "loading" ? info.version : prev.current
      const latest =
        info.version || (prev.kind !== "loading" && "latest" in prev && prev.latest ? prev.latest : current)
      return { kind: "available", current, latest }
    })
    if (info.version) void loadNotes(info.version)
  })
  const offNotAvailable = api.desktopUpdater.onUpdateNotAvailable((info) => {
    logSetup("desktop-update.event.not-available", info)
    setState((prev) => {
      const current = prev.kind === "loading" ? api.version : prev.current
      return { kind: "idle", current, latest: info?.version ?? current }
    })
  })
  const offProgress = api.desktopUpdater.onProgress((progress) => {
    setState((prev) => {
      if (prev.kind !== "downloading" && prev.kind !== "available") return prev
      const current = prev.current
      const latest = "latest" in prev && prev.latest ? prev.latest : current
      const previousPercent = prev.kind === "downloading" ? prev.percent : 0
      return {
        kind: "downloading",
        current,
        latest,
        percent: Math.max(previousPercent, Math.round(progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
      }
    })
  })
  const offDownloaded = api.desktopUpdater.onUpdateDownloaded((info) => {
    logSetup("desktop-update.event.downloaded", info)
    setState({
      kind: "downloaded",
      current: info.version,
      latest: info.version,
    })
    if (info.version) void loadNotes(info.version)
  })
  const offError = api.desktopUpdater.onError((message) => {
    logSetup("desktop-update.event.error", { message })
    setState((prev) => ({
      kind: "error",
      current: prev.kind === "loading" ? api.version : prev.current,
      message,
    }))
  })
  const offManualRequired = api.desktopUpdater.onRequiresManualDownload((info) => {
    logSetup("desktop-update.event.manual-required", info)
    setState((prev) => {
      const current = prev.kind === "loading" ? api.version : prev.current
      const latest =
        info.version ?? (prev.kind !== "loading" && "latest" in prev && prev.latest ? prev.latest : null)
      return { kind: "manual-required", current, latest, url: info.url }
    })
  })

  onCleanup(() => {
    offAvailable()
    offNotAvailable()
    offProgress()
    offDownloaded()
    offError()
    offManualRequired()
  })

  onMount(() => void refreshStatus())

  const statusTone = (): "neutral" | "info" | "success" | "danger" => {
    const s = state()
    switch (s.kind) {
      case "available":
      case "downloading":
      case "checking":
      case "manual-required":
        return "info"
      case "downloaded":
        return "success"
      case "error":
        return "danger"
      case "idle":
        return "success"
      default:
        return "neutral"
    }
  }
  const statusLabel = () => {
    const s = state()
    switch (s.kind) {
      case "loading":
        return "Loading…"
      case "checking":
        return "Checking…"
      case "available":
        return "Update available"
      case "downloading":
        return `Installing… ${s.percent}%`
      case "downloaded":
        return "Installed"
      case "manual-required":
        return "Update available"
      case "error":
        return "Update error"
      case "idle":
      default:
        return "Up to date"
    }
  }

  const detailLine = () => {
    const s = state()
    switch (s.kind) {
      case "loading":
        return "Loading desktop app version…"
      case "checking":
        return `Checking for updates… (current ${api.version})`
      case "available":
        return `Codeplane Desktop ${s.latest} is available. You're on ${s.current}.`
      case "downloading": {
        const bytes =
          s.transferred && s.total ? ` · ${formatBytes(s.transferred)} of ${formatBytes(s.total)}` : ""
        return `Downloading Codeplane Desktop ${s.latest}${bytes}`
      }
      case "downloaded":
        return `Codeplane Desktop ${s.latest} downloaded. Restarting to apply the update…`
      case "manual-required":
        return s.latest
          ? `Codeplane Desktop ${s.latest} is available. This build can't auto-install — download it manually to update.`
          : "A new Codeplane Desktop release is available. This build can't auto-install — download it manually to update."
      case "error":
        return `Couldn't update the desktop app: ${s.message}`
      case "idle":
      default:
        return `Codeplane Desktop ${api.version} is installed.`
    }
  }

  const toneClasses = () => {
    const tone = statusTone()
    if (tone === "success") return "bg-surface-success-weak text-icon-success-active"
    if (tone === "info") return "bg-surface-interactive-weak text-text-interactive-base"
    if (tone === "danger") return "bg-surface-danger-weak text-text-danger-base"
    return "bg-surface-base text-text-weak"
  }

  return (
    <section
      class="mt-2 flex flex-col gap-2.5 border-t border-border-weak-base pt-4"
      data-desktop-section="desktop-update"
    >
      <div class="flex items-start gap-3">
        <div class={`flex size-8 shrink-0 items-center justify-center rounded-md ${toneClasses()}`}>
          <Icon
            name={
              state().kind === "downloaded" || state().kind === "idle"
                ? "check"
                : state().kind === "error"
                  ? "warning"
                  : "download"
            }
            size="small"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <span class="text-[13px] font-medium text-text-strong">Desktop app</span>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              classList={{
                "bg-surface-success-weak text-icon-success-active": statusTone() === "success",
                "bg-surface-interactive-weak text-text-interactive-base": statusTone() === "info",
                "bg-surface-danger-weak text-text-danger-base": statusTone() === "danger",
                "bg-surface-base text-text-weak": statusTone() === "neutral",
              }}
              data-desktop-update-status={state().kind}
            >
              {statusLabel()}
            </span>
          </div>
          <span class="text-[12px] leading-relaxed text-text-weak" data-desktop-update-detail>
            {detailLine()}
          </span>
        </div>
      </div>

      <Show when={state().kind === "downloading"}>
        {(_) => {
          const s = state() as Extract<DesktopUpdateState, { kind: "downloading" }>
          return (
            <div class="px-1">
              <Progress value={s.percent} maxValue={100} hideLabel>
                Downloading desktop update
              </Progress>
            </div>
          )
        }}
      </Show>

      <Show when={(state().kind === "available" || state().kind === "downloaded") && notes()?.body}>
        <div class="flex flex-col gap-1">
          <button
            type="button"
            class="flex items-center gap-1 self-start rounded px-1 py-0.5 text-[12px] text-text-weak hover:text-text-strong"
            data-desktop-action="desktop-update-notes-toggle"
            onClick={() => setNotesOpen(!notesOpen())}
          >
            <Icon name={notesOpen() ? "chevron-down" : "chevron-right"} size="x-small" />
            What's new in {notes()?.version}
          </button>
          <Show when={notesOpen()}>
            <div
              data-component="markdown"
              class="max-h-[160px] overflow-y-auto rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-[12px] leading-relaxed text-text-base"
              innerHTML={notesHtml()}
            />
          </Show>
        </div>
      </Show>

      <div class="flex flex-wrap items-center gap-2">
        <Show when={state().kind === "idle" || state().kind === "loading" || state().kind === "error"}>
          <Button
            variant={state().kind === "error" ? "secondary" : "secondary"}
            size="small"
            disabled={state().kind === "loading"}
            data-desktop-action="desktop-update-check"
            onClick={() => void onCheck()}
          >
            {state().kind === "error" ? "Retry" : "Check for updates"}
          </Button>
        </Show>
        <Show when={state().kind === "checking"}>
          <Button variant="secondary" size="small" disabled data-desktop-action="desktop-update-checking">
            Checking…
          </Button>
        </Show>
        <Show when={state().kind === "available"}>
          <Button
            variant="primary"
            size="small"
            icon="download"
            data-desktop-action="desktop-update-download"
            onClick={() => void onDownload()}
          >
            Install update
          </Button>
        </Show>
        <Show when={state().kind === "downloading"}>
          <Button variant="primary" size="small" disabled data-desktop-action="desktop-update-downloading">
            Downloading…
          </Button>
        </Show>
        <Show when={state().kind === "downloaded"}>
          <Button variant="primary" size="small" icon="check" disabled data-desktop-action="desktop-update-installed">
            Restarting…
          </Button>
        </Show>
        <Show when={state().kind === "manual-required"}>
          {(_) => {
            const s = state() as Extract<DesktopUpdateState, { kind: "manual-required" }>
            return (
              <Button
                variant="primary"
                size="small"
                icon="download"
                data-desktop-action="desktop-update-manual-download"
                onClick={() => void api.auth.openExternal(s.url)}
              >
                {s.latest ? `Download ${s.latest}` : "Open download page"}
              </Button>
            )
          }}
        </Show>
        <Show when={notes()?.url && (state().kind === "available" || state().kind === "downloaded")}>
          <Button
            variant="ghost"
            size="small"
            data-desktop-action="desktop-update-notes-link"
            onClick={() => void onOpenNotesUrl()}
          >
            View on GitHub
          </Button>
        </Show>
      </div>
    </section>
  )
}

const NotificationSettingsCard: Component = () => {
  const [settings, setSettings] = createSignal<NotificationSettingsState>(readNotificationSettings())
  const [supported, setSupported] = createSignal<boolean>()

  onMount(() => {
    void api.notifications.isSupported().then(setSupported).catch(() => setSupported(false))
  })

  const setNotification = (key: keyof NotificationSettingsState, value: boolean) => {
    const next = { ...settings(), [key]: value }
    logSetup("notifications.settings", { key, value })
    setSettings(next)
    writeNotificationSettings(next)
  }

  const sendTest = async () => {
    const shown = await api.notifications
      .notify({
        title: "Codeplane",
        description: "Desktop notifications are active. Agent, permission, and error alerts will appear here.",
      })
      .catch(() => false)
    if (shown) {
      showToast({
        variant: "success",
        icon: "check",
        title: "Test notification sent",
        description: "If Codeplane is allowed in your OS notification center, you should see it now.",
      })
      return
    }
    showToast({
      variant: "error",
      icon: "warning",
      title: "Notifications unavailable",
      description: "Allow Codeplane in your OS notification settings, then try again.",
    })
  }

  const NotificationRow: Component<{
    action: string
    checked: boolean
    description: string
    label: string
    onChange: (value: boolean) => void
  }> = (props) => (
    <div class="flex items-start justify-between gap-4 border-t border-border-weak-base py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-[13px] font-medium text-text-strong">{props.label}</span>
        <span class="text-[12px] leading-relaxed text-text-weak">{props.description}</span>
      </div>
      <div data-desktop-action={props.action}>
        <Switch checked={props.checked} onChange={props.onChange} hideLabel>
          {props.label}
        </Switch>
      </div>
    </div>
  )

  return (
    <section class="mt-8" data-desktop-section="notifications">
      <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak">Notifications</span>
      <div class="mt-2 flex flex-col gap-1 border-t border-border-weak-base pt-4">
        <div class="flex flex-col gap-1">
          <span class="text-[14px] font-semibold text-text-strong">Native desktop notifications</span>
          <span class="text-[12px] leading-relaxed text-text-weak">
            Use your OS notification center for background agent completions, permission prompts, and runtime errors.
          </span>
          <span class="text-[12px] text-text-weak" data-desktop-notifications-supported={String(!!supported())}>
            {supported() === false
              ? "Native notifications are unavailable on this machine."
              : "These toggles use the same notification preferences as the web app on this device."}
          </span>
        </div>

        <div class="mt-3 flex flex-col">
          <NotificationRow
            action="notifications-agent"
            checked={settings().agent}
            label="Agent completions"
            description="Notify when a background turn finishes or an agent asks a follow-up question."
            onChange={(value) => setNotification("agent", value)}
          />
          <NotificationRow
            action="notifications-permissions"
            checked={settings().permissions}
            label="Permissions"
            description="Notify when Codeplane needs approval for a command, file action, or other gated operation."
            onChange={(value) => setNotification("permissions", value)}
          />
          <NotificationRow
            action="notifications-errors"
            checked={settings().errors}
            label="Errors"
            description="Notify when a session fails in the background and needs attention."
            onChange={(value) => setNotification("errors", value)}
          />
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            data-desktop-action="notifications-test"
            onClick={() => void sendTest()}
          >
            Send test notification
          </Button>
        </div>
      </div>
    </section>
  )
}

const Sidebar: Component<{
  instances: SavedInstance[]
  view: View
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onUpdate: (id: string) => void
  onAdd: () => void
  onOpenSettings: () => void
  onOpenStart: () => void
}> = (props) => {
  const settingsSelected = () => props.view.kind === "settings"
  const startSelected = () => props.view.kind === "list"
  return (
    <aside
      data-component="sidebar-rail"
      class="flex h-full w-16 shrink-0 flex-col items-center overflow-hidden border-r border-border-weak-base bg-background-base"
    >
      <div class="flex w-full items-center justify-center pt-2 pb-3">
        <button
          type="button"
          data-desktop-action="logo-home"
          aria-label="Codeplane home"
          aria-current={startSelected() ? "page" : undefined}
          title="Home"
          class="flex size-9 cursor-default items-center justify-center bg-transparent transition-opacity hover:opacity-80 focus:outline-none"
          onClick={() => props.onOpenStart()}
        >
          <Mark class="size-5 opacity-90" />
        </button>
      </div>

      <div class="no-scrollbar flex w-full min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-3 pb-3">
        <For each={props.instances}>
          {(instance) => (
            <button
              type="button"
              data-desktop-action="instance-open"
              data-instance-id={instance.id}
              aria-label={instance.label || (instance.local ? `Local · v${instance.local.binaryVersion}` : instance.url)}
              title={instance.label || (instance.local ? `Local · v${instance.local.binaryVersion}` : instance.url)}
              class="relative flex size-10 cursor-default items-center justify-center overflow-hidden rounded-lg border border-transparent bg-transparent text-text-strong transition-colors hover:border-border-weak-base hover:bg-surface-base-hover focus:outline-none"
              onClick={() => props.onOpen(instance.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                // Shift-right-click → Update (less destructive than Edit
                // because it doesn't enter a multi-step form). Plain
                // right-click stays as Edit so existing muscle memory
                // is preserved. The WelcomePanel still has both as
                // separate icon buttons for users who prefer clicking.
                if (event.shiftKey) {
                  props.onUpdate(instance.id)
                } else {
                  props.onEdit(instance.id)
                }
              }}
            >
              <Show
                when={instance.iconDataUrl}
                fallback={<Icon name={instance.local ? "server" : "globe"} />}
              >
                <img
                  src={instance.iconDataUrl}
                  alt=""
                  class="size-7 rounded-md object-cover"
                  draggable={false}
                />
              </Show>
            </button>
          )}
        </For>

        <button
          type="button"
          data-desktop-action="instance-add"
          aria-label="Add instance"
          title="Add instance"
          class="flex size-10 shrink-0 cursor-default items-center justify-center rounded-lg border border-transparent text-text-weak transition-colors hover:border-border-weak-base hover:bg-surface-base-hover hover:text-text-strong focus:outline-none"
          onClick={() => props.onAdd()}
        >
          <Icon name="plus" />
        </button>
      </div>

      <div class="flex w-full shrink-0 flex-col items-center gap-2 px-3 pt-2 pb-4">
        <button
          type="button"
          data-desktop-action="settings-open"
          aria-label="Settings"
          aria-current={settingsSelected() ? "page" : undefined}
          title="Settings"
          classList={{
            "relative flex size-10 cursor-default items-center justify-center rounded-lg overflow-hidden transition-colors focus:outline-none": true,
            "bg-transparent border-2 border-icon-strong-base text-text-strong": settingsSelected(),
            "bg-transparent border border-transparent text-text-weak hover:border-border-weak-base hover:bg-surface-base-hover hover:text-text-strong":
              !settingsSelected(),
          }}
          onClick={() => props.onOpenSettings()}
        >
          <Icon name="settings-gear" />
        </button>
      </div>
    </aside>
  )
}

const SettingsPanel: Component = () => {
  const onOpenRepo = () => void api.auth.openExternal("https://github.com/devinoldenburg/codeplane")
  return (
    <div class="mx-auto flex w-full max-w-[520px] flex-col px-10 pt-12 pb-10">
      <h1 class="text-text-strong text-[22px] font-semibold leading-tight tracking-tight">Settings</h1>
      <p class="mt-2 text-[13px] leading-relaxed text-text-weak">
        Configure how Codeplane Desktop runs on this machine. Updates here are independent of your remote instance.
      </p>

      <section class="mt-8" data-desktop-section="about">
        <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak">About</span>
        <div class="mt-2 flex flex-col gap-1 border-t border-border-weak-base pt-4">
          <span class="text-[14px] font-semibold text-text-strong">Codeplane Desktop</span>
          <span class="text-[12px] text-text-weak">Version {api.version}</span>
          <div class="mt-2">
            <button
              type="button"
              data-desktop-action="open-repo"
              class="text-[12px] text-text-interactive-base transition-colors hover:underline"
              onClick={onOpenRepo}
            >
              View source on GitHub
            </button>
          </div>
        </div>
      </section>

      <NotificationSettingsCard />

      <section class="mt-8" data-desktop-section="updates">
        <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak">Updates</span>
        <DesktopUpdateCard />
      </section>
    </div>
  )
}

const WelcomePanel: Component<{
  instances: SavedInstance[]
  onAdd: () => void
  onEdit: (id: string) => void
  onOpen: (id: string) => void
  onUpdate: (id: string) => void
  updatingId?: string
}> = (props) => {
  return (
    <div class="mx-auto flex w-full max-w-[520px] flex-col px-10 pt-12 pb-10">
      <h1 class="text-text-strong text-[22px] font-semibold leading-tight tracking-tight">
        Connect to your instance
      </h1>

      <Show
        when={props.instances.length > 0}
        fallback={
          <div class="mt-8 flex items-start gap-3 border border-dashed border-border-weak-base p-5">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-base text-text-weak">
              <Icon name="globe" size="small" />
            </div>
            <div class="flex flex-col gap-1">
              <span class="text-[13px] font-medium text-text-strong">No instances yet</span>
              <span class="text-[12px] leading-relaxed text-text-weak">
                Use the plus button in the sidebar — or the action below — to add your first server.
              </span>
            </div>
          </div>
        }
      >
        <div class="mt-8 flex items-center justify-between">
          <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak">Your instances</span>
          <span class="text-[11px] tabular-nums text-text-weaker">{props.instances.length}</span>
        </div>
        <ul class="mt-2 flex flex-col">
          <For each={props.instances}>
            {(instance, index) => (
              <li
                class="group relative flex items-center transition-colors hover:bg-surface-base"
                classList={{ "border-t border-border-weak-base": index() > 0 }}
              >
                <button
                  type="button"
                  data-desktop-action="instance-open"
                  data-instance-id={instance.id}
                  class="flex flex-1 items-center gap-3 px-2 py-2.5 text-left outline-none focus-visible:bg-surface-base"
                  onClick={() => props.onOpen(instance.id)}
                >
                  <InstanceIcon instance={instance} size="row" />
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-[13px] font-medium text-text-strong">
                      {instance.label ||
                        (instance.local ? `Local · v${instance.local.binaryVersion}` : instance.url)}
                    </span>
                    <span class="truncate text-[12px] text-text-weak">
                      {instance.local
                        ? `Runs locally · v${instance.local.binaryVersion}`
                        : instance.url}
                    </span>
                  </div>
                  <Icon
                    name="chevron-right"
                    size="x-small"
                    class="text-text-weaker opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </button>
                <div class="mr-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton
                    icon="download"
                    size="small"
                    variant="ghost"
                    aria-label={
                      props.updatingId === instance.id
                        ? `Updating ${instance.label || instance.id}…`
                        : instance.local
                          ? `Update local binary for ${instance.label || instance.id}`
                          : `Check for server updates on ${instance.label || instance.id}`
                    }
                    data-desktop-action="instance-update"
                    data-instance-id={instance.id}
                    disabled={!!props.updatingId}
                    onClick={() => props.onUpdate(instance.id)}
                  />
                  <IconButton
                    icon="sliders"
                    size="small"
                    variant="ghost"
                    aria-label="Edit instance"
                    data-desktop-action="instance-edit"
                    data-instance-id={instance.id}
                    disabled={props.updatingId === instance.id}
                    onClick={() => props.onEdit(instance.id)}
                  />
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <div class="mt-5">
        <Button
          variant="secondary"
          size="normal"
          icon="plus-small"
          data-desktop-action="instance-add"
          onClick={() => props.onAdd()}
        >
          Add instance
        </Button>
      </div>
    </div>
  )
}

const InstanceForm: Component<{
  editing?: SavedInstance
  onCancel: () => void
  onSaved: () => void
}> = (props) => {
  // If the saved instance already has an "Authorization: Basic …" header,
  // peel it off so the dedicated username/password fields can pre-fill from
  // it. Anything that isn't the Basic auth header stays in the headers blob
  // so existing CF Access / SSO pastes don't get clobbered.
  const splitBasicAuth = (h: Record<string, string> | undefined) => {
    if (!h) return { user: "", pass: "", rest: undefined as Record<string, string> | undefined }
    const authKey = Object.keys(h).find((k) => k.toLowerCase() === "authorization")
    const authVal = authKey ? h[authKey] : undefined
    const m = authVal && /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authVal.trim())
    if (!authKey || !m) return { user: "", pass: "", rest: h }
    try {
      const decoded = atob(m[1])
      const idx = decoded.indexOf(":")
      if (idx === -1) return { user: "", pass: "", rest: h }
      const rest = { ...h }
      delete rest[authKey]
      return {
        user: decoded.slice(0, idx),
        pass: decoded.slice(idx + 1),
        rest: Object.keys(rest).length ? rest : undefined,
      }
    } catch {
      return { user: "", pass: "", rest: h }
    }
  }
  const initialAuth = splitBasicAuth(props.editing?.headers)

  const [label, setLabel] = createSignal(props.editing?.label ?? "")
  const [url, setUrl] = createSignal(props.editing?.url ?? "")
  const [basicUsername, setBasicUsername] = createSignal(initialAuth.user)
  const [basicPassword, setBasicPassword] = createSignal(initialAuth.pass)
  const [headers, setHeaders] = createSignal(formatHeaders(initialAuth.rest))
  const [ignoreCert, setIgnoreCert] = createSignal(!!props.editing?.ignoreCertificateErrors)
  const [iconDataUrl, setIconDataUrl] = createSignal<string | undefined>(props.editing?.iconDataUrl)
  const [signingIn, setSigningIn] = createSignal(false)
  const [advanced, setAdvanced] = createSignal(
    !!initialAuth.rest || !!props.editing?.ignoreCertificateErrors,
  )

  // Compose the full headers map: dedicated Basic Auth fields override any
  // Authorization line in the headers blob (keeps the form predictable when
  // both are filled — the explicit field wins).
  const composedHeaders = (): Record<string, string> | undefined => {
    const parsed = parseHeaders(headers())
    const user = basicUsername().trim()
    const pass = basicPassword()
    if (user || pass) {
      const authKey = Object.keys(parsed).find((k) => k.toLowerCase() === "authorization")
      if (authKey) delete parsed[authKey]
      parsed["Authorization"] = `Basic ${btoa(`${user}:${pass}`)}`
    }
    return Object.keys(parsed).length ? parsed : undefined
  }
  const [probe, setProbe] = createSignal<{ status: "idle" | "ok" | "error" | "checking"; message?: string }>({
    status: "idle",
  })
  const [saving, setSaving] = createSignal(false)
  const [preparing, setPreparing] = createSignal<PrepareState>()
  const [prepareID, setPrepareID] = createSignal("")
  const busy = createMemo(() => saving() || !!preparing())

  let iconInput: HTMLInputElement | undefined
  const onIconPick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      showToast({ variant: "error", icon: "warning", title: "Pick an image file" })
      return
    }
    if (file.size > 1_500_000) {
      showToast({ variant: "error", icon: "warning", title: "Image too large", description: "Pick something under ~1.5 MB." })
      return
    }
    try {
      const dataUrl = await fileToDataUrl(file)
      setIconDataUrl(dataUrl)
    } catch (error) {
      logSetup("icon.read-error", { error })
      showToast({ variant: "error", icon: "warning", title: "Couldn't read that image" })
    }
  }

  let probeTimer: ReturnType<typeof setTimeout> | undefined

  const offPrepare = api.instances.onPrepareProgress((progress) => {
    if (progress.instanceID !== prepareID()) return
    logSetup("prepare.progress", progress)
    setPreparing((current) => ({
      instanceID: progress.instanceID,
      cacheHit: progress.cacheHit ?? current?.cacheHit,
      completed: progress.completed ?? current?.completed,
      message: progress.message,
      percent: Math.max(current?.percent ?? 0, progress.percent),
      phase: progress.phase,
      total: progress.total ?? current?.total,
      version: progress.version ?? current?.version,
    }))
  })

  onCleanup(() => {
    if (probeTimer) clearTimeout(probeTimer)
    offPrepare()
  })

  const triggerProbe = () => {
    if (probeTimer) clearTimeout(probeTimer)
    const value = url().trim()
    if (!value) {
      setProbe({ status: "idle" })
      return
    }
    setProbe({ status: "checking" })
    logSetup("probe.start", { url: value })
    probeTimer = setTimeout(async () => {
      try {
        const result = await api.instances.probe({
          id: props.editing?.id ?? uid(),
          url: value,
          label: label().trim() || undefined,
          headers: composedHeaders(),
          ignoreCertificateErrors: ignoreCert() || undefined,
          clientCertSubject: props.editing?.clientCertSubject,
        })
        logSetup("probe.result", result)
        if (result.ok) {
          setProbe({
            status: "ok",
            message: result.version
              ? `Reachable. Detected Codeplane ${result.version}.`
              : "Reachable.",
          })
          return
        }
        setProbe({
          status: "error",
          message: `Couldn't verify: ${result.error}. The instance may still load — sign-in flows often gate the version endpoint.`,
        })
      } catch (error) {
        logSetup("probe.error", { error, url: value })
        setProbe({
          status: "error",
          message: `Couldn't verify: ${error instanceof Error ? error.message : String(error)}.`,
        })
      }
    }, 400)
  }

  const probeColor = createMemo(() => {
    switch (probe().status) {
      case "ok":
        return "text-text-success-base"
      case "error":
        return "text-text-critical-base"
      case "checking":
        return "text-text-weak"
      default:
        return "text-text-weak"
    }
  })

  const onSave = async () => {
    if (!url().trim()) {
      setProbe({ status: "error", message: "URL is required." })
      return
    }
    setSaving(true)
    try {
      const instance: SavedInstance = {
        id: props.editing?.id ?? uid(),
        url: url().trim(),
        label: label().trim() || undefined,
        headers: composedHeaders(),
        ignoreCertificateErrors: ignoreCert() || undefined,
        clientCertSubject: props.editing?.clientCertSubject,
        iconDataUrl: iconDataUrl() || undefined,
      }
      logSetup("instance.save", instanceSummary(instance))
      setPrepareID(instance.id)
      setPreparing({
        instanceID: instance.id,
        phase: "probe",
        message: "Checking server version…",
        percent: 5,
      })
      await api.instances.save(instance)
      const prepared = await api.instances.prepare(instance)
      if (!prepared.ok) {
        showToast({
          variant: "error",
          icon: "warning",
          title: "Instance saved, but UI caching needs attention",
          description: prepared.authUrl
            ? "Sign in once when you open this instance, then Codeplane Desktop will cache the matching UI."
            : prepared.error,
        })
        props.onSaved()
        return
      }
      setPreparing({
        instanceID: instance.id,
        phase: "done",
        message: `UI ready for Codeplane ${prepared.version}.`,
        percent: 100,
        version: prepared.version,
        completed: 1,
        total: 1,
      })
      showToast({
        variant: "success",
        icon: "check",
        title: "Instance ready",
        description: `Cached UI for Codeplane ${prepared.version}. You can open it from the list now.`,
      })
      await wait(180)
      props.onSaved()
    } finally {
      setSaving(false)
      setPreparing(undefined)
      setPrepareID("")
    }
  }

  const onDelete = async () => {
    if (!props.editing) return
    logSetup("instance.remove", { id: props.editing.id })
    await api.instances.remove(props.editing.id)
    props.onSaved()
  }

  return (
    <div class="mx-auto flex w-full max-w-[520px] flex-col px-10 pt-10 pb-10">
      <div class="-ml-1 flex items-center gap-1">
        <IconButton
          icon="arrow-left"
          size="small"
          variant="ghost"
          aria-label="Back"
          data-desktop-action="form-back"
          disabled={busy()}
          onClick={() => props.onCancel()}
        />
        <button
          type="button"
          class="text-[12px] text-text-weak transition-colors hover:text-text-strong disabled:opacity-50"
          disabled={busy()}
          onClick={() => props.onCancel()}
        >
          Back
        </button>
      </div>

      <h1 class="mt-4 text-text-strong text-[20px] font-semibold leading-tight tracking-tight">
        {props.editing ? "Edit instance" : "Add a remote instance"}
      </h1>

      <div class="mt-8 flex items-center gap-4 border-t border-border-weak-base pt-5">
        <button
          type="button"
          data-desktop-action="instance-icon-pick"
          class="group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-weak-base bg-surface-base text-text-weak transition-colors hover:border-border-interactive-base hover:text-text-strong focus:outline-none disabled:cursor-not-allowed"
          disabled={busy()}
          onClick={() => iconInput?.click()}
          aria-label="Choose icon"
        >
          <Show when={iconDataUrl()} fallback={<Icon name={props.editing?.local ? "server" : "globe"} />}>
            <img src={iconDataUrl()} alt="" class="size-full object-cover" draggable={false} />
          </Show>
          <span class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Icon name="edit" size="small" class="text-white" />
          </span>
        </button>
        <input
          ref={(el) => (iconInput = el)}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            void onIconPick(file)
          }}
        />
        <div class="flex flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-text-strong">Custom icon</span>
          <span class="text-[12px] leading-relaxed text-text-weak">
            Pick any image from your machine — saved with the instance, only on this device.
          </span>
          <Show when={iconDataUrl()}>
            <button
              type="button"
              class="mt-1 self-start text-[12px] text-text-weak transition-colors hover:text-text-critical-base"
              onClick={() => setIconDataUrl(undefined)}
            >
              Reset to default
            </button>
          </Show>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-1.5">
        <label class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak" for="instance-name">
          Name
        </label>
        <input
          id="instance-name"
          data-desktop-field="instance-name"
          type="text"
          placeholder="My team's instance"
          autocomplete="off"
          disabled={busy()}
          value={label()}
          onInput={(event) => setLabel(event.currentTarget.value)}
          class="rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none transition-colors placeholder:text-text-weaker focus:border-border-interactive-base disabled:opacity-60"
        />
      </div>

      <div class="mt-4 flex flex-col gap-1.5">
        <label class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak" for="instance-url">
          URL
        </label>
        <input
          id="instance-url"
          data-desktop-field="instance-url"
          type="url"
          placeholder="https://codeplane.example.com"
          autocomplete="off"
          spellcheck={false}
          disabled={busy()}
          value={url()}
          onInput={(event) => {
            setUrl(event.currentTarget.value)
            triggerProbe()
          }}
          class="rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none transition-colors placeholder:text-text-weaker focus:border-border-interactive-base disabled:opacity-60"
        />
        <Show
          when={probe().status !== "idle"}
          fallback={
            <span class="text-[12px] leading-relaxed text-text-weak">
              The full base URL. Defaults to https:// if no scheme is supplied.
            </span>
          }
        >
          <span class={`text-[12px] leading-relaxed ${probeColor()}`}>
            {probe().status === "checking" ? "Checking…" : probe().message}
          </span>
        </Show>
      </div>

      <button
        type="button"
        data-desktop-action="advanced-toggle"
        class="mt-5 self-start text-[12px] text-text-weak transition-colors hover:text-text-strong"
        onClick={() => setAdvanced(!advanced())}
      >
        <Icon name={advanced() ? "chevron-down" : "chevron-right"} size="x-small" class="inline-block align-middle" />{" "}
        Advanced auth (optional)
      </button>

      <Show when={advanced()}>
        <div class="mt-3 flex flex-col gap-4 border-t border-border-weak-base pt-4">
          <div class="flex flex-col gap-2">
            <span class="text-[13px] font-medium text-text-strong">HTTP Basic Auth</span>
            <span class="text-[12px] leading-relaxed text-text-weak">
              For instances behind <code class="rounded bg-surface-base px-1 py-0.5 text-text-base">codeplane serve --password</code>.
              Username defaults to <code class="rounded bg-surface-base px-1 py-0.5 text-text-base">codeplane</code>.
            </span>
            <div class="flex gap-2">
              <input
                data-desktop-field="instance-basic-username"
                type="text"
                placeholder="codeplane"
                autocomplete="username"
                class="min-w-0 flex-1 rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none placeholder:text-text-weaker focus:border-border-interactive-base"
                value={basicUsername()}
                disabled={busy()}
                onInput={(event) => setBasicUsername(event.currentTarget.value)}
              />
              <input
                data-desktop-field="instance-basic-password"
                type="password"
                placeholder="••••••••"
                autocomplete="current-password"
                class="min-w-0 flex-1 rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none placeholder:text-text-weaker focus:border-border-interactive-base"
                value={basicPassword()}
                disabled={busy()}
                onInput={(event) => setBasicPassword(event.currentTarget.value)}
              />
            </div>
          </div>

          <div class="flex flex-col gap-2 border-t border-border-weak-base pt-4">
            <span class="text-[13px] font-medium text-text-strong">Sign in with browser (Cloudflare Access / SSO)</span>
            <span class="text-[12px] leading-relaxed text-text-weak">
              For instances behind Cloudflare Access, an identity-aware proxy, or any SSO redirect.
              Opens a browser window at the instance URL, you sign in, and the resulting cookies (e.g.
              <code class="rounded bg-surface-base px-1 py-0.5 text-text-base">CF_Authorization</code>) are
              saved into the headers below. Re-run when the cookie expires — the desktop will also
              bounce back here automatically with an "Sign-in required" toast when the server
              starts returning 401/403.
            </span>
            <Button
              type="button"
              variant="secondary"
              size="small"
              icon="globe"
              data-desktop-action="instance-sso-signin"
              disabled={busy() || signingIn() || !url().trim()}
              onClick={async () => {
                const target = url().trim()
                if (!target) {
                  showToast({ variant: "error", icon: "warning", title: "Enter a URL first" })
                  return
                }
                setSigningIn(true)
                try {
                  const result = await api.instances.signInWithBrowser({
                    id: props.editing?.id ?? uid(),
                    url: target,
                  })
                  if (!result.ok) {
                    showToast({
                      variant: "error",
                      icon: "warning",
                      title: "Sign-in did not complete",
                      description: result.error ?? "No cookies were captured.",
                    })
                    return
                  }
                  // Merge captured cookie line into the existing headers blob
                  // (deduped by header name — last write wins).
                  const parsed = parseHeaders(headers())
                  const cookieKey = Object.keys(parsed).find((k) => k.toLowerCase() === "cookie")
                  if (cookieKey) delete parsed[cookieKey]
                  parsed["Cookie"] = result.cookieHeader
                  setHeaders(formatHeaders(parsed))
                  showToast({
                    variant: "success",
                    icon: "check",
                    title: "Sign-in captured",
                    description: `Saved ${result.cookieCount} cookie${result.cookieCount === 1 ? "" : "s"} to the instance headers.`,
                  })
                } catch (error) {
                  logSetup("instance.sso-signin.error", { error })
                  showToast({
                    variant: "error",
                    icon: "warning",
                    title: "Couldn't open the sign-in window",
                    description: error instanceof Error ? error.message : String(error),
                  })
                } finally {
                  setSigningIn(false)
                }
              }}
            >
              {signingIn() ? "Waiting for sign-in…" : "Open sign-in window"}
            </Button>
          </div>

          <div class="flex flex-col gap-2 border-t border-border-weak-base pt-4">
            <span class="text-[13px] font-medium text-text-strong">Custom request headers</span>
            <textarea
              data-desktop-field="instance-headers"
              class="min-h-[88px] rounded-md border border-border-base bg-surface-raised-base px-3 py-2 font-mono text-[12px] text-text-strong outline-none focus:border-border-interactive-base"
              placeholder="CF-Access-Client-Id: 1234.access&#10;CF-Access-Client-Secret: ..."
              value={headers()}
              disabled={busy()}
              onInput={(event) => setHeaders(event.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <span class="text-[12px] leading-relaxed text-text-weak">
              One <code class="rounded bg-surface-base px-1 py-0.5 text-text-base">Header: value</code> per line. Attached
              to every request to this instance. Headers the page itself sets always win. The
              <code class="rounded bg-surface-base px-1 py-0.5 text-text-base">Authorization</code> header is overridden
              when a Basic Auth username/password is set above.
            </span>
          </div>

          <label class="flex items-start gap-2.5 text-[13px] text-text-base">
            <input
              type="checkbox"
              data-desktop-field="ignore-certificates"
              class="mt-0.5"
              disabled={busy()}
              checked={ignoreCert()}
              onChange={(event) => setIgnoreCert(event.currentTarget.checked)}
            />
            <span class="flex flex-col gap-1">
              <span class="text-text-strong">Trust self-signed TLS certificates</span>
              <span class="text-[12px] text-text-weak">Only enable for trusted internal / dev instances.</span>
            </span>
          </label>
        </div>
      </Show>

      <Show when={preparing()}>
        {(state) => (
          <div class="mt-5 flex flex-col gap-3 border-t border-border-weak-base pt-4" data-desktop-state="prepare">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-[13px] font-medium text-text-strong" data-desktop-prepare-title>
                  Preparing local UI cache
                </span>
                <span class="text-[12px] text-text-weak" data-desktop-prepare-message>
                  {state().message}
                </span>
              </div>
              <span class="text-[12px] font-medium text-text-weak tabular-nums" data-desktop-prepare-percent>
                {Math.round(state().percent)}%
              </span>
            </div>
            <Progress value={state().percent} maxValue={100} hideLabel>
              Preparing local UI cache
            </Progress>
            <Show when={state().completed !== undefined && state().total !== undefined}>
              <span class="text-[12px] text-text-weak">
                {state().cacheHit
                  ? "This version is already cached locally."
                  : `${state().completed ?? 0} of ${state().total ?? 0} assets ready.`}
              </span>
            </Show>
          </div>
        )}
      </Show>

      <div class="mt-6 flex items-center gap-2">
        <Button
          variant="primary"
          size="normal"
          disabled={busy()}
          data-desktop-action="instance-save"
          onClick={() => void onSave()}
        >
          {preparing() ? "Downloading UI…" : saving() ? "Saving…" : "Save & cache UI"}
        </Button>
        <Button
          variant="ghost"
          size="normal"
          disabled={busy()}
          data-desktop-action="form-cancel"
          onClick={() => props.onCancel()}
        >
          Cancel
        </Button>
        <Show when={props.editing}>
          <div class="flex-1" />
          <Button
            variant="ghost"
            size="normal"
            disabled={busy()}
            data-desktop-action="instance-remove"
            onClick={() => void onDelete()}
          >
            Remove
          </Button>
        </Show>
      </div>
    </div>
  )
}

const InstanceTypePicker: Component<{
  onPickRemote: () => void
  onPickLocal: () => void
  onCancel: () => void
}> = (props) => {
  return (
    <div class="mx-auto flex w-full max-w-[520px] flex-col px-10 pt-10 pb-10">
      <div class="-ml-1 flex items-center gap-1">
        <IconButton
          icon="arrow-left"
          size="small"
          variant="ghost"
          aria-label="Back"
          data-desktop-action="picker-back"
          onClick={() => props.onCancel()}
        />
        <button
          type="button"
          class="text-[12px] text-text-weak transition-colors hover:text-text-strong"
          onClick={() => props.onCancel()}
        >
          Back
        </button>
      </div>

      <h1 class="mt-4 text-text-strong text-[20px] font-semibold leading-tight tracking-tight">Add an instance</h1>
      <p class="mt-2 text-[13px] leading-relaxed text-text-weak">
        Connect to a Codeplane server you run elsewhere, or set up a fresh one that runs entirely on this machine.
      </p>

      <div class="mt-6 flex flex-col">
        <button
          type="button"
          data-desktop-action="pick-remote"
          class="group flex w-full items-start gap-3 border-t border-border-weak-base px-1 py-4 text-left outline-none transition-colors hover:bg-surface-base focus-visible:bg-surface-base"
          onClick={() => props.onPickRemote()}
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-interactive-weak text-text-interactive-base">
            <Icon name="globe" size="small" />
          </div>
          <div class="flex flex-1 flex-col gap-1 pt-0.5">
            <span class="text-[13px] font-medium text-text-strong">Connect to a remote server</span>
            <span class="text-[12px] leading-relaxed text-text-weak">
              Point at any URL serving Codeplane — your team's deployment, a self-hosted box, an internal staging
              instance.
            </span>
          </div>
          <Icon
            name="chevron-right"
            size="small"
            class="mt-1 text-text-weaker transition-transform group-hover:translate-x-0.5 group-hover:text-text-strong"
          />
        </button>

        <button
          type="button"
          data-desktop-action="pick-local"
          class="group flex w-full items-start gap-3 border-t border-b border-border-weak-base px-1 py-4 text-left outline-none transition-colors hover:bg-surface-base focus-visible:bg-surface-base"
          onClick={() => props.onPickLocal()}
        >
          <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-success-weak text-icon-success-active">
            <Icon name="server" size="small" />
          </div>
          <div class="flex flex-1 flex-col gap-1 pt-0.5">
            <span class="text-[13px] font-medium text-text-strong">Run a local instance</span>
            <span class="text-[12px] leading-relaxed text-text-weak">
              Download the matching Codeplane binary, run it as a private localhost server, and connect the UI to it.
              No remote server required.
            </span>
          </div>
          <Icon
            name="chevron-right"
            size="small"
            class="mt-1 text-text-weaker transition-transform group-hover:translate-x-0.5 group-hover:text-text-strong"
          />
        </button>
      </div>
    </div>
  )
}

const LocalInstanceForm: Component<{
  editing?: SavedInstance
  onCancel: () => void
  onSaved: () => void
}> = (props) => {
  const [label, setLabel] = createSignal(props.editing?.label ?? "Local Codeplane")
  const [iconDataUrl, setIconDataUrl] = createSignal<string | undefined>(props.editing?.iconDataUrl)
  const [target, setTarget] = createSignal<LocalTarget>()
  const [installed, setInstalled] = createSignal(false)
  const [installing, setInstalling] = createSignal<LocalInstallState>()
  const [preparing, setPreparing] = createSignal<PrepareState>()
  const [prepareID, setPrepareID] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [selectedVersion, setSelectedVersion] = createSignal(props.editing?.local?.binaryVersion ?? "")
  const [availableVersions, setAvailableVersions] = createSignal<string[]>([])
  const [latestVersion, setLatestVersion] = createSignal<string | undefined>(undefined)
  const [versionsError, setVersionsError] = createSignal<string | undefined>(undefined)
  const [versionsLoading, setVersionsLoading] = createSignal(false)
  const busy = createMemo(() => saving() || !!installing() || !!preparing())

  const effectiveVersion = () => selectedVersion() || target()?.defaultVersion || ""

  let iconInput: HTMLInputElement | undefined
  const onIconPick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) {
      showToast({ variant: "error", icon: "warning", title: "Pick an image file" })
      return
    }
    if (file.size > 1_500_000) {
      showToast({ variant: "error", icon: "warning", title: "Image too large", description: "Pick something under ~1.5 MB." })
      return
    }
    try {
      setIconDataUrl(await fileToDataUrl(file))
    } catch (error) {
      logSetup("icon.read-error", { error })
      showToast({ variant: "error", icon: "warning", title: "Couldn't read that image" })
    }
  }

  const refreshInstalled = async (version: string) => {
    if (!version) {
      setInstalled(false)
      return
    }
    try {
      const status = await api.local.status(version)
      setInstalled(status.installed && status.cliInstalled !== false)
    } catch (error) {
      logSetup("local.status-error", { error, version })
      setInstalled(false)
    }
  }

  onMount(async () => {
    const detected = await api.local.target()
    setTarget(detected)
    const initial = props.editing?.local?.binaryVersion || detected.defaultVersion || ""
    setSelectedVersion(initial)
    await refreshInstalled(initial)
    logSetup("local.target", { ...detected, installed: installed() })

    setVersionsLoading(true)
    try {
      const result = await api.local.listVersions()
      if (result.ok) {
        setAvailableVersions(result.versions)
        setLatestVersion(result.latest)
        setVersionsError(undefined)
        if (initial && !result.versions.includes(initial)) {
          setAvailableVersions([initial, ...result.versions])
        }
        logSetup("local.list-versions", { count: result.versions.length, latest: result.latest })
      } else {
        setVersionsError(result.error)
        logSetup("local.list-versions.error", { error: result.error })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setVersionsError(message)
      logSetup("local.list-versions.error", { error: message })
    } finally {
      setVersionsLoading(false)
    }
  })

  const offInstall = api.local.onInstallProgress((progress) => {
    logSetup("local.install.progress", progress)
    setInstalling((current) => ({
      message: progress.message,
      percent: Math.max(current?.percent ?? 0, progress.percent),
      phase: progress.phase,
      binaryVersion: progress.binaryVersion ?? current?.binaryVersion,
      transferred: progress.transferred ?? current?.transferred,
      total: progress.total ?? current?.total,
    }))
  })

  const offPrepare = api.instances.onPrepareProgress((progress) => {
    if (progress.instanceID !== prepareID()) return
    logSetup("local.prepare.progress", progress)
    setPreparing((current) => ({
      instanceID: progress.instanceID,
      cacheHit: progress.cacheHit ?? current?.cacheHit,
      completed: progress.completed ?? current?.completed,
      message: progress.message,
      percent: Math.max(current?.percent ?? 0, progress.percent),
      phase: progress.phase,
      total: progress.total ?? current?.total,
      version: progress.version ?? current?.version,
    }))
  })

  onCleanup(() => {
    offInstall()
    offPrepare()
  })

  const onSave = async () => {
    const detected = target()
    if (!detected) return
    setSaving(true)
    try {
      const desiredVersion = effectiveVersion()
      if (!desiredVersion) {
        showToast({
          variant: "error",
          icon: "warning",
          title: "Couldn't determine local version",
          description: "Try again after Codeplane detects a downloadable local build.",
        })
        return
      }

      // Step 1: ensure the shared local runtime and managed CLI are installed.
      let status = await api.local.status(desiredVersion)
      if (!status.installed || status.cliInstalled === false) {
        setInstalling({
          phase: "detect",
          message: `Preparing local Codeplane ${desiredVersion}…`,
          percent: 2,
        })
        const result = await api.local.install({ version: desiredVersion })
        if (!result.ok) {
          showToast({
            variant: "error",
            icon: "warning",
            title: "Local Codeplane install failed",
            description: result.error,
          })
          setInstalling(undefined)
          return
        }
        status = result
        setInstalling({
          phase: "ready",
          message: `Codeplane ${desiredVersion} installed.`,
          percent: 100,
          binaryVersion: desiredVersion,
        })
        setInstalled(true)
      }

      // Step 2: start the server, prepare the UI cache, then persist the instance.
      const id = props.editing?.id ?? uid()
      const instance: SavedInstance = {
        id,
        url: `local://${id}`,
        label: label().trim() || `Local · v${desiredVersion}`,
        iconDataUrl: iconDataUrl() || undefined,
        local: { binaryVersion: desiredVersion },
      }
      logSetup("local.save", instanceSummary(instance))
      setPrepareID(id)
      setPreparing({
        instanceID: id,
        phase: "probe",
        message: "Starting local Codeplane server…",
        percent: 5,
      })
      const prepared = await api.instances.prepare(instance)
      if (!prepared.ok) {
        if (!props.editing) await api.local.stop(id).catch(() => undefined)
        showToast({
          variant: "error",
          icon: "warning",
          title: props.editing ? "Couldn't save local instance" : "Couldn't set up local instance",
          description: prepared.error,
        })
        return
      }
      await api.instances.save(instance)
      setPreparing({
        instanceID: id,
        phase: "done",
        message: `UI ready for local Codeplane ${prepared.version}.`,
        percent: 100,
        version: prepared.version,
        completed: 1,
        total: 1,
      })
      showToast({
        variant: "success",
        icon: "check",
        title: "Local instance ready",
        description: `Cached UI for Codeplane ${prepared.version}. The server runs on this machine when you open the instance.`,
      })
      await wait(180)
      props.onSaved()
    } finally {
      setSaving(false)
      setInstalling(undefined)
      setPreparing(undefined)
      setPrepareID("")
    }
  }

  const onDelete = async () => {
    if (!props.editing) return
    logSetup("local.remove", { id: props.editing.id })
    await api.instances.remove(props.editing.id)
    props.onSaved()
  }

  return (
    <div class="mx-auto flex w-full max-w-[520px] flex-col px-10 pt-10 pb-10">
      <div class="-ml-1 flex items-center gap-1">
        <IconButton
          icon="arrow-left"
          size="small"
          variant="ghost"
          aria-label="Back"
          data-desktop-action="form-back"
          disabled={busy()}
          onClick={() => props.onCancel()}
        />
        <button
          type="button"
          class="text-[12px] text-text-weak transition-colors hover:text-text-strong disabled:opacity-50"
          disabled={busy()}
          onClick={() => props.onCancel()}
        >
          Back
        </button>
      </div>

      <h1 class="mt-4 text-text-strong text-[20px] font-semibold leading-tight tracking-tight">
        {props.editing ? "Edit local instance" : "Run a local instance"}
      </h1>

      <div class="mt-8 flex items-center gap-4 border-t border-border-weak-base pt-5">
        <button
          type="button"
          data-desktop-action="instance-icon-pick"
          class="group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-weak-base bg-surface-base text-text-weak transition-colors hover:border-border-interactive-base hover:text-text-strong focus:outline-none disabled:cursor-not-allowed"
          disabled={busy()}
          onClick={() => iconInput?.click()}
          aria-label="Choose icon"
        >
          <Show when={iconDataUrl()} fallback={<Icon name="server" />}>
            <img src={iconDataUrl()} alt="" class="size-full object-cover" draggable={false} />
          </Show>
          <span class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Icon name="edit" size="small" class="text-white" />
          </span>
        </button>
        <input
          ref={(el) => (iconInput = el)}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          class="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ""
            void onIconPick(file)
          }}
        />
        <div class="flex flex-1 flex-col gap-1">
          <span class="text-[13px] font-medium text-text-strong">Custom icon</span>
          <span class="text-[12px] leading-relaxed text-text-weak">
            Pick any image from your machine — saved with the instance, only on this device.
          </span>
          <Show when={iconDataUrl()}>
            <button
              type="button"
              class="mt-1 self-start text-[12px] text-text-weak transition-colors hover:text-text-critical-base"
              onClick={() => setIconDataUrl(undefined)}
            >
              Reset to default
            </button>
          </Show>
        </div>
      </div>

      <div class="mt-6 flex flex-col gap-1.5">
        <label class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak" for="local-name">
          Name
        </label>
        <input
          id="local-name"
          data-desktop-field="local-name"
          type="text"
          placeholder="Local Codeplane"
          autocomplete="off"
          disabled={busy()}
          value={label()}
          onInput={(event) => setLabel(event.currentTarget.value)}
          class="rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none transition-colors placeholder:text-text-weaker focus:border-border-interactive-base disabled:opacity-60"
        />
      </div>

      <div class="mt-4 flex flex-col gap-4">
        <Show when={target()}>
          {(detected) => (
            <div class="flex flex-col gap-1 border-t border-border-weak-base pt-4">
              <span class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak">Detected platform</span>
              <span class="text-[13px] text-text-strong">
                {detected().os} / {detected().arch}
              </span>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-1.5">
          <label class="text-[11px] font-medium uppercase tracking-[0.06em] text-text-weak" for="local-version">
            Version
          </label>
          <select
            id="local-version"
            data-desktop-field="local-version"
            disabled={busy() || versionsLoading() || availableVersions().length === 0}
            value={effectiveVersion()}
            onChange={(event) => {
              const next = event.currentTarget.value
              setSelectedVersion(next)
              void refreshInstalled(next)
              logSetup("local.version-pick", { version: next })
            }}
            class="rounded-md border border-border-weak-base bg-surface-raised-base px-3 py-2 text-[13px] text-text-strong outline-none transition-colors focus:border-border-interactive-base disabled:opacity-60"
          >
            <Show when={availableVersions().length === 0 && effectiveVersion()}>
              <option value={effectiveVersion()}>{effectiveVersion()}</option>
            </Show>
            <For each={availableVersions()}>
              {(version) => (
                <option value={version}>
                  {version}
                  {version === latestVersion() ? " (latest)" : ""}
                  {version === target()?.defaultVersion && version !== latestVersion() ? " (default)" : ""}
                </option>
              )}
            </For>
          </select>
          <span class="text-[12px] text-text-weak">
            <Show
              when={!versionsLoading()}
              fallback="Loading available versions…"
            >
              <Show
                when={!versionsError()}
                fallback={`Couldn't load versions from npm — using ${effectiveVersion() || "default"}.`}
              >
                {effectiveVersion()
                  ? `${installed() ? "CLI ready" : "CLI will be installed"} · ${availableVersions().length} versions available`
                  : "Pick a version to install"}
              </Show>
            </Show>
          </span>
        </div>
      </div>

      <Show when={installing()}>
        {(state) => (
          <div class="mt-5 flex flex-col gap-3 border-t border-border-weak-base pt-4" data-desktop-state="local-install">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-[13px] font-medium text-text-strong">Installing local Codeplane</span>
                <span class="text-[12px] text-text-weak">{state().message}</span>
              </div>
              <span class="text-[12px] font-medium text-text-weak tabular-nums">{Math.round(state().percent)}%</span>
            </div>
            <Progress value={state().percent} maxValue={100} hideLabel>
              Installing local Codeplane
            </Progress>
            <Show when={state().total !== undefined && state().transferred !== undefined}>
              <span class="text-[12px] text-text-weak">
                {formatBytes(state().transferred ?? 0)} / {formatBytes(state().total ?? 0)}
              </span>
            </Show>
          </div>
        )}
      </Show>

      <Show when={preparing()}>
        {(state) => (
          <div class="mt-5 flex flex-col gap-3 border-t border-border-weak-base pt-4" data-desktop-state="prepare">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-[13px] font-medium text-text-strong">Preparing local UI cache</span>
                <span class="text-[12px] text-text-weak">{state().message}</span>
              </div>
              <span class="text-[12px] font-medium text-text-weak tabular-nums">{Math.round(state().percent)}%</span>
            </div>
            <Progress value={state().percent} maxValue={100} hideLabel>
              Preparing local UI cache
            </Progress>
          </div>
        )}
      </Show>

      <div class="mt-6 flex items-center gap-2">
        <Button
          variant="primary"
          size="normal"
          disabled={busy() || !target()}
          data-desktop-action="local-save"
          onClick={() => void onSave()}
        >
          {installing()
            ? "Downloading binary…"
            : preparing()
              ? "Caching UI…"
              : saving()
                ? "Saving…"
                : props.editing
                  ? "Save changes"
                  : "Set up local instance"}
        </Button>
        <Button
          variant="ghost"
          size="normal"
          disabled={busy()}
          data-desktop-action="form-cancel"
          onClick={() => props.onCancel()}
        >
          Cancel
        </Button>
        <Show when={props.editing}>
          <div class="flex-1" />
          <Button
            variant="ghost"
            size="normal"
            disabled={busy()}
            data-desktop-action="instance-remove"
            onClick={() => void onDelete()}
          >
            Remove
          </Button>
        </Show>
      </div>
    </div>
  )
}

type View =
  | { kind: "list" }
  | { kind: "picker" }
  | { kind: "remote-form"; editing?: SavedInstance }
  | { kind: "local-form"; editing?: SavedInstance }
  | { kind: "settings" }

export const App: Component = () => {
  const [view, setView] = createSignal<View>({ kind: "list" })
  const [instances, setInstances] = createSignal<SavedInstance[]>([])
  const [opening, setOpening] = createSignal<{ id: string; instance?: SavedInstance; progress: OpenProgress } | undefined>()
  const [updatingId, setUpdatingId] = createSignal<string | undefined>(undefined)
  const params = new URLSearchParams(window.location.search)
  const editId = params.get("edit")

  const offOpenProgress = api.instances.onOpenProgress?.((progress: OpenProgress) => {
    setOpening((current) => {
      if (!current || current.id !== progress.instanceID) return current
      return {
        id: current.id,
        instance: current.instance,
        progress: {
          ...progress,
          percent: Math.max(current.progress.percent, progress.percent),
        },
      }
    })
  })
  onCleanup(() => offOpenProgress?.())

  const refresh = async () => {
    const list = await api.instances.list()
    setInstances(list)
    logSetup("instances.list.loaded", { count: list.length })
  }

  const onOpen = async (id: string) => {
    logSetup("instance.open.click", { id })
    const instance = instances().find((entry) => entry.id === id)
    setOpening({
      id,
      instance,
      progress: { instanceID: id, phase: "probe", message: "Connecting…", percent: 4 },
    })
    try {
      await api.instances.open(id)
    } catch (error) {
      logSetup("instance.open.error", { error, id })
      setOpening(undefined)
      return
    }
    // On success the main process will fade this window out and close it.
    // Keep the overlay visible during the fade so the user never sees the
    // bare list pop back. Clear it only if the open call returned without
    // closing us (e.g. error path).
    setTimeout(() => setOpening(undefined), 800)
  }

  const onEdit = async (id: string) => {
    const list = await api.instances.list()
    const editing = list.find((entry) => entry.id === id)
    logSetup("view.change", {
      id,
      next: editing?.local ? "local-form" : "remote-form",
      reason: "edit",
    })
    setView({ kind: editing?.local ? "local-form" : "remote-form", editing })
  }

  // Per-instance "Update" action surfaced from the WelcomePanel row icon
  // and the Sidebar tile right-click context menu.
  //
  // Local instances → fetch latest npm version, subscribe to
  // local:install-progress, install the new binary, verify with a status
  // probe, then rewrite the saved instance's binaryVersion. Every step
  // logs and surfaces failures with the actual underlying error string
  // so the previous "click and nothing visible happens" is no longer
  // possible.
  //
  // Remote instances → probe /global/version and report the delta. We
  // don't trigger /global/upgrade from here (that requires an
  // authenticated session inside the instance shell, which the
  // in-instance Update flow handles) but we do offer "Open instance"
  // as a toast action so the user can jump straight there.
  const onUpdate = async (id: string) => {
    if (updatingId()) return
    const target = instances().find((entry) => entry.id === id)
    if (!target) return
    const targetLabel = target.label || target.id
    setUpdatingId(id)
    logSetup("instance.update.start", { id, kind: target.local ? "local" : "remote" })

    // Persistent in-progress toast we can update as install-progress
    // events stream from the main process. Stable string id per
    // instance lets `showToast` replace the previous toast in place
    // (see `activeToastsById` map in toast.tsx) instead of stacking
    // a new toast for each progress event. Without this, the install
    // would look like a frozen UI for the duration of the download.
    const progressToastId = `instance-update:${id}`
    const showProgress = (title: string, description?: string) => {
      showToast({
        id: progressToastId,
        variant: "loading",
        title,
        description,
        persistent: true,
      })
    }

    try {
      if (target.local) {
        showProgress(`Updating ${targetLabel}…`, "Checking npm registry…")

        const versionList = await api.local.listVersions()
        if (!versionList.ok) {
          showToast({
            id: progressToastId,
            variant: "error",
            icon: "warning",
            title: `Couldn't reach npm for ${targetLabel}`,
            description: versionList.error,
          })
          logSetup("instance.update.npm-error", { id, error: versionList.error })
          return
        }
        const latest = versionList.latest ?? versionList.distTags?.["latest"]
        if (!latest) {
          showToast({
            id: progressToastId,
            variant: "error",
            icon: "warning",
            title: "npm returned no latest version",
            description: `Got ${versionList.versions.length} versions but no \`latest\` dist-tag.`,
          })
          logSetup("instance.update.no-latest-tag", { id })
          return
        }

        const current = target.local.binaryVersion || ""
        if (current === latest) {
          showToast({
            id: progressToastId,
            variant: "success",
            icon: "check",
            title: `${targetLabel} is already on v${latest}`,
          })
          logSetup("instance.update.already-latest", { id, version: latest })
          return
        }

        // Subscribe to install-progress so the toast description reflects
        // real download/extract progress instead of a frozen "Installing…"
        // message. Cleanup before save so the listener doesn't leak.
        const offProgress = api.local.onInstallProgress((info) => {
          if (info.version !== latest) return
          const pct = Number.isFinite(info.percent) ? `${Math.round(info.percent)}%` : undefined
          showProgress(
            `Updating ${targetLabel}…`,
            [info.message || info.phase, pct].filter(Boolean).join(" · "),
          )
        })

        showProgress(`Updating ${targetLabel}…`, `Downloading v${latest}…`)
        let installResult
        try {
          installResult = await api.local.install({ version: latest })
        } finally {
          offProgress?.()
        }

        if (!installResult.ok) {
          showToast({
            id: progressToastId,
            variant: "error",
            icon: "warning",
            title: `Install of v${latest} failed`,
            description: installResult.error,
          })
          logSetup("instance.update.install-error", { id, version: latest, error: installResult.error })
          return
        }

        // Verify the install actually landed before declaring success and
        // saving. `install` resolved without throwing, but a permissions
        // / disk-full / corrupt-tarball edge case could leave us with no
        // binary on disk. If that happens, refuse to save the new
        // binaryVersion — otherwise the next `open` would fail with a
        // confusing missing-binary error and the user would never connect
        // it back to this Update click.
        showProgress(`Updating ${targetLabel}…`, `Verifying v${latest} on disk…`)
        const verified = await api.local.status(latest)
        if (!verified.installed) {
          showToast({
            id: progressToastId,
            variant: "error",
            icon: "warning",
            title: `Install of v${latest} reported success but binary is missing`,
            description: `Expected at ${verified.binaryPath || "unknown path"}. The npm package may have downloaded but not extracted correctly. Saved binaryVersion was NOT updated. Re-try, or run \`codeplane upgrade ${latest}\` from a shell.`,
          })
          logSetup("instance.update.verify-failed", { id, version: latest, status: verified })
          return
        }

        const updated: SavedInstance = {
          ...target,
          local: { ...target.local, binaryVersion: latest },
        }
        await api.instances.save(updated)
        await refresh()

        showToast({
          id: progressToastId,
          variant: "success",
          icon: "check",
          title: `${targetLabel} updated`,
          description: current ? `v${current} → v${latest}.` : `Now on v${latest}.`,
        })
        logSetup("instance.update.success", { id, from: current, to: latest })
        return
      }

      // Remote instance branch
      showProgress(`Probing ${targetLabel}…`, target.url)
      const probed = await api.instances.probe(target)
      if (!probed.ok) {
        showToast({
          id: progressToastId,
          variant: "error",
          icon: "warning",
          title: `Couldn't probe ${targetLabel}`,
          description: probed.error || (probed.status ? `HTTP ${probed.status}` : "Server unreachable."),
        })
        return
      }
      const cur = probed.version ?? undefined
      const lat = probed.latest ?? undefined
      if (cur && lat && cur !== lat) {
        showToast({
          id: progressToastId,
          variant: "default",
          icon: "warning",
          title: `${targetLabel}: v${cur} → v${lat} available`,
          description: `The remote server reports a newer release. Open the instance and use the in-app Update flow to apply it.`,
          actions: [
            { label: "Open instance", onClick: () => void onOpen(id) },
            { label: "Dismiss", onClick: "dismiss" },
          ],
          persistent: true,
        })
      } else {
        showToast({
          id: progressToastId,
          variant: "success",
          icon: "check",
          title: `${targetLabel} is on v${cur ?? "?"}`,
          description: lat ? `Latest known: v${lat}.` : undefined,
        })
      }
      logSetup("instance.update.remote-probed", { id, current: cur, latest: lat })
    } catch (error) {
      logSetup("instance.update.error", { id, error })
      showToast({
        id: progressToastId,
        variant: "error",
        icon: "warning",
        title: `Update for ${targetLabel} failed`,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setUpdatingId(undefined)
    }
  }

  const onAdd = () => {
    logSetup("view.change", { next: "picker", reason: "add" })
    setView({ kind: "picker" })
  }

  const onBackToList = (reason: string) => {
    logSetup("view.change", { next: "list", reason })
    setView({ kind: "list" })
    void refresh()
  }

  onMount(async () => {
    logSetup("setup.mount", { editId })
    // Surface bounce-back-to-Loader reasons set by the main process when an
    // instance becomes unreachable, returns 401, etc. The query params are
    // written by main.ts → showSetup({ error }). Each kind maps to a clear
    // user-facing toast so it is never a mystery why the user landed back
    // on the Loader.
    const errorKind = params.get("error")
    if (errorKind) {
      const errorMessage = params.get("errorMessage") ?? ""
      const instanceLabel = params.get("errorInstanceLabel")
      const instanceID = params.get("errorInstanceId")
      const target = instanceLabel ? `“${instanceLabel}”` : instanceID ? `“${instanceID}”` : "instance"
      type ToastIcon = "warning"
      const variants: Record<string, { title: string; description: string; icon: ToastIcon }> = {
        unreachable: {
          title: `Couldn't reach ${target}`,
          description:
            errorMessage ||
            "The server didn't respond. Make sure it's running and reachable from this machine, then try again.",
          icon: "warning",
        },
        "auth-required": {
          title: `Sign-in required for ${target}`,
          description:
            errorMessage ||
            "The server returned 401/403. Edit the saved instance and supply the right Authorization header (or fix the password on the server side).",
          icon: "warning",
        },
        "server-error": {
          title: `${target} returned an error`,
          description: errorMessage || "The server responded but the connection failed. Check the server logs.",
          icon: "warning",
        },
        "version-error": {
          title: `${target} is on an incompatible version`,
          description:
            errorMessage ||
            "The desktop app and the server disagree on the protocol version. Update one of them and try again.",
          icon: "warning",
        },
        "unknown-error": {
          title: `Couldn't open ${target}`,
          description: errorMessage || "Something went wrong. Check the desktop log for details.",
          icon: "warning",
        },
      }
      const variant = variants[errorKind] ?? variants["unknown-error"]
      logSetup("setup.bounce", { errorKind, errorMessage, instanceID, instanceLabel })
      showToast({
        variant: "error",
        icon: variant.icon,
        title: variant.title,
        description: variant.description,
        persistent: true,
        actions:
          errorKind === "auth-required" && instanceID
            ? [
                {
                  label: "Edit instance",
                  onClick: () => setView({ kind: "remote-form", editing: instances().find((i) => i.id === instanceID) }),
                },
                { label: "Dismiss", onClick: "dismiss" },
              ]
            : [{ label: "Dismiss", onClick: "dismiss" }],
      })
      // Strip the error query so a refresh of the Loader doesn't re-toast.
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.delete("error")
      nextUrl.searchParams.delete("errorMessage")
      nextUrl.searchParams.delete("errorInstanceId")
      nextUrl.searchParams.delete("errorInstanceLabel")
      window.history.replaceState({}, "", nextUrl.toString())
    }
    await refresh()
    if (editId) {
      const list = await api.instances.list()
      const match = list.find((entry) => entry.id === editId)
      logSetup("setup.edit-load", { editId, found: !!match, kind: match?.local ? "local" : "remote" })
      if (match) setView({ kind: match.local ? "local-form" : "remote-form", editing: match })
      return
    }
    const dev = params.get("view")
    if (dev === "picker") setView({ kind: "picker" })
    else if (dev === "remote") setView({ kind: "remote-form" })
    else if (dev === "local") setView({ kind: "local-form" })
    else if (dev === "settings") setView({ kind: "settings" })
  })

  const currentEditing = () => {
    const v = view()
    if (v.kind === "remote-form" || v.kind === "local-form") return v.editing
    return undefined
  }

  return (
    <div
      class="flex h-screen w-screen flex-col"
      onClick={(event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const action = target.closest<HTMLElement>("[data-desktop-action]")?.dataset.desktopAction
        if (!action) return
        logSetup("action.click", { action })
      }}
    >
      <div class="drag h-11 shrink-0 bg-background-base" data-component="setup-titlebar" />
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          instances={instances()}
          view={view()}
          onOpen={onOpen}
          onEdit={onEdit}
          onUpdate={(id) => void onUpdate(id)}
          onAdd={onAdd}
          onOpenSettings={() => {
            logSetup("view.change", { next: "settings", reason: "settings" })
            setView({ kind: "settings" })
          }}
          onOpenStart={() => onBackToList("logo-home")}
        />
        <main class="no-scrollbar relative flex-1 min-w-0 overflow-y-auto">
          <Show when={opening()}>
            {(state) => (
              <div
                class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background-base/85 backdrop-blur-sm"
                data-desktop-state="opening"
              >
                <div class="flex w-full max-w-[360px] flex-col items-center gap-4 px-8">
                  <div class="flex flex-col items-center gap-1">
                    <span class="text-[14px] font-semibold text-text-strong">
                      Opening {state().instance?.label || "instance"}
                    </span>
                    <span class="text-[12px] text-text-weak">{state().progress.message}</span>
                  </div>
                  <div class="w-full">
                    <Progress value={state().progress.percent} maxValue={100} hideLabel>
                      Loading instance UI
                    </Progress>
                  </div>
                  <Show when={state().progress.total !== undefined && state().progress.completed !== undefined}>
                    <span class="text-[11px] tabular-nums text-text-weaker">
                      {state().progress.cacheHit
                        ? "Already cached locally"
                        : `${state().progress.completed} / ${state().progress.total}`}
                    </span>
                  </Show>
                </div>
              </div>
            )}
          </Show>
          <Show when={view().kind === "list"}>
            <WelcomePanel
              instances={instances()}
              onAdd={onAdd}
              onEdit={onEdit}
              onOpen={onOpen}
              onUpdate={(id) => void onUpdate(id)}
              updatingId={updatingId()}
            />
          </Show>
          <Show when={view().kind === "settings"}>
            <SettingsPanel />
          </Show>
          <Show when={view().kind === "picker"}>
            <InstanceTypePicker
              onCancel={() => onBackToList("picker-cancel")}
              onPickRemote={() => {
                logSetup("view.change", { next: "remote-form", reason: "picker-remote" })
                setView({ kind: "remote-form" })
              }}
              onPickLocal={() => {
                logSetup("view.change", { next: "local-form", reason: "picker-local" })
                setView({ kind: "local-form" })
              }}
            />
          </Show>
          <Show when={view().kind === "remote-form"}>
            <InstanceForm
              editing={currentEditing()}
              onCancel={() => onBackToList("cancel")}
              onSaved={() => onBackToList("saved")}
            />
          </Show>
          <Show when={view().kind === "local-form"}>
            <LocalInstanceForm
              editing={currentEditing()}
              onCancel={() => onBackToList("cancel")}
              onSaved={() => onBackToList("saved")}
            />
          </Show>
        </main>
      </div>
    </div>
  )
}
