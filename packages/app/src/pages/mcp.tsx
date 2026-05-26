import { useNavigate } from "@solidjs/router"
import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Switch } from "@codeplane-ai/ui/switch"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { McpLocalConfig, McpRemoteConfig, McpStatus } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

type McpConfig = McpLocalConfig | McpRemoteConfig
type McpServerEntry = {
  name: string
  config: McpConfig
  status?: McpStatus
}

type McpKind = "local" | "remote"

type FormRow = { key: string; value: string }
type FormState = {
  name: string
  kind: McpKind
  enabled: boolean
  command: string
  url: string
  timeout: string
  environment: FormRow[]
  headers: FormRow[]
  errors: { name?: string; command?: string; url?: string }
}

const newRow = (): FormRow => ({ key: "", value: "" })

const statusKeys = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
  needs_client_registration: "mcp.status.needs_auth",
} as const

export function McpSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const navigate = useNavigate()
  const page = () => props.layout === "page"

  const [statuses, statusActions] = createResource<Record<string, McpStatus>>(async () => {
    const result = await globalSDK.client.mcp.status().catch(() => null)
    return (result?.data ?? {}) as Record<string, McpStatus>
  })

  const servers = createMemo<McpServerEntry[]>(() => {
    const config = globalSync.data.config.mcp ?? {}
    const live = statuses() ?? {}
    const entries: McpServerEntry[] = []
    for (const [name, raw] of Object.entries(config)) {
      if (!raw || typeof raw !== "object") continue
      if (!("type" in raw)) continue
      entries.push({ name, config: raw as McpConfig, status: live[name] })
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  })

  const enabledCount = createMemo(() => servers().filter((s) => s.config.enabled !== false).length)

  const setEnabled = useMutation(() => ({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) => {
      const config = globalSync.data.config.mcp ?? {}
      const current = config[name]
      if (!current || !("type" in current)) throw new Error("not found")
      const next = { ...config, [name]: { ...current, enabled } }
      await globalSync.updateConfig({ mcp: next })
      if (enabled) {
        await globalSDK.client.mcp.connect({ name }).catch(() => undefined)
      } else {
        await globalSDK.client.mcp.disconnect({ name }).catch(() => undefined)
      }
      void statusActions.refetch()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const remove = useMutation(() => ({
    mutationFn: async (name: string) => {
      const config = { ...(globalSync.data.config.mcp ?? {}) }
      delete config[name]
      await globalSync.updateConfig({ mcp: config })
      void statusActions.refetch()
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("mcp.toast.removed"),
      })
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const openEditor = (entry?: McpServerEntry) => {
    dialog.show(() => <McpEditorDialog entry={entry} />)
  }

  return (
    <>
      <div
        classList={{
          "shrink-0 flex items-center gap-4": true,
          "justify-between border-b border-border-weak-base pb-4": !page(),
          "justify-end": page(),
        }}
      >
        <Show when={!page()}>
          <div class="min-w-0">
            <div class="text-20-medium text-text-strong truncate">{language.t("mcp.page.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("mcp.page.subtitle", { enabled: enabledCount(), total: servers().length })}
            </div>
          </div>
        </Show>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="large" icon="shield" onClick={() => navigate("/settings/secrets")}>
            {language.t("secrets.page.title")}
          </Button>
          <Button variant="primary" size="large" icon="plus-small" onClick={() => openEditor()}>
            {language.t("mcp.page.add")}
          </Button>
        </div>
      </div>

      <Show
        when={servers().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {language.t("mcp.page.empty")}
          </div>
        }
      >
        <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={servers()}>
            {(server) => (
              <McpRow
                server={server}
                toggling={() => setEnabled.isPending && setEnabled.variables?.name === server.name}
                onToggle={(enabled) => setEnabled.mutate({ name: server.name, enabled })}
                onEdit={() => openEditor(server)}
                onRemove={() => {
                  if (!window.confirm(language.t("mcp.page.confirm.remove", { name: server.name }))) return
                  remove.mutate(server.name)
                }}
              />
            )}
          </For>
        </ul>
      </Show>
    </>
  )
}

export default function McpPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <McpSettings />
      </div>
    </div>
  )
}

function McpRow(props: {
  server: McpServerEntry
  toggling: () => boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const statusLabel = () => {
    const s = props.server.config.enabled === false ? "disabled" : props.server.status?.status
    if (!s) return undefined
    const key = statusKeys[s as keyof typeof statusKeys]
    return key ? language.t(key) : s
  }
  const enabled = () => props.server.config.enabled !== false
  const hint = () => {
    if (props.server.config.type === "remote") return props.server.config.url
    if (props.server.config.type === "local")
      return Array.isArray(props.server.config.command) ? props.server.config.command.join(" ") : ""
    return ""
  }
  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="mcp" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate text-14-medium text-text-strong">{props.server.name}</span>
            <Tag>{props.server.config.type}</Tag>
            <Show when={statusLabel()}>
              <span class="text-11-regular text-text-weak">{statusLabel()}</span>
            </Show>
          </div>
          <Show when={hint()}>
            <div class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{hint()}</div>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Switch checked={enabled()} disabled={props.toggling()} onChange={(value) => props.onToggle(value)} hideLabel>
            {language.t("common.enabled")}
          </Switch>
          <IconButton
            icon="edit"
            variant="ghost"
            size="normal"
            aria-label={language.t("common.edit")}
            onClick={props.onEdit}
          />
          <IconButton
            icon="trash"
            variant="ghost"
            size="normal"
            aria-label={language.t("common.delete")}
            onClick={props.onRemove}
          />
        </div>
      </div>
    </li>
  )
}

function McpEditorDialog(props: { entry?: McpServerEntry }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()

  const isEdit = !!props.entry

  const initial = (): FormState => {
    const entry = props.entry
    if (!entry) {
      return {
        name: "",
        kind: "local",
        enabled: true,
        command: "",
        url: "",
        timeout: "",
        environment: [newRow()],
        headers: [newRow()],
        errors: {},
      }
    }
    const config = entry.config
    if (config.type === "local") {
      return {
        name: entry.name,
        kind: "local",
        enabled: config.enabled !== false,
        command: Array.isArray(config.command) ? config.command.join(" ") : "",
        url: "",
        timeout: config.timeout ? String(config.timeout) : "",
        environment: Object.entries(config.environment ?? {}).map(([k, v]) => ({ key: k, value: v })) || [newRow()],
        headers: [newRow()],
        errors: {},
      }
    }
    return {
      name: entry.name,
      kind: "remote",
      enabled: config.enabled !== false,
      command: "",
      url: config.url,
      timeout: config.timeout ? String(config.timeout) : "",
      environment: [newRow()],
      headers: Object.entries(config.headers ?? {}).map(([k, v]) => ({ key: k, value: v })) || [newRow()],
      errors: {},
    }
  }

  const [form, setForm] = createStore<FormState>(initial())

  const validate = () => {
    const errors: FormState["errors"] = {}
    if (!form.name.trim()) errors.name = language.t("mcp.editor.error.name")
    if (!isEdit && globalSync.data.config.mcp && form.name.trim() in globalSync.data.config.mcp)
      errors.name = language.t("mcp.editor.error.duplicate")
    if (form.kind === "local" && !form.command.trim()) errors.command = language.t("mcp.editor.error.command")
    if (form.kind === "remote") {
      const url = form.url.trim()
      if (!url) errors.url = language.t("mcp.editor.error.url")
      else if (!/^https?:\/\//i.test(url)) errors.url = language.t("mcp.editor.error.urlInvalid")
    }
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const buildConfig = (): McpConfig => {
    const timeout = form.timeout.trim() ? Number(form.timeout.trim()) : undefined
    if (form.kind === "local") {
      const env: Record<string, string> = {}
      for (const row of form.environment) {
        const k = row.key.trim()
        if (!k) continue
        env[k] = row.value
      }
      return {
        type: "local",
        command: form.command
          .trim()
          .split(/\s+/)
          .filter((x) => x.length > 0),
        enabled: form.enabled,
        ...(Object.keys(env).length > 0 ? { environment: env } : {}),
        ...(typeof timeout === "number" && !Number.isNaN(timeout) ? { timeout } : {}),
      }
    }
    const headers: Record<string, string> = {}
    for (const row of form.headers) {
      const k = row.key.trim()
      if (!k) continue
      headers[k] = row.value
    }
    return {
      type: "remote",
      url: form.url.trim(),
      enabled: form.enabled,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(typeof timeout === "number" && !Number.isNaN(timeout) ? { timeout } : {}),
    }
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      const config = buildConfig()
      const name = form.name.trim()
      const next = { ...(globalSync.data.config.mcp ?? {}) }
      const previousName = isEdit && props.entry ? props.entry.name : undefined
      if (previousName && previousName !== name) delete next[previousName]
      next[name] = config
      await globalSync.updateConfig({ mcp: next })
      if (previousName) {
        await globalSDK.client.mcp.disconnect({ name: previousName }).catch(() => undefined)
      }
      if (form.enabled) {
        await globalSDK.client.mcp
          .add({ name, config })
          .catch(() => globalSDK.client.mcp.connect({ name }).catch(() => undefined))
      } else {
        await globalSDK.client.mcp.disconnect({ name }).catch(() => undefined)
      }
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit ? language.t("mcp.toast.updated") : language.t("mcp.toast.added"),
      })
      dialog.close()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault()
    if (save.isPending) return
    save.mutate()
  }

  const setRow = (group: "environment" | "headers", index: number, key: "key" | "value", value: string) => {
    setForm(group, index, key, value)
  }
  const addRow = (group: "environment" | "headers") => {
    setForm(
      group,
      produce((rows) => rows.push(newRow())),
    )
  }
  const removeRow = (group: "environment" | "headers", index: number) => {
    setForm(
      group,
      produce((rows) => {
        rows.splice(index, 1)
        if (rows.length === 0) rows.push(newRow())
      }),
    )
  }

  return (
    <Dialog
      title={isEdit ? language.t("mcp.editor.title.edit") : language.t("mcp.editor.title.add")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            label={language.t("mcp.editor.name")}
            placeholder="my-server"
            value={form.name}
            onChange={(v) =>
              batch(() => {
                setForm("name", v)
                setForm("errors", "name", undefined)
              })
            }
            error={form.errors.name}
            disabled={isEdit}
          />

          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("mcp.editor.type")}</label>
            <div class="flex gap-1.5">
              <KindButton
                active={form.kind === "local"}
                label={language.t("mcp.editor.type.local")}
                onClick={() => setForm("kind", "local")}
              />
              <KindButton
                active={form.kind === "remote"}
                label={language.t("mcp.editor.type.remote")}
                onClick={() => setForm("kind", "remote")}
              />
            </div>
          </div>

          <Show when={form.kind === "local"}>
            <TextField
              label={language.t("mcp.editor.command")}
              description={language.t("mcp.editor.command.description")}
              placeholder="npx -y my-mcp-server"
              value={form.command}
              onChange={(v) =>
                batch(() => {
                  setForm("command", v)
                  setForm("errors", "command", undefined)
                })
              }
              error={form.errors.command}
              spellcheck={false}
              class="font-mono text-xs"
            />
            <RowsEditor
              title={language.t("mcp.editor.environment")}
              description={language.t("mcp.editor.environment.description")}
              rows={form.environment}
              secret
              onChange={(i, k, v) => setRow("environment", i, k, v)}
              onAdd={() => addRow("environment")}
              onRemove={(i) => removeRow("environment", i)}
            />
          </Show>

          <Show when={form.kind === "remote"}>
            <TextField
              label={language.t("mcp.editor.url")}
              placeholder="https://example.com/mcp"
              value={form.url}
              onChange={(v) =>
                batch(() => {
                  setForm("url", v)
                  setForm("errors", "url", undefined)
                })
              }
              error={form.errors.url}
              spellcheck={false}
            />
            <RowsEditor
              title={language.t("mcp.editor.headers")}
              description={language.t("mcp.editor.headers.description")}
              rows={form.headers}
              secret
              onChange={(i, k, v) => setRow("headers", i, k, v)}
              onAdd={() => addRow("headers")}
              onRemove={(i) => removeRow("headers", i)}
            />
          </Show>

          <TextField
            label={language.t("mcp.editor.timeout")}
            description={language.t("mcp.editor.timeout.description")}
            placeholder="5000"
            value={form.timeout}
            onChange={(v) => setForm("timeout", v.replace(/[^0-9]/g, ""))}
            inputmode="numeric"
          />

          <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2.5">
            <div class="flex flex-col">
              <span class="text-14-medium text-text-strong">{language.t("mcp.editor.enabled")}</span>
              <span class="text-11-regular text-text-weak">{language.t("mcp.editor.enabled.description")}</span>
            </div>
            <Switch checked={form.enabled} onChange={(v) => setForm("enabled", v)} hideLabel>
              {language.t("common.enabled")}
            </Switch>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={save.isPending}>
            {save.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

function KindButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      classList={{
        "px-3 py-1.5 rounded-md text-12-medium transition-colors cursor-default border": true,
        "border-icon-strong-base bg-surface-base-hover text-text-strong": props.active,
        "border-border-weak-base text-text-base hover:bg-surface-base-hover": !props.active,
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

function RowsEditor(props: {
  title: string
  description?: string
  rows: FormRow[]
  secret?: boolean
  onChange: (index: number, key: "key" | "value", value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-col">
        <span class="text-12-medium text-text-weak">{props.title}</span>
        <Show when={props.description}>
          <span class="text-11-regular text-text-weaker">{props.description}</span>
        </Show>
      </div>
      <div class="flex flex-col gap-1.5">
        <For each={props.rows}>
          {(row, index) => (
            <RowInput
              row={row}
              secret={props.secret}
              onKeyChange={(v) => props.onChange(index(), "key", v)}
              onValueChange={(v) => props.onChange(index(), "value", v)}
              onRemove={() => props.onRemove(index())}
            />
          )}
        </For>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="normal"
        icon="plus-small"
        class="self-start px-0"
        onClick={props.onAdd}
      >
        {language.t("mcp.editor.row.add")}
      </Button>
    </div>
  )
}

function RowInput(props: {
  row: FormRow
  secret?: boolean
  onKeyChange: (v: string) => void
  onValueChange: (v: string) => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const [revealed, setRevealed] = createSignal(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const inputType = () => (props.secret && !revealed() ? "password" : "text")
  const flashReveal = () => {
    if (hideTimer) clearTimeout(hideTimer)
    setRevealed(true)
    hideTimer = setTimeout(() => setRevealed(false), 1500)
  }
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.secret) return
    if (e.key === "Enter") {
      e.preventDefault()
      flashReveal()
    }
  }
  return (
    <div class="flex items-start gap-1.5">
      <div class="flex-1 min-w-0">
        <TextField
          variant="ghost"
          placeholder={language.t("mcp.editor.row.key")}
          value={props.row.key}
          onChange={props.onKeyChange}
          spellcheck={false}
          class="font-mono text-xs"
        />
      </div>
      <div class="flex-1 min-w-0">
        <TextField
          variant="ghost"
          type={inputType()}
          placeholder={language.t("mcp.editor.row.value")}
          value={props.row.value}
          onChange={props.onValueChange}
          onKeyDown={handleKeyDown}
          spellcheck={false}
          class="font-mono text-xs"
        />
      </div>
      <Show when={props.secret}>
        <IconButton
          type="button"
          variant="ghost"
          size="normal"
          icon={revealed() ? "eye" : "shield"}
          aria-label={language.t(revealed() ? "mcp.editor.row.hide" : "mcp.editor.row.reveal")}
          onPointerDown={() => {
            if (hideTimer) clearTimeout(hideTimer)
            setRevealed(true)
          }}
          onPointerUp={() => setRevealed(false)}
          onPointerLeave={() => setRevealed(false)}
        />
      </Show>
      <IconButton
        type="button"
        variant="ghost"
        size="normal"
        icon="close-small"
        aria-label={language.t("common.remove")}
        onClick={props.onRemove}
      />
    </div>
  )
}
