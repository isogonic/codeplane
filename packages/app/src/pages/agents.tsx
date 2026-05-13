import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { Switch } from "@codeplane-ai/ui/switch"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { AgentConfig } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

type ModeSource = "agent" | "mode"

type ModeEntry = {
  name: string
  config: AgentConfig
  source: ModeSource
}

type FormState = {
  name: string
  description: string
  model: string
  prompt: string
  temperature: string
  topP: string
  steps: string
  hidden: boolean
  disable: boolean
  errors: { name?: string }
}

const isAgentConfig = (value: unknown): value is AgentConfig =>
  !!value && typeof value === "object" && !Array.isArray(value)

const initialForm = (entry?: ModeEntry): FormState => {
  if (!entry) {
    return {
      name: "",
      description: "",
      model: "",
      prompt: "",
      temperature: "",
      topP: "",
      steps: "",
      hidden: false,
      disable: false,
      errors: {},
    }
  }
  return {
    name: entry.name,
    description: entry.config.description ?? "",
    model: entry.config.model ?? "",
    prompt: entry.config.prompt ?? "",
    temperature: entry.config.temperature !== undefined ? String(entry.config.temperature) : "",
    topP: entry.config.top_p !== undefined ? String(entry.config.top_p) : "",
    steps: entry.config.steps !== undefined ? String(entry.config.steps) : "",
    hidden: !!entry.config.hidden,
    disable: !!entry.config.disable,
    errors: {},
  }
}

