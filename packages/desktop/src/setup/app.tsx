import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@codeplane-ai/ui/button"
import { TextField } from "@codeplane-ai/ui/text-field"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Card } from "@codeplane-ai/ui/card"
import { Progress } from "@codeplane-ai/ui/progress"
import { showToast } from "@codeplane-ai/ui/toast"
import type { CodePlaneDesktopAPI } from "../main/preload"

type SavedInstance = {
  id: string
  url: string
  label?: string
  headers?: Record<string, string>
  ignoreCertificateErrors?: boolean
  clientCertSubject?: string
}

type PrepareState = {
  phase: "probe" | "download" | "finalize" | "done"
  message: string
  percent: number
  version?: string
  completed?: number
  total?: number
  cacheHit?: boolean
}

declare global {
  interface Window {
    codeplaneDesktop: CodePlaneDesktopAPI
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
  }
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(":")
    if (idx === -1) continue
    const name = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!name || !value) continue
    out[name] = value
  }
  return out
}

function formatHeaders(headers: Record<string, string> | undefined): string {
  if (!headers) return ""
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n")
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const InstanceList: Component<{ onAdd: () => void; onEdit: (id: string) => void }> = (props) => {
  const [instances, setInstances] = createSignal<SavedInstance[]>([])
  const [checking, setChecking] = createSignal(false)

  const refresh = async () => {
    const list = await api.instances.list()
    setInstances(list)
    logSetup("instances.list.loaded", { count: list.length })
  }

  onMount(() => void refresh())

  const onCheckUpdates = async () => {
    setChecking(true)
    try {
      const result = await api.updater.check()
      logSetup("updates.check.result", result)
      if ("ok" in result && result.ok) {
        showToast({
          variant: "success",
          icon: "check",
          title: result.updateAvailable
            ? `Update ${result.version ?? ""} downloading…`
            : "Already on the latest version",
        })
      } else if ("error" in result) {
        showToast({ variant: "error", icon: "warning", title: "Update check failed", description: result.error })
      }
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error)
      logSetup("updates.check.error", { error })
      showToast({ variant: "error", icon: "warning", title: "Update check failed", description })
    } finally {
      setChecking(false)
    }
  }

  const onOpen = async (id: string) => {
    logSetup("instance.open.click", { id })
    await api.instances.open(id)
  }

  return (
    <div class="flex flex-col gap-6 max-w-[640px] mx-auto px-8 pt-12 pb-10">
      <div class="text-16-medium text-text-strong">Codeplane Desktop</div>

      <div class="flex flex-col gap-2">
        <h1 class="text-20-medium text-text-strong tracking-tight">Connect to your instance</h1>
        <p class="text-14-regular text-text-weak leading-relaxed">
          Codeplane Desktop always starts here. Pick a server, and the app downloads the matching UI for that server
          version into a local cache so switching back is fast, while desktop updates stay separate from your server
          updates.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Show
          when={instances().length > 0}
          fallback={
            <Card class="px-4 py-6">
              <div class="text-14-regular text-text-weak text-center">No instances yet — add one to get started.</div>
            </Card>
          }
        >
          <For each={instances()}>
            {(instance) => (
              <div class="group flex items-center gap-2 rounded-md border border-border-weak-base bg-surface-raised-base px-2 py-2 transition-colors hover:border-border-interactive-base hover:bg-surface-raised-base-hover">
                <button
                  type="button"
                  data-desktop-action="instance-open"
                  data-instance-id={instance.id}
                  class="flex flex-1 items-center gap-3 rounded-md px-2 py-1 text-left"
                  onClick={() => void onOpen(instance.id)}
                >
                  <div class="flex size-8 items-center justify-center rounded-lg bg-surface-interactive-base-subtle text-text-interactive">
                    <Icon name="globe" size="small" />
                  </div>
                  <div class="flex min-w-0 flex-1 flex-col">
                    <span class="text-14-medium text-text-strong truncate">{instance.label || instance.url}</span>
                    <span class="text-12-regular text-text-weak truncate">{instance.url}</span>
                  </div>
                </button>
                <div class="opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton
                    icon="settings-gear"
                    size="small"
                    variant="ghost"
                    aria-label="Edit instance"
                    data-desktop-action="instance-edit"
                    data-instance-id={instance.id}
                    onClick={() => props.onEdit(instance.id)}
                  />
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <div class="flex items-center gap-2">
        <Button
          variant="primary"
          size="normal"
          icon="plus-small"
          data-desktop-action="instance-add"
          onClick={() => props.onAdd()}
        >
          Add instance
        </Button>
        <Button
          variant="ghost"
          size="normal"
          disabled={checking()}
          data-desktop-action="updates-check"
          onClick={() => void onCheckUpdates()}
        >
          {checking() ? "Checking…" : "Check for updates"}
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
  const [label, setLabel] = createSignal(props.editing?.label ?? "")
  const [url, setUrl] = createSignal(props.editing?.url ?? "")
  const [headers, setHeaders] = createSignal(formatHeaders(props.editing?.headers))
  const [ignoreCert, setIgnoreCert] = createSignal(!!props.editing?.ignoreCertificateErrors)
  const [advanced, setAdvanced] = createSignal(!!props.editing?.headers || !!props.editing?.ignoreCertificateErrors)
  const [probe, setProbe] = createSignal<{ status: "idle" | "ok" | "error" | "checking"; message?: string }>({
    status: "idle",
  })
  const [saving, setSaving] = createSignal(false)
  const [preparing, setPreparing] = createSignal<PrepareState>()
  const [prepareID, setPrepareID] = createSignal("")
  const busy = createMemo(() => saving() || !!preparing())

  let probeTimer: ReturnType<typeof setTimeout> | undefined

  const offPrepare = api.instances.onPrepareProgress((progress) => {
    if (progress.instanceID !== prepareID()) return
    logSetup("prepare.progress", progress)
    setPreparing((current) => ({
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
        const parsed = parseHeaders(headers())
        const result = await api.instances.probe({
          id: props.editing?.id ?? uid(),
          url: value,
          label: label().trim() || undefined,
          headers: Object.keys(parsed).length ? parsed : undefined,
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
      const parsed = parseHeaders(headers())
      const instance: SavedInstance = {
        id: props.editing?.id ?? uid(),
        url: url().trim(),
        label: label().trim() || undefined,
        headers: Object.keys(parsed).length ? parsed : undefined,
        ignoreCertificateErrors: ignoreCert() || undefined,
        clientCertSubject: props.editing?.clientCertSubject,
      }
      logSetup("instance.save", instanceSummary(instance))
      setPrepareID(instance.id)
      setPreparing({
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
    <div class="flex flex-col gap-5 max-w-[640px] mx-auto px-8 pt-10 pb-10">
      <div class="flex items-center gap-3">
        <IconButton
          icon="arrow-left"
          size="small"
          variant="ghost"
          aria-label="Back"
          data-desktop-action="form-back"
          disabled={busy()}
          onClick={() => props.onCancel()}
        />
        <h1 class="text-16-medium text-text-strong tracking-tight">
          {props.editing ? "Edit instance" : "Add instance"}
        </h1>
      </div>

      <p class="text-14-regular text-text-weak leading-relaxed">
        Point the desktop app at any URL serving the Codeplane web UI. Codeplane caches one UI bundle per detected
        server version locally, reuses it when you come back, and removes unused versions after 30 days.
      </p>

      <Card class="flex flex-col gap-4 p-5">
        <TextField
          label="Name"
          placeholder="My team's instance"
          value={label()}
          onChange={(value) => setLabel(value)}
          data-desktop-field="instance-name"
          autocomplete="off"
          disabled={busy()}
        />

        <div class="flex flex-col gap-1.5">
          <TextField
            label="URL"
            placeholder="https://codeplane.example.com"
            value={url()}
            onChange={(value) => {
              setUrl(value)
              triggerProbe()
            }}
            data-desktop-field="instance-url"
            autocomplete="off"
            disabled={busy()}
            spellcheck={false}
            description="The full base URL of the instance. Defaults to https:// if no scheme is supplied."
          />
          <Show when={probe().status !== "idle"}>
            <span class={`text-12-regular ${probeColor()}`}>
              {probe().status === "checking" ? "Checking…" : probe().message}
            </span>
          </Show>
        </div>
      </Card>

      <button
        type="button"
        data-desktop-action="advanced-toggle"
        class="text-12-regular text-text-weak self-start hover:text-text-strong"
        onClick={() => setAdvanced(!advanced())}
      >
        <Icon name={advanced() ? "chevron-down" : "chevron-right"} size="x-small" class="inline-block align-middle" />{" "}
        Advanced auth (optional)
      </button>

      <Show when={advanced()}>
        <Card class="flex flex-col gap-4 p-5">
          <div class="flex flex-col gap-2">
            <span class="text-14-medium text-text-strong">Custom request headers</span>
            <textarea
              data-desktop-field="instance-headers"
              class="min-h-[88px] rounded-md border border-border-base bg-surface-raised-base px-3 py-2 font-mono text-12-regular text-text-strong outline-none focus:border-border-interactive-base focus:shadow-[0_0_0_3px_var(--surface-interactive-base-subtle)]"
              placeholder="CF-Access-Client-Id: 1234.access&#10;CF-Access-Client-Secret: ..."
              value={headers()}
              disabled={busy()}
              onInput={(event) => setHeaders(event.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <span class="text-12-regular text-text-weak leading-relaxed">
              One <code class="rounded bg-surface-raised-base px-1 py-0.5 text-text-base">Header: value</code> per line.
              Attached to every request to this instance. Common uses: Cloudflare Access service tokens, Authorization
              bearer tokens, internal proxy headers. Headers the page itself sets always win.
            </span>
          </div>

          <label class="flex items-start gap-2.5 text-14-regular text-text-base">
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
              <span class="text-12-regular text-text-weak">Only enable for trusted internal/dev instances.</span>
            </span>
          </label>
        </Card>
      </Show>

      <Show when={preparing()}>
        {(state) => (
          <Card class="flex flex-col gap-3 p-5" data-desktop-state="prepare">
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-col gap-1">
                <span class="text-14-medium text-text-strong" data-desktop-prepare-title>
                  Preparing local UI cache
                </span>
                <span class="text-12-regular text-text-weak" data-desktop-prepare-message>
                  {state().message}
                </span>
              </div>
              <span class="text-12-medium text-text-weak tabular-nums" data-desktop-prepare-percent>
                {Math.round(state().percent)}%
              </span>
            </div>
            <Progress value={state().percent} maxValue={100} hideLabel>
              Preparing local UI cache
            </Progress>
            <Show when={state().completed !== undefined && state().total !== undefined}>
              <span class="text-12-regular text-text-weak">
                {state().cacheHit
                  ? "This version is already cached locally."
                  : `${state().completed ?? 0} of ${state().total ?? 0} assets ready.`}
              </span>
            </Show>
          </Card>
        )}
      </Show>

      <div class="flex items-center gap-2">
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

export const App: Component = () => {
  const [view, setView] = createSignal<{ kind: "list" } | { kind: "form"; editing?: SavedInstance }>({ kind: "list" })
  const params = new URLSearchParams(window.location.search)
  const editId = params.get("edit")

  onMount(async () => {
    logSetup("setup.mount", { editId })
    if (editId) {
      const list = await api.instances.list()
      const match = list.find((entry) => entry.id === editId)
      logSetup("setup.edit-load", { editId, found: !!match })
      if (match) setView({ kind: "form", editing: match })
    }
  })

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
      <div class="drag h-9 shrink-0 border-b border-border-weak-base bg-background-base" />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <Show
          when={view().kind === "form"}
          fallback={
            <InstanceList
              onAdd={() => {
                logSetup("view.change", { next: "form", reason: "add" })
                setView({ kind: "form" })
              }}
              onEdit={async (id) => {
                const list = await api.instances.list()
                const editing = list.find((entry) => entry.id === id)
                logSetup("view.change", { id, next: "form", reason: "edit" })
                setView({ kind: "form", editing })
              }}
            />
          }
        >
          <InstanceForm
            editing={view().kind === "form" ? (view() as { kind: "form"; editing?: SavedInstance }).editing : undefined}
            onCancel={() => {
              logSetup("view.change", { next: "list", reason: "cancel" })
              setView({ kind: "list" })
            }}
            onSaved={() => {
              logSetup("view.change", { next: "list", reason: "saved" })
              setView({ kind: "list" })
            }}
          />
        </Show>
      </div>
    </div>
  )
}
