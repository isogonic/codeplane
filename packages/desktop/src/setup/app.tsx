import { Component, For, Show, createMemo, createSignal, onMount } from "solid-js"
import { Button } from "@codeplane-ai/ui/button"
import { TextField } from "@codeplane-ai/ui/text-field"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Card } from "@codeplane-ai/ui/card"
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

declare global {
  interface Window {
    codeplaneDesktop: CodePlaneDesktopAPI
  }
}

const api = window.codeplaneDesktop

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

const InstanceList: Component<{ onAdd: () => void; onEdit: (id: string) => void }> = (props) => {
  const [instances, setInstances] = createSignal<SavedInstance[]>([])
  const [checking, setChecking] = createSignal(false)

  const refresh = async () => {
    const list = await api.instances.list()
    setInstances(list)
  }

  onMount(refresh)

  const onCheckUpdates = async () => {
    setChecking(true)
    try {
      const result = await api.updater.check()
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
    } finally {
      setChecking(false)
    }
  }

  const onOpen = async (id: string) => {
    await api.instances.open(id)
  }

  return (
    <div class="flex flex-col gap-6 max-w-[640px] mx-auto px-8 pt-12 pb-10">
      <div class="flex items-center gap-3">
        <span class="flex size-9 items-center justify-center rounded-xl bg-surface-interactive-base text-text-on-interactive shadow-sm">
          <Icon name="sparkle" size="small" />
        </span>
        <span class="text-16-medium text-text-strong">CodePlane Desktop</span>
      </div>

      <div class="flex flex-col gap-2">
        <h1 class="text-20-medium text-text-strong tracking-tight">Connect to your instance</h1>
        <p class="text-14-regular text-text-weak leading-relaxed">
          The desktop app loads the full CodePlane web UI from any instance you control — your own deployment, a
          colleague's, or a hosted one. Sign-in works the way the instance is configured: OAuth, SSO, magic links,
          Cloudflare Access, basic auth, mTLS, or anything else the page itself prompts for.
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
              <button
                type="button"
                class="group flex items-center gap-3 rounded-md border border-border-weak-base bg-surface-raised-base px-4 py-3 text-left transition-colors hover:border-border-interactive-base hover:bg-surface-raised-base-hover"
                onClick={() => void onOpen(instance.id)}
              >
                <div class="flex size-8 items-center justify-center rounded-lg bg-surface-interactive-base-subtle text-text-interactive">
                  <Icon name="globe" size="small" />
                </div>
                <div class="flex flex-1 min-w-0 flex-col">
                  <span class="text-14-medium text-text-strong truncate">{instance.label || instance.url}</span>
                  <span class="text-12-regular text-text-weak truncate">{instance.url}</span>
                </div>
                <span
                  class="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onEdit(instance.id)
                  }}
                >
                  <IconButton icon="settings-gear" size="small" variant="ghost" aria-label="Edit instance" />
                </span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="flex items-center gap-2">
        <Button variant="primary" size="normal" icon="plus-small" onClick={() => props.onAdd()}>
          Add instance
        </Button>
        <Button variant="ghost" size="normal" disabled={checking()} onClick={() => void onCheckUpdates()}>
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

  let probeTimer: ReturnType<typeof setTimeout> | undefined

  const triggerProbe = () => {
    if (probeTimer) clearTimeout(probeTimer)
    const value = url().trim()
    if (!value) {
      setProbe({ status: "idle" })
      return
    }
    setProbe({ status: "checking" })
    probeTimer = setTimeout(async () => {
      const result = await api.instances.probe(value)
      if (result.ok) {
        setProbe({
          status: "ok",
          message: result.version
            ? `Reachable. Detected CodePlane ${result.version}.`
            : "Reachable.",
        })
      } else {
        setProbe({
          status: "error",
          message: `Couldn't verify: ${result.error}. The instance may still load — sign-in flows often gate the version endpoint.`,
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
      await api.instances.save(instance)
      await api.instances.open(instance.id)
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!props.editing) return
    await api.instances.remove(props.editing.id)
    props.onSaved()
  }

  return (
    <div class="flex flex-col gap-5 max-w-[640px] mx-auto px-8 pt-10 pb-10">
      <div class="flex items-center gap-3">
        <IconButton icon="arrow-left" size="small" variant="ghost" aria-label="Back" onClick={() => props.onCancel()} />
        <h1 class="text-16-medium text-text-strong tracking-tight">
          {props.editing ? "Edit instance" : "Add instance"}
        </h1>
      </div>

      <p class="text-14-regular text-text-weak leading-relaxed">
        Point the desktop app at any URL serving the CodePlane web UI. The full interface is downloaded from that
        instance every time it loads, exactly like opening it in a browser — but with a persistent native session that
        survives restarts.
      </p>

      <Card class="flex flex-col gap-4 p-5">
        <TextField
          label="Name"
          placeholder="My team's instance"
          value={label()}
          onChange={(value) => setLabel(value)}
          autocomplete="off"
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
            autocomplete="off"
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
              class="min-h-[88px] rounded-md border border-border-base bg-surface-raised-base px-3 py-2 font-mono text-12-regular text-text-strong outline-none focus:border-border-interactive-base focus:shadow-[0_0_0_3px_var(--surface-interactive-base-subtle)]"
              placeholder="CF-Access-Client-Id: 1234.access&#10;CF-Access-Client-Secret: ..."
              value={headers()}
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
              class="mt-0.5"
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

      <div class="flex items-center gap-2">
        <Button variant="primary" size="normal" disabled={saving()} onClick={() => void onSave()}>
          {saving() ? "Connecting…" : "Save & connect"}
        </Button>
        <Button variant="ghost" size="normal" onClick={() => props.onCancel()}>
          Cancel
        </Button>
        <Show when={props.editing}>
          <div class="flex-1" />
          <Button variant="ghost" size="normal" onClick={() => void onDelete()}>
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
    if (editId) {
      const list = await api.instances.list()
      const match = list.find((entry) => entry.id === editId)
      if (match) setView({ kind: "form", editing: match })
    }
  })

  return (
    <div class="flex h-screen w-screen flex-col">
      <div class="drag h-9 shrink-0 border-b border-border-weak-base bg-background-base" />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <Show
          when={view().kind === "form"}
          fallback={
            <InstanceList
              onAdd={() => setView({ kind: "form" })}
              onEdit={async (id) => {
                const list = await api.instances.list()
                const editing = list.find((entry) => entry.id === id)
                setView({ kind: "form", editing })
              }}
            />
          }
        >
          <InstanceForm
            editing={view().kind === "form" ? (view() as { kind: "form"; editing?: SavedInstance }).editing : undefined}
            onCancel={() => setView({ kind: "list" })}
            onSaved={() => setView({ kind: "list" })}
          />
        </Show>
      </div>
    </div>
  )
}