export function ModesSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const page = () => props.layout === "page"

  const modes = createMemo<ModeEntry[]>(() => {
    const legacy = globalSync.data.config.mode ?? {}
    const legacyNames = new Set(Object.keys(legacy))
    return [
      ...Object.entries(legacy)
        .filter((entry): entry is [string, AgentConfig] => isAgentConfig(entry[1]))
        .map(([name, config]) => ({ name, config, source: "mode" as const })),
      ...Object.entries(globalSync.data.config.agent ?? {})
        .filter((entry): entry is [string, AgentConfig] => isAgentConfig(entry[1]))
        .filter(([name, config]) => !legacyNames.has(name) && (config.mode ?? "primary") !== "subagent")
        .map(([name, config]) => ({ name, config, source: "agent" as const })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  })

  const enabledCount = createMemo(() => modes().filter((mode) => mode.config.disable !== true).length)

  const updateConfig = (source: ModeSource, config: Record<string, AgentConfig | undefined>) => {
    if (source === "mode") return globalSync.updateConfig({ mode: config })
    return globalSync.updateConfig({ agent: config })
  }

  const setEnabled = useMutation(() => ({
    mutationFn: async (input: { mode: ModeEntry; enabled: boolean }) => {
      const config = { ...(input.mode.source === "mode" ? globalSync.data.config.mode : globalSync.data.config.agent) }
      config[input.mode.name] = { ...config[input.mode.name], disable: !input.enabled }
      await updateConfig(input.mode.source, config)
      await globalSDK.client.global.dispose().catch(() => undefined)
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const openEditor = (entry?: ModeEntry) => {
    dialog.show(() => <ModeEditorDialog entry={entry} />)
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
            <div class="text-20-medium text-text-strong truncate">{language.t("modes.page.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("modes.page.subtitle", { enabled: enabledCount(), total: modes().length })}
            </div>
          </div>
        </Show>
        <Button variant="primary" size="large" icon="plus-small" onClick={() => openEditor()}>
          {language.t("modes.page.add")}
        </Button>
      </div>

      <Show
        when={modes().length > 0}
        fallback={
          <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
            {language.t("modes.page.empty")}
          </div>
        }
      >
        <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
          <For each={modes()}>
            {(mode) => (
              <ModeRow
                mode={mode}
                toggling={() => setEnabled.isPending && setEnabled.variables?.mode.name === mode.name}
                onToggle={(enabled) => setEnabled.mutate({ mode, enabled })}
                onEdit={() => openEditor(mode)}
              />
            )}
          </For>
        </ul>
      </Show>
    </>
  )
}

export default function ModesPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <ModesSettings />
      </div>
    </div>
  )
}

function ModeRow(props: {
  mode: ModeEntry
  toggling: () => boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
}) {
  const language = useLanguage()
  const enabled = () => props.mode.config.disable !== true
  const model = () => props.mode.config.model
  const kind = () => (props.mode.source === "mode" ? "primary" : props.mode.config.mode === "all" ? "all" : "primary")
  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="brain" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate text-14-medium text-text-strong">{props.mode.name}</span>
            <Tag>{language.t(`modes.kind.${kind()}`)}</Tag>
            <Show when={props.mode.source === "mode"}>
              <Tag>{language.t("modes.source.legacy")}</Tag>
            </Show>
            <Show when={props.mode.config.hidden}>
              <Tag>{language.t("modes.tag.hidden")}</Tag>
            </Show>
            <Show when={!enabled()}>
              <Tag>{language.t("modes.tag.disabled")}</Tag>
            </Show>
          </div>
          <Show when={props.mode.config.description}>
            <div class="mt-0.5 truncate text-12-regular text-text-weak">{props.mode.config.description}</div>
          </Show>
          <Show when={model()}>
            <div class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{model()}</div>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Switch checked={enabled()} disabled={props.toggling()} onChange={props.onToggle} hideLabel>
            {language.t("common.enabled")}
          </Switch>
          <IconButton
            icon="edit"
            variant="ghost"
            size="normal"
            aria-label={language.t("common.edit")}
            onClick={props.onEdit}
          />
        </div>
      </div>
    </li>
  )
}

function ModeEditorDialog(props: { entry?: ModeEntry }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const isEdit = !!props.entry

  const [form, setForm] = createStore<FormState>(initialForm(props.entry))

  const validate = () => {
    const errors: FormState["errors"] = {}
    const name = form.name.trim()
    if (!name) errors.name = language.t("modes.editor.error.name")
    if (
      !isEdit &&
      ((globalSync.data.config.mode && name in globalSync.data.config.mode) ||
        (globalSync.data.config.agent && name in globalSync.data.config.agent))
    ) {
      errors.name = language.t("modes.editor.error.duplicate")
    }
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const numberField = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    const numeric = Number(trimmed)
    if (!Number.isNaN(numeric)) return numeric
  }

  const buildConfig = (): AgentConfig => ({
    mode: "primary",
    hidden: form.hidden,
    disable: form.disable,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.model.trim() ? { model: form.model.trim() } : {}),
    ...(form.prompt.trim() ? { prompt: form.prompt } : {}),
    ...(numberField(form.temperature) !== undefined ? { temperature: numberField(form.temperature) } : {}),
    ...(numberField(form.topP) !== undefined ? { top_p: numberField(form.topP) } : {}),
    ...(numberField(form.steps) !== undefined ? { steps: numberField(form.steps) } : {}),
  })

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      const source = props.entry?.source ?? "agent"
      const config = { ...(source === "mode" ? globalSync.data.config.mode : globalSync.data.config.agent) }
      config[form.name.trim()] = buildConfig()
      if (source === "mode") {
        await globalSync.updateConfig({ mode: config })
      } else {
        await globalSync.updateConfig({ agent: config })
      }
      await globalSDK.client.global.dispose().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit ? language.t("modes.toast.updated") : language.t("modes.toast.added"),
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

  return (
    <Dialog
      title={isEdit ? language.t("modes.editor.title.edit") : language.t("modes.editor.title.add")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            label={language.t("modes.editor.name")}
            placeholder="review"
            value={form.name}
            onChange={(v) =>
              batch(() => {
                setForm("name", v)
                setForm("errors", "name", undefined)
              })
            }
            error={form.errors.name}
            disabled={isEdit}
            spellcheck={false}
            class="font-mono text-xs"
          />

          <TextField
            label={language.t("modes.editor.description")}
            placeholder={language.t("modes.editor.description.placeholder")}
            value={form.description}
            onChange={(v) => setForm("description", v)}
          />

          <TextField
            label={language.t("modes.editor.model")}
            description={language.t("modes.editor.model.description")}
            placeholder="anthropic/claude-sonnet-4-5"
            value={form.model}
            onChange={(v) => setForm("model", v)}
            spellcheck={false}
            class="font-mono text-xs"
          />

          <TextField
            multiline
            label={language.t("modes.editor.prompt")}
            description={language.t("modes.editor.prompt.description")}
            placeholder={language.t("modes.editor.prompt.placeholder")}
            value={form.prompt}
            onChange={(v) => setForm("prompt", v)}
            spellcheck={false}
            class="max-h-40 w-full overflow-y-auto font-mono text-xs"
          />

          <div class="grid grid-cols-3 gap-3">
            <TextField
              label={language.t("modes.editor.temperature")}
              placeholder="0.7"
              value={form.temperature}
              onChange={(v) => setForm("temperature", v.replace(/[^0-9.]/g, ""))}
              inputmode="decimal"
            />
            <TextField
              label={language.t("modes.editor.topP")}
              placeholder="1"
              value={form.topP}
              onChange={(v) => setForm("topP", v.replace(/[^0-9.]/g, ""))}
              inputmode="decimal"
            />
            <TextField
              label={language.t("modes.editor.steps")}
              placeholder="50"
              value={form.steps}
              onChange={(v) => setForm("steps", v.replace(/[^0-9]/g, ""))}
              inputmode="numeric"
            />
          </div>

          <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2.5">
            <div class="flex flex-col">
              <span class="text-14-medium text-text-strong">{language.t("modes.editor.hidden")}</span>
              <span class="text-11-regular text-text-weak">{language.t("modes.editor.hidden.description")}</span>
            </div>
            <Switch checked={form.hidden} onChange={(v) => setForm("hidden", v)} hideLabel>
              {language.t("modes.editor.hidden")}
            </Switch>
          </div>

          <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2.5">
            <div class="flex flex-col">
              <span class="text-14-medium text-text-strong">{language.t("modes.editor.disable")}</span>
              <span class="text-11-regular text-text-weak">{language.t("modes.editor.disable.description")}</span>
            </div>
            <Switch checked={form.disable} onChange={(v) => setForm("disable", v)} hideLabel>
              {language.t("modes.editor.disable")}
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
