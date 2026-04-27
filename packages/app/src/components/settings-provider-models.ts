import type { Model, Provider, ProviderConfig } from "@codeplane-ai/sdk/v2/client"

type ProviderModelSource = {
  models: Record<string, Model>
  providerCatalog: boolean
}

type ProviderModelConfig = NonNullable<ProviderConfig["models"]>[string]

export function providerModelCatalog(input: {
  provider: Provider
  catalog?: Provider
  catalogs?: Provider[]
}): ProviderModelSource {
  if (input.catalog && Object.keys(input.catalog.models).length > 0) {
    return { models: input.catalog.models, providerCatalog: true }
  }

  const models = new Map(Object.values(input.provider.models).map((model) => [model.id, model]))
  input.catalogs?.forEach((provider) => {
    Object.values(provider.models).forEach((model) => {
      if (!models.has(model.id)) models.set(model.id, model)
    })
  })
  return { models: Object.fromEntries(models), providerCatalog: false }
}

export function configuredProviderModelIDs(input: {
  provider: Provider
  catalog?: Provider
  catalogs?: Provider[]
  config?: ProviderConfig
}) {
  const source = providerModelCatalog(input)
  const ids = Object.keys(source.models)
  const available = new Set(ids)
  if (input.config?.whitelist?.length) return new Set(input.config.whitelist.filter((id) => available.has(id)))
  if (input.config?.blacklist?.length) return new Set(ids.filter((id) => !input.config?.blacklist?.includes(id)))
  if (!source.providerCatalog) return new Set(Object.keys(input.provider.models).filter((id) => available.has(id)))
  return new Set(ids)
}

export function providerModelEntries(input: {
  provider: Provider
  catalog?: Provider
  catalogs?: Provider[]
  config?: ProviderConfig
}) {
  const source = providerModelCatalog(input)
  const configured = configuredProviderModelIDs(input)
  return Object.values(source.models)
    .map((model) => ({
      id: model.id,
      model,
      selected: configured.has(model.id),
    }))
    .sort((a, b) => a.model.name.localeCompare(b.model.name) || a.id.localeCompare(b.id))
}

function modelConfig(model: Model): ProviderModelConfig {
  const limit =
    model.limit.context && model.limit.output
      ? {
          limit: {
            context: model.limit.context,
            output: model.limit.output,
            ...(model.limit.input !== undefined ? { input: model.limit.input } : {}),
          },
        }
      : {}

  return {
    name: model.name,
    temperature: model.capabilities.temperature,
    reasoning: model.capabilities.reasoning,
    attachment: model.capabilities.attachment,
    tool_call: model.capabilities.toolcall,
    ...(model.family ? { family: model.family } : {}),
    ...(model.release_date ? { release_date: model.release_date } : {}),
    ...limit,
  }
}

export function buildProviderModelConfig(
  config: ProviderConfig | undefined,
  selected: string[],
  entries: Array<{ id: string; model: Model }> = [],
  options: { includeModels?: boolean; includeModelIDs?: string[] } = {},
): ProviderConfig {
  const include = new Set(options.includeModelIDs ?? [])
  const generated =
    options.includeModels || include.size > 0
      ? Object.fromEntries(
          selected
            .map((id) => {
              if (!options.includeModels && !include.has(id)) return
              const entry = entries.find((item) => item.id === id)
              if (!entry) return
              return [id, modelConfig(entry.model)] as const
            })
            .filter((item): item is readonly [string, ProviderModelConfig] => !!item),
        )
      : undefined
  const models = generated ? { ...generated, ...(config?.models ?? {}) } : config?.models

  return {
    ...(config ?? {}),
    whitelist: selected.slice().sort((a, b) => a.localeCompare(b)),
    blacklist: [],
    ...(models ? { models } : {}),
  }
}
