import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { Icon } from "@codeplane-ai/ui/icon"
import { IconButton } from "@codeplane-ai/ui/icon-button"
import { ProviderIcon } from "@codeplane-ai/ui/provider-icon"
import { Switch } from "@codeplane-ai/ui/switch"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { Model, Provider, ProviderConfig } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { batch, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders, useProviders } from "@/hooks/use-providers"

type ModelConfig = NonNullable<ProviderConfig["models"]>[string]

type ModelEntry = {
  provider: Provider
  model: Model
  config?: ModelConfig
  custom: boolean
}

type ModelGroup = {
  provider: Provider
  entries: ModelEntry[]
}

const INITIAL_MODELS_PER_PROVIDER = 40

type FormState = {
  providerID: string
  modelID: string
  apiModelID: string
  name: string
  family: string
  releaseDate: string
  context: string
  input: string
  output: string
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolCall: boolean
  errors: {
    providerID?: string
    modelID?: string
    name?: string
  }
}

const numberString = (value: number | undefined) => (value === undefined || value === 0 ? "" : String(value))

const parseNumber = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return
  const numeric = Number(trimmed)
  if (!Number.isNaN(numeric)) return numeric
}

const cleanNumberInput = (value: string) => value.replace(/[^0-9]/g, "")

const modelConfig = (config: ProviderConfig | undefined, modelID: string) => config?.models?.[modelID]

const providerSort = (a: Provider, b: Provider) => {
  const aIndex = popularProviders.indexOf(a.id)
  const bIndex = popularProviders.indexOf(b.id)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0
  if (aPopular && !bPopular) return -1
  if (!aPopular && bPopular) return 1
  if (aPopular && bPopular) return aIndex - bIndex
  return a.name.localeCompare(b.name)
}

const initialForm = (entry?: ModelEntry): FormState => {
  if (!entry) {
    return {
      providerID: "",
      modelID: "",
      apiModelID: "",
      name: "",
      family: "",
      releaseDate: "",
      context: "",
      input: "",
      output: "",
      temperature: true,
      reasoning: false,
      attachment: false,
      toolCall: true,
      errors: {},
    }
  }

  return {
    providerID: entry.provider.id,
    modelID: entry.model.id,
    apiModelID: entry.config?.id ?? entry.model.api.id,
    name: entry.config?.name ?? entry.model.name,
    family: entry.config?.family ?? entry.model.family ?? "",
    releaseDate: entry.config?.release_date ?? entry.model.release_date ?? "",
    context: numberString(entry.config?.limit?.context ?? entry.model.limit.context),
    input: numberString(entry.config?.limit?.input ?? entry.model.limit.input),
    output: numberString(entry.config?.limit?.output ?? entry.model.limit.output),
    temperature: entry.config?.temperature ?? entry.model.capabilities.temperature,
    reasoning: entry.config?.reasoning ?? entry.model.capabilities.reasoning,
    attachment: entry.config?.attachment ?? entry.model.capabilities.attachment,
    toolCall: entry.config?.tool_call ?? entry.model.capabilities.toolcall,
    errors: {},
  }
}

