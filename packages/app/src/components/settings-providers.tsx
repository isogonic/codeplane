import { Button } from "@codeplane-ai/ui/button"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { Dialog } from "@codeplane-ai/ui/dialog"
import { ProviderIcon } from "@codeplane-ai/ui/provider-icon"
import { Switch } from "@codeplane-ai/ui/switch"
import { Tag } from "@codeplane-ai/ui/tag"
import { TextField } from "@codeplane-ai/ui/text-field"
import { showToast } from "@codeplane-ai/ui/toast"
import type { Provider } from "@codeplane-ai/sdk/v2/client"
import { useMutation } from "@tanstack/solid-query"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { createMemo, type Component, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { DialogSelectProvider } from "./dialog-select-provider"
import { DialogCustomProvider } from "./dialog-custom-provider"
import { SettingsList } from "./settings-list"
import {
  buildProviderModelConfig,
  filterProviderModelEntries,
  providerModelCatalog,
  providerModelEntries,
} from "./settings-provider-models"

type ProviderSource = "env" | "api" | "config" | "custom"
type ProviderItem = ReturnType<ReturnType<typeof useProviders>["connected"]>[number]

const PROVIDER_NOTES = [
  { match: (id: string) => id === "codeplane", key: "dialog.provider.codeplane.note" },
  { match: (id: string) => id === "anthropic", key: "dialog.provider.anthropic.note" },
  { match: (id: string) => id.startsWith("github-copilot"), key: "dialog.provider.copilot.note" },
  { match: (id: string) => id === "openai", key: "dialog.provider.openai.note" },
  { match: (id: string) => id === "google", key: "dialog.provider.google.note" },
  { match: (id: string) => id === "openrouter", key: "dialog.provider.openrouter.note" },
  { match: (id: string) => id === "vercel", key: "dialog.provider.vercel.note" },
] as const

export const SettingsProviders: Component<{ layout?: "dialog" | "page" }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const providers = useProviders()

  const connected = createMemo(() => {
    return providers
      .connected()
      .filter((p) => p.id !== "codeplane" || Object.values(p.models).find((m) => m.cost?.input))
  })

  const popular = createMemo(() => {
    const connectedIDs = new Set(connected().map((p) => p.id))
    const items = providers
      .popular()
      .filter((p) => !connectedIDs.has(p.id))
      .slice()
    items.sort((a, b) => popularProviders.indexOf(a.id) - popularProviders.indexOf(b.id))
    return items
  })

  const source = (item: ProviderItem): ProviderSource | undefined => {
    if (!("source" in item)) return
    const value = item.source
    if (value === "env" || value === "api" || value === "config" || value === "custom") return value
    return
  }

  const type = (item: ProviderItem) => {
    const current = source(item)
    if (current === "env") return language.t("settings.providers.tag.environment")
    if (current === "api") return language.t("provider.connect.method.apiKey")
    if (current === "config") {
      if (isConfigCustom(item.id)) return language.t("settings.providers.tag.custom")
      return language.t("settings.providers.tag.config")
    }
    if (current === "custom") return language.t("settings.providers.tag.custom")
    return language.t("settings.providers.tag.other")
  }

  const canDisconnect = (item: ProviderItem) => source(item) !== "env"

  const note = (id: string) => PROVIDER_NOTES.find((item) => item.match(id))?.key

  const isConfigCustom = (providerID: string) => {
    const provider = globalSync.data.config.provider?.[providerID]
    if (!provider) return false
    if (provider.npm !== "@ai-sdk/openai-compatible") return false
    if (!provider.models || Object.keys(provider.models).length === 0) return false
    return true
  }
  const page = () => props.layout === "page"

  const disableProvider = async (providerID: string, name: string) => {
    const before = globalSync.data.config.disabled_providers ?? []
    const next = before.includes(providerID) ? before : [...before, providerID]
    globalSync.set("config", "disabled_providers", next)

    await globalSync
      .updateConfig({ disabled_providers: next })
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        globalSync.set("config", "disabled_providers", before)
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  const disconnect = async (providerID: string, name: string) => {
    if (isConfigCustom(providerID)) {
      await globalSDK.client.auth.remove({ providerID }).catch(() => undefined)
      await disableProvider(providerID, name)
      return
    }
    await globalSDK.client.auth
      .remove({ providerID })
      .then(async () => {
        await globalSDK.client.global.dispose()
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("provider.disconnect.toast.disconnected.title", { provider: name }),
          description: language.t("provider.disconnect.toast.disconnected.description", { provider: name }),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
  }

  return (
    <div
      classList={{
        "flex flex-col": true,
        "w-full": page(),
        "h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10": !page(),
      }}
    >
      <Show when={!page()}>
        <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
          <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.providers.title")}</h2>
          </div>
        </div>
      </Show>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1" data-component="connected-providers-section">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.connected")}</h3>
          <SettingsList>
            <Show
              when={connected().length > 0}
              fallback={
                <div class="py-4 text-14-regular text-text-weak">
                  {language.t("settings.providers.connected.empty")}
                </div>
              }
            >
              <For each={connected()}>
                {(item) => (
                  <div class="group flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                    <div class="flex items-center gap-3 min-w-0">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong truncate">{item.name}</span>
                      <Tag>{type(item)}</Tag>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <Button
                        size="large"
                        variant="ghost"
                        icon="edit"
                        onClick={() => dialog.show(() => <ProviderModelsDialog provider={item} />)}
                      >
                        {language.t("settings.providers.models.edit")}
                      </Button>
                      <Show
                        when={canDisconnect(item)}
                        fallback={
                          <span class="text-14-regular text-text-base opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-3 cursor-default">
                            {language.t("settings.providers.connected.environmentDescription")}
                          </span>
                        }
                      >
                        <Button size="large" variant="ghost" onClick={() => void disconnect(item.id, item.name)}>
                          {language.t("common.disconnect")}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
        </div>

        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.providers.section.popular")}</h3>
          <SettingsList>
            <For each={popular()}>
              {(item) => (
                <div class="flex flex-wrap items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base last:border-none">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-x-3">
                      <ProviderIcon id={item.id} class="size-5 shrink-0 icon-strong-base" />
                      <span class="text-14-medium text-text-strong">{item.name}</span>
                      <Show when={item.id === "codeplane"}>
                        <Tag>{language.t("dialog.provider.tag.recommended")}</Tag>
                      </Show>
                    </div>
                    <Show when={note(item.id)} keyed>
                      {(key) => <span class="text-12-regular text-text-weak pl-8">{language.t(key)}</span>}
                    </Show>
                  </div>
                  <Button
                    size="large"
                    variant="secondary"
                    icon="plus-small"
                    onClick={() => {
                      dialog.show(() => <DialogConnectProvider provider={item.id} />)
                    }}
                  >
                    {language.t("common.connect")}
                  </Button>
                </div>
              )}
            </For>

            <div
              class="flex items-center justify-between gap-4 min-h-16 border-b border-border-weak-base last:border-none flex-wrap py-3"
              data-component="custom-provider-section"
            >
              <div class="flex flex-col min-w-0">
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <ProviderIcon id="synthetic" class="size-5 shrink-0 icon-strong-base" />
                  <span class="text-14-medium text-text-strong">{language.t("provider.custom.title")}</span>
                  <Tag>{language.t("settings.providers.tag.custom")}</Tag>
                </div>
                <span class="text-12-regular text-text-weak pl-8">
                  {language.t("settings.providers.custom.description")}
                </span>
              </div>
              <Button
                size="large"
                variant="secondary"
                icon="plus-small"
                onClick={() => {
                  dialog.show(() => <DialogCustomProvider back="close" />)
                }}
              >
                {language.t("common.connect")}
              </Button>
            </div>
          </SettingsList>

          <Button
            variant="ghost"
            class="px-0 py-0 mt-5 text-14-medium text-text-interactive-base text-left justify-start hover:bg-transparent active:bg-transparent"
            onClick={() => {
              dialog.show(() => <DialogSelectProvider />)
            }}
          >
            {language.t("dialog.provider.viewAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProviderModelsDialog(props: { provider: Provider }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const catalog = createMemo(() => globalSync.data.provider.catalog.find((item) => item.id === props.provider.id))
  const source = createMemo(() =>
    providerModelCatalog({ provider: props.provider, catalog: catalog(), catalogs: globalSync.data.provider.catalog }),
  )
  const config = createMemo(() => globalSync.data.config.provider?.[props.provider.id])
  const baseEntries = createMemo(() =>
    providerModelEntries({
      provider: props.provider,
      catalog: catalog(),
      catalogs: globalSync.data.provider.catalog,
      config: config(),
    }),
  )
  const [state, setState] = createStore({
    selected: Object.fromEntries(baseEntries().map((entry) => [entry.id, entry.selected])) as Record<string, boolean>,
    added: {} as Record<string, Provider["models"][string]>,
    addModelID: "",
    addModelName: "",
    search: "",
    addError: "",
    error: "",
  })
  const addedEntries = createMemo(() =>
    Object.values(state.added).map((model) => ({
      id: model.id,
      model,
      selected: !!state.selected[model.id],
    })),
  )
  const entries = createMemo(() => {
    const ids = new Set(baseEntries().map((entry) => entry.id))
    return [
      ...baseEntries(),
      ...addedEntries().filter((entry) => {
        if (ids.has(entry.id)) return false
        ids.add(entry.id)
        return true
      }),
    ].sort((a, b) => a.model.name.localeCompare(b.model.name) || a.id.localeCompare(b.id))
  })
  const filteredEntries = createMemo(() => filterProviderModelEntries(entries(), state.search))

  const selectedIDs = createMemo(() =>
    entries()
      .filter((entry) => state.selected[entry.id])
      .map((entry) => entry.id),
  )

  const setEvery = (value: boolean) => {
    setState("selected", Object.fromEntries(entries().map((entry) => [entry.id, value])))
    setState("error", "")
  }

  const toggle = (id: string, value: boolean) => {
    setState("selected", id, value)
    setState("error", "")
  }

  const catalogModel = (id: string) => {
    for (const provider of globalSync.data.provider.catalog) {
      const model = provider.models[id]
      if (model) return model
    }
  }

  const modelFromInput = (id: string, name: string): Provider["models"][string] =>
    catalogModel(id) ?? {
      id,
      providerID: props.provider.id,
      api: {
        id,
        url: Object.values(props.provider.models)[0]?.api.url ?? "",
        npm: Object.values(props.provider.models)[0]?.api.npm ?? "@ai-sdk/openai-compatible",
      },
      name,
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 0,
        output: 0,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "",
    }

  const addModel = (event: SubmitEvent) => {
    event.preventDefault()
    const id = state.addModelID.trim()
    if (!id) {
      setState("addError", language.t("settings.providers.models.add.error.id"))
      return
    }
    const existing = entries().find((entry) => entry.id === id)
    if (existing) {
      setState("selected", id, true)
      setState("addModelID", "")
      setState("addModelName", "")
      setState("addError", "")
      return
    }
    const model = modelFromInput(id, state.addModelName.trim() || id)
    setState("added", id, model)
    setState("selected", id, true)
    setState("addModelID", "")
    setState("addModelName", "")
    setState("addError", "")
    setState("error", "")
  }

  const save = useMutation(() => ({
    mutationFn: async () => {
      const selected = selectedIDs()
      if (selected.length === 0) {
        setState("error", language.t("settings.providers.models.error.required"))
        return
      }
      await globalSync.updateConfig({
        provider: {
          [props.provider.id]: buildProviderModelConfig(config(), selected, entries(), {
            includeModels: !source().providerCatalog,
            includeModelIDs: Object.keys(state.added),
          }),
        },
      })
      await globalSDK.client.global.dispose().catch(() => undefined)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.providers.models.toast.updated", { provider: props.provider.name }),
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

  return (
    <Dialog title={language.t("settings.providers.models.title", { provider: props.provider.name })} transition>
      <div class="flex flex-col gap-5 px-2.5 pb-3 overflow-y-auto max-h-[70vh]">
        <div class="px-2.5 flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 min-w-0">
            <ProviderIcon id={props.provider.id} class="size-5 shrink-0 icon-strong-base" />
            <div class="min-w-0">
              <div class="text-16-medium text-text-strong truncate">{props.provider.name}</div>
              <div class="text-12-regular text-text-weak">
                {language.t("settings.providers.models.count", {
                  selected: selectedIDs().length,
                  total: entries().length,
                })}
              </div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button type="button" size="small" variant="ghost" onClick={() => setEvery(true)}>
              {language.t("settings.providers.models.selectAll")}
            </Button>
            <Button type="button" size="small" variant="ghost" onClick={() => setEvery(false)}>
              {language.t("settings.providers.models.clear")}
            </Button>
          </div>
        </div>

        <div class="mx-2.5">
          <TextField
            variant="normal"
            type="search"
            value={state.search}
            onChange={(value) => setState("search", value)}
            placeholder={language.t("common.search.placeholder")}
            label={language.t("common.search.placeholder")}
            hideLabel
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
        </div>

        <form class="mx-2.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2" onSubmit={addModel}>
          <TextField
            variant="normal"
            type="text"
            value={state.addModelID}
            onChange={(value) => {
              setState("addModelID", value)
              setState("addError", "")
            }}
            placeholder={language.t("settings.providers.models.add.id")}
            label={language.t("settings.providers.models.add.id")}
            hideLabel
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            error={state.addError}
            validationState={state.addError ? "invalid" : undefined}
          />
          <TextField
            variant="normal"
            type="text"
            value={state.addModelName}
            onChange={(value) => setState("addModelName", value)}
            placeholder={language.t("settings.providers.models.add.name")}
            label={language.t("settings.providers.models.add.name")}
            hideLabel
          />
          <Button type="submit" size="large" variant="secondary" icon="plus-small">
            {language.t("settings.providers.models.add.submit")}
          </Button>
        </form>

        <div class="px-2.5">
          <SettingsList>
            <Show
              when={filteredEntries().length > 0}
              fallback={
                <div class="px-4 py-10 text-center text-12-regular text-text-weak">
                  {language.t("settings.providers.models.empty")}
                </div>
              }
            >
              <For each={filteredEntries()}>
                {(entry) => (
                  <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                    <div class="min-w-0">
                      <span class="text-14-regular text-text-strong truncate block">{entry.model.name}</span>
                      <span class="text-12-regular text-text-weak truncate block">{entry.id}</span>
                    </div>
                    <Switch
                      checked={!!state.selected[entry.id]}
                      onChange={(value) => toggle(entry.id, value)}
                      hideLabel
                    >
                      {entry.model.name}
                    </Switch>
                  </div>
                )}
              </For>
            </Show>
          </SettingsList>
          <Show when={state.error}>
            <div class="pt-2 text-12-regular text-text-danger-base">{state.error}</div>
          </Show>
        </div>

        <div class="flex justify-end gap-2 px-2.5">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
