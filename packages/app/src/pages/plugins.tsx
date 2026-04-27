import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, createSignal, For, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

type PluginSpec = string | [string, Record<string, unknown>]

type PluginEntry = {
  index: number
  spec: PluginSpec
  specifier: string
  options: Record<string, unknown>
}

type OptionRow = { key: string; value: string; reveal?: boolean }

type FormState = {
  specifier: string
  options: OptionRow[]
  errors: { specifier?: string }
}

const isPath = (specifier: string) =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier.startsWith("/") ||
  specifier.startsWith("file://")

const isUrl = (specifier: string) => /^https?:\/\//.test(specifier)

const isLikelySecretKey = (key: string) => /(token|secret|password|apikey|api[_-]?key|auth)/i.test(key)

const newRow = (): OptionRow => ({ key: "", value: "" })

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ""
  }
}

const parseValue = (raw: string): unknown => {
  const trimmed = raw.trim()
  if (trimmed === "") return ""
  if (trimmed === "true") return true
  if (trimmed === "false") return false
  if (trimmed === "null") return null
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed)
    if (!Number.isNaN(n)) return n
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through
    }
  }
  return raw
}

export function PluginsSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const page = () => props.layout === "page"

  const plugins = createMemo<PluginEntry[]>(() => {
    const list = globalSync.data.config.plugin ?? []
    return list.map((spec, index) => {
      if (Array.isArray(spec)) {
        return { index, spec, specifier: spec[0], options: spec[1] }
      }
      return { index, spec, specifier: spec, options: {} as Record<string, unknown> }
    })
  })

  const remove = useMutation(() => ({
    mutationFn: async (index: number) => {
      const next = (globalSync.data.config.plugin ?? []).slice()
      next.splice(index, 1)
      await globalSync.updateConfig({ plugin: next })
      await globalSDK.client.global.dispose().catch(() => undefined)
    },
    onSuccess: () => {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("plugins.toast.removed"),
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

  const openEditor = (entry?: PluginEntry) => {
    dialog.show(() => <PluginEditorDialog entry={entry} />)
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
            <div class="text-20-medium text-text-strong truncate">{language.t("plugins.page.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("plugins.page.subtitle", { count: plugins().length })}
            </div>
          </div>
        </Show>
        <Button variant="primary" size="large" icon="plus-small" onClick={() => openEditor()}>
          {language.t("plugins.page.add")}
        </Button>
      </div>

      <Show
        when={plugins().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {language.t("plugins.page.empty")}
          </div>
        }
      >
        <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={plugins()}>
            {(plugin) => (
              <PluginRow
                plugin={plugin}
                onEdit={() => openEditor(plugin)}
                onRemove={() => {
                  if (!window.confirm(language.t("plugins.page.confirm.remove", { name: plugin.specifier }))) return
                  remove.mutate(plugin.index)
                }}
              />
            )}
          </For>
        </ul>
      </Show>
    </>
  )
}

export default function PluginsPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <PluginsSettings />
      </div>
    </div>
  )
}

function PluginRow(props: { plugin: PluginEntry; onEdit: () => void; onRemove: () => void }) {
  const language = useLanguage()
  const kindLabel = () => {
    if (isPath(props.plugin.specifier)) return language.t("plugins.kind.local")
    if (isUrl(props.plugin.specifier)) return language.t("plugins.kind.remote")
    return language.t("plugins.kind.package")
  }
  const optionCount = () => Object.keys(props.plugin.options).length
  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="brain" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate font-mono text-13-medium text-text-strong">{props.plugin.specifier}</span>
            <Tag>{kindLabel()}</Tag>
            <Show when={optionCount() > 0}>
              <span class="text-11-regular text-text-weak">
                {language.t("plugins.row.optionCount", { count: optionCount() })}
              </span>
            </Show>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
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

function PluginEditorDialog(props: { entry?: PluginEntry }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const isEdit = !!props.entry

  const initial = (): FormState => {
    const entry = props.entry
    if (!entry) {
      return {
        specifier: "",
        options: [newRow()],
        errors: {},
      }
    }
    const optionRows = Object.entries(entry.options).map(([key, value]) => ({
      key,
      value: stringifyValue(value),
    }))
    return {
      specifier: entry.specifier,
      options: optionRows.length > 0 ? optionRows : [newRow()],
      errors: {},
    }
  }
  const [form, setForm] = createStore<FormState>(initial())

  const validate = () => {
    const errors: FormState["errors"] = {}
    const specifier = form.specifier.trim()
    if (!specifier) errors.specifier = language.t("plugins.editor.error.specifier")
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const buildSpec = (): PluginSpec => {
    const specifier = form.specifier.trim()
    const options: Record<string, unknown> = {}
    for (const row of form.options) {
      const key = row.key.trim()
      if (!key) continue
      options[key] = parseValue(row.value)
    }
    if (Object.keys(options).length === 0) return specifier
    return [specifier, options]
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      const spec = buildSpec()
      const list = (globalSync.data.config.plugin ?? []).slice()
      if (isEdit && props.entry) {
        list[props.entry.index] = spec
      } else {
        list.push(spec)
      }
      await globalSync.updateConfig({ plugin: list })
      await globalSDK.client.global.dispose().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit ? language.t("plugins.toast.updated") : language.t("plugins.toast.added"),
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

  const setRow = (index: number, key: "key" | "value", value: string) => {
    setForm("options", index, key, value)
  }
  const addRow = () => {
    setForm(
      "options",
      produce((rows) => rows.push(newRow())),
    )
  }
  const removeRow = (index: number) => {
    setForm(
      "options",
      produce((rows) => {
        rows.splice(index, 1)
        if (rows.length === 0) rows.push(newRow())
      }),
    )
  }

  return (
    <Dialog
      title={isEdit ? language.t("plugins.editor.title.edit") : language.t("plugins.editor.title.add")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            label={language.t("plugins.editor.specifier")}
            description={language.t("plugins.editor.specifier.description")}
            placeholder="@my-org/my-plugin"
            value={form.specifier}
            onChange={(v) =>
              batch(() => {
                setForm("specifier", v)
                setForm("errors", "specifier", undefined)
              })
            }
            error={form.errors.specifier}
            spellcheck={false}
            class="font-mono text-xs"
          />

          <div class="flex flex-col gap-2">
            <div class="flex flex-col">
              <span class="text-12-medium text-text-weak">{language.t("plugins.editor.options")}</span>
              <span class="text-11-regular text-text-weaker">{language.t("plugins.editor.options.description")}</span>
            </div>
            <div class="flex flex-col gap-1.5">
              <For each={form.options}>
                {(row, index) => (
                  <PluginOptionRow
                    row={row}
                    onKeyChange={(v) => setRow(index(), "key", v)}
                    onValueChange={(v) => setRow(index(), "value", v)}
                    onRemove={() => removeRow(index())}
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
              onClick={addRow}
            >
              {language.t("plugins.editor.option.add")}
            </Button>
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

function PluginOptionRow(props: {
  row: OptionRow
  onKeyChange: (v: string) => void
  onValueChange: (v: string) => void
  onRemove: () => void
}) {
  const language = useLanguage()
  const [revealed, setRevealed] = createSignal(false)
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  const isSecret = createMemo(() => isLikelySecretKey(props.row.key))
  const inputType = () => (isSecret() && !revealed() ? "password" : "text")
  const flashReveal = () => {
    if (hideTimer) clearTimeout(hideTimer)
    setRevealed(true)
    hideTimer = setTimeout(() => setRevealed(false), 1500)
  }
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isSecret()) return
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
          placeholder={language.t("plugins.editor.option.key")}
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
          placeholder={language.t("plugins.editor.option.value")}
          value={props.row.value}
          onChange={props.onValueChange}
          onKeyDown={handleKeyDown}
          spellcheck={false}
          class="font-mono text-xs"
        />
      </div>
      <Show when={isSecret()}>
        <IconButton
          type="button"
          variant="ghost"
          size="normal"
          icon={revealed() ? "eye" : "shield"}
          aria-label={language.t(revealed() ? "plugins.editor.option.hide" : "plugins.editor.option.reveal")}
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