export function ModelsSettings(props: { layout?: "dialog" | "page" } = {}) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const models = useModels()
  const dialog = useDialog()
  const page = () => props.layout === "page"
  const dialogLayout = () => props.layout === "dialog"

  const [state, setState] = createStore({
    expanded: {} as Record<string, boolean>,
  })

  const entries = createMemo<ModelEntry[]>(() =>
    models
      .list()
      .map((model) => {
        const config = modelConfig(globalSync.data.config.provider?.[model.provider.id], model.id)
        return {
          provider: model.provider,
          model,
          config,
          custom: model.provider.source === "config" || model.provider.source === "custom" || !!config,
        }
      })
      .sort((a, b) => {
        const provider = providerSort(a.provider, b.provider)
        if (provider !== 0) return provider
        return a.model.name.localeCompare(b.model.name)
      }),
  )

  const groups = createMemo<ModelGroup[]>(() =>
    entries().reduce<ModelGroup[]>((acc, entry) => {
      const group = acc.find((item) => item.provider.id === entry.provider.id)
      if (group) {
        group.entries.push(entry)
        return acc
      }
      acc.push({ provider: entry.provider, entries: [entry] })
      return acc
    }, []),
  )

  const shownCount = createMemo(
    () =>
      entries().filter((entry) => models.visible({ providerID: entry.provider.id, modelID: entry.model.id })).length,
  )

  const openEditor = (entry?: ModelEntry) => {
    dialog.show(() => <ModelEditorDialog entry={entry} />)
  }

  const modelShown = (entry: ModelEntry) => models.visible({ providerID: entry.provider.id, modelID: entry.model.id })

  const groupEntries = (group: ModelGroup) => {
    if (state.expanded[group.provider.id]) return group.entries
    const shown: ModelEntry[] = []
    for (const entry of group.entries) {
      if (!modelShown(entry)) continue
      shown.push(entry)
      if (shown.length >= INITIAL_MODELS_PER_PROVIDER) return shown
    }
    return shown
  }

  return (
    <div
      classList={{
        "flex flex-col gap-6": true,
        "h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10": dialogLayout(),
      }}
    >
      <div
        classList={{
          "shrink-0 flex items-center gap-4": true,
          "justify-between border-b border-border-weak-base pb-4": !page(),
          "justify-end": page(),
        }}
      >
        <Show when={!page()}>
          <div class="min-w-0">
            <div class="text-20-medium text-text-strong truncate">{language.t("models.page.title")}</div>
            <div class="text-12-regular text-text-weak">
              {language.t("models.page.subtitle", { shown: shownCount(), total: entries().length })}
            </div>
          </div>
        </Show>
        <Button variant="primary" size="large" icon="plus-small" onClick={() => openEditor()}>
          {language.t("models.page.add")}
        </Button>
      </div>

      <div class="flex flex-col gap-8">
        <Show
          when={groups().length > 0}
          fallback={
            <div class="rounded-lg border border-border-weaker-base bg-background-base px-4 py-12 text-center text-12-regular text-text-weak shadow-[var(--shadow-xs)]">
              {language.t("models.page.empty")}
            </div>
          }
        >
          <For each={groups()}>
            {(group) => {
              const rowEntries = createMemo(() => groupEntries(group))
              const remainingCount = createMemo(() => group.entries.length - rowEntries().length)

              return (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 pb-2">
                    <ProviderIcon id={group.provider.id} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong">{group.provider.name}</span>
                  </div>
                  <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-background-base shadow-[var(--shadow-xs)]">
                    <For each={rowEntries()}>
                      {(entry) => <ModelRow entry={entry} onEdit={() => openEditor(entry)} />}
                    </For>
                    <Show when={remainingCount() > 0}>
                      <li class="border-b border-border-weak-base last:border-b-0">
                        <Button
                          variant="ghost"
                          size="normal"
                          class="w-full justify-start px-4 py-3 text-13-medium text-text-interactive-base hover:bg-surface-base-hover active:bg-surface-base-active"
                          onClick={() => setState("expanded", group.provider.id, true)}
                        >
                          {language.t("common.loadMore")}
                          {language.t("common.moreCountSuffix", { count: remainingCount() })}
                        </Button>
                      </li>
                    </Show>
                  </ul>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </div>
  )
}

export default function ModelsPage() {
  return (
    <div class="size-full overflow-y-auto">
      <div class="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-6 py-8">
        <ModelsSettings />
      </div>
    </div>
  )
}

function ModelRow(props: { entry: ModelEntry; onEdit: () => void }) {
  const language = useLanguage()
  const models = useModels()
  const key = () => ({ providerID: props.entry.provider.id, modelID: props.entry.model.id })
  const shown = () => models.visible(key())

  return (
    <li class="border-b border-border-weak-base last:border-b-0">
      <div class="group flex w-full min-w-0 items-center gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <Icon name="models" size="small" class="icon-strong-base shrink-0" />
            <span class="truncate text-14-medium text-text-strong">{props.entry.model.name}</span>
          </div>
          <div class="mt-0.5 truncate font-mono text-11-regular text-text-weak">{props.entry.model.id}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Switch checked={shown()} onChange={(value) => models.setVisibility(key(), value)} hideLabel>
            {language.t("models.row.shown")}
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

function ModelEditorDialog(props: { entry?: ModelEntry }) {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const providers = useProviders()
  const dialog = useDialog()
  const isEdit = !!props.entry

  const [form, setForm] = createStore<FormState>(initialForm(props.entry))

  const validate = () => {
    const errors: FormState["errors"] = {}
    const providerID = form.providerID.trim()
    const modelID = form.modelID.trim()
    if (!providerID) errors.providerID = language.t("models.editor.error.provider")
    if (!modelID) errors.modelID = language.t("models.editor.error.model")
    if (!form.name.trim()) errors.name = language.t("models.editor.error.name")
    if (!isEdit && providers.all().some((provider) => provider.id === providerID && !!provider.models[modelID])) {
      errors.modelID = language.t("models.editor.error.duplicate")
    }
    setForm("errors", errors)
    return Object.keys(errors).length === 0
  }

  const buildConfig = (): ModelConfig => {
    const modelID = form.modelID.trim()
    const apiModelID = form.apiModelID.trim()
    const context = parseNumber(form.context)
    const input = parseNumber(form.input)
    const output = parseNumber(form.output)
    const limit =
      context !== undefined && output !== undefined
        ? {
            context,
            output,
            ...(input !== undefined ? { input } : {}),
          }
        : undefined
    return {
      ...(apiModelID && apiModelID !== modelID ? { id: apiModelID } : {}),
      name: form.name.trim(),
      temperature: form.temperature,
      reasoning: form.reasoning,
      attachment: form.attachment,
      tool_call: form.toolCall,
      ...(form.family.trim() ? { family: form.family.trim() } : {}),
      ...(form.releaseDate.trim() ? { release_date: form.releaseDate.trim() } : {}),
      ...(limit ? { limit } : {}),
    }
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      if (!validate()) return
      const providerID = form.providerID.trim()
      const modelID = form.modelID.trim()
      const current = globalSync.data.config.provider?.[providerID] ?? {}
      await globalSync.updateConfig({
        provider: {
          [providerID]: {
            ...current,
            models: {
              ...(current.models ?? {}),
              [modelID]: buildConfig(),
            },
          },
        },
      })
      await globalSDK.client.global.dispose().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: isEdit ? language.t("models.toast.updated") : language.t("models.toast.added"),
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
      title={isEdit ? language.t("models.editor.title.edit") : language.t("models.editor.title.add")}
      class="w-full max-w-[560px] mx-auto"
      fit
    >
      <form onSubmit={handleSubmit} class="flex flex-col gap-5 px-6 pt-0 pb-5">
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-3">
            <TextField
              autofocus
              label={language.t("models.editor.provider")}
              placeholder="anthropic"
              value={form.providerID}
              onChange={(value) =>
                batch(() => {
                  setForm("providerID", value)
                  setForm("errors", "providerID", undefined)
                })
              }
              error={form.errors.providerID}
              disabled={isEdit}
              spellcheck={false}
              class="font-mono text-xs"
            />
            <TextField
              label={language.t("models.editor.model")}
              placeholder="claude-sonnet-4-5"
              value={form.modelID}
              onChange={(value) =>
                batch(() => {
                  setForm("modelID", value)
                  setForm("errors", "modelID", undefined)
                })
              }
              error={form.errors.modelID}
              disabled={isEdit}
              spellcheck={false}
              class="font-mono text-xs"
            />
          </div>

          <TextField
            label={language.t("models.editor.name")}
            placeholder="Claude Sonnet 4.5"
            value={form.name}
            onChange={(value) =>
              batch(() => {
                setForm("name", value)
                setForm("errors", "name", undefined)
              })
            }
            error={form.errors.name}
          />

          <TextField
            label={language.t("models.editor.apiModel")}
            description={language.t("models.editor.apiModel.description")}
            placeholder={form.modelID || "provider-model-id"}
            value={form.apiModelID}
            onChange={(value) => setForm("apiModelID", value)}
            spellcheck={false}
            class="font-mono text-xs"
          />

          <div class="grid grid-cols-2 gap-3">
            <TextField
              label={language.t("models.editor.family")}
              placeholder="claude"
              value={form.family}
              onChange={(value) => setForm("family", value)}
            />
            <TextField
              label={language.t("models.editor.releaseDate")}
              placeholder="2026-01-01"
              value={form.releaseDate}
              onChange={(value) => setForm("releaseDate", value)}
              spellcheck={false}
            />
          </div>

          <div class="grid grid-cols-3 gap-3">
            <TextField
              label={language.t("models.editor.context")}
              placeholder="200000"
              value={form.context}
              onChange={(value) => setForm("context", cleanNumberInput(value))}
              inputmode="numeric"
            />
            <TextField
              label={language.t("models.editor.input")}
              placeholder="200000"
              value={form.input}
              onChange={(value) => setForm("input", cleanNumberInput(value))}
              inputmode="numeric"
            />
            <TextField
              label={language.t("models.editor.output")}
              placeholder="8192"
              value={form.output}
              onChange={(value) => setForm("output", cleanNumberInput(value))}
              inputmode="numeric"
            />
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">{language.t("models.editor.capabilities")}</span>
            <div class="grid grid-cols-2 gap-2">
              <CapabilitySwitch
                label={language.t("models.editor.temperature")}
                checked={form.temperature}
                onChange={(value) => setForm("temperature", value)}
              />
              <CapabilitySwitch
                label={language.t("models.editor.reasoning")}
                checked={form.reasoning}
                onChange={(value) => setForm("reasoning", value)}
              />
              <CapabilitySwitch
                label={language.t("models.editor.attachment")}
                checked={form.attachment}
                onChange={(value) => setForm("attachment", value)}
              />
              <CapabilitySwitch
                label={language.t("models.editor.toolCall")}
                checked={form.toolCall}
                onChange={(value) => setForm("toolCall", value)}
              />
            </div>
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

function CapabilitySwitch(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div class="flex items-center justify-between gap-3 rounded-md border border-border-weak-base px-3 py-2.5">
      <span class="text-13-medium text-text-strong">{props.label}</span>
      <Switch checked={props.checked} onChange={props.onChange} hideLabel>
        {props.label}
      </Switch>
    </div>
  )
}
