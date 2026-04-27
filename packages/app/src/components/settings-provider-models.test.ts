import { describe, expect, test } from "bun:test"
import type { Model, Provider, ProviderConfig } from "@codeplane-ai/sdk/v2/client"
import { buildProviderModelConfig, providerModelEntries } from "./settings-provider-models"

const model = (providerID: string, id: string, name = id): Model => ({
  id,
  providerID,
  api: {
    id,
    url: "",
    npm: "@ai-sdk/openai-compatible",
  },
  name,
  capabilities: {
    temperature: false,
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
    context: 128000,
    output: 4096,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

const provider = (id: string, models: Model[]): Provider => ({
  id,
  name: id,
  source: "api",
  env: [],
  options: {},
  models: Object.fromEntries(models.map((item) => [item.id, item])),
})

describe("provider model configuration helpers", () => {
  test("selects every catalog model when no whitelist or blacklist exists", () => {
    const item = provider("anthropic", [model("anthropic", "runtime")])
    const catalog = provider("anthropic", [model("anthropic", "sonnet", "Sonnet"), model("anthropic", "opus", "Opus")])

    expect(providerModelEntries({ provider: item, catalog }).map((entry) => [entry.id, entry.selected])).toEqual([
      ["opus", true],
      ["sonnet", true],
    ])
  })

  test("uses whitelist as the selected model set", () => {
    const item = provider("anthropic", [model("anthropic", "sonnet")])
    const catalog = provider("anthropic", [model("anthropic", "sonnet"), model("anthropic", "opus")])

    expect(
      providerModelEntries({ provider: item, catalog, config: { whitelist: ["sonnet"] } }).map((entry) => [
        entry.id,
        entry.selected,
      ]),
    ).toEqual([
      ["opus", false],
      ["sonnet", true],
    ])
  })

  test("uses blacklist to exclude models from the selected set", () => {
    const item = provider("anthropic", [model("anthropic", "sonnet")])
    const catalog = provider("anthropic", [model("anthropic", "sonnet"), model("anthropic", "opus")])

    expect(
      providerModelEntries({ provider: item, catalog, config: { blacklist: ["opus"] } }).map((entry) => [
        entry.id,
        entry.selected,
      ]),
    ).toEqual([
      ["opus", false],
      ["sonnet", true],
    ])
  })

  test("falls back to runtime models for custom providers without catalog models", () => {
    const item = provider("local", [model("local", "llama"), model("local", "qwen")])

    expect(providerModelEntries({ provider: item }).map((entry) => [entry.id, entry.selected])).toEqual([
      ["llama", true],
      ["qwen", true],
    ])
  })

  test("uses all catalog models for custom providers when no provider catalog exists", () => {
    const item = provider("local", [model("local", "llama")])
    const catalogs = [
      provider("anthropic", [model("anthropic", "sonnet", "Sonnet")]),
      provider("openai", [model("openai", "gpt", "GPT")]),
    ]

    expect(providerModelEntries({ provider: item, catalogs }).map((entry) => [entry.id, entry.selected])).toEqual([
      ["gpt", false],
      ["llama", true],
      ["sonnet", false],
    ])
  })

  test("builds whitelist config and clears stale blacklist", () => {
    const config: ProviderConfig = {
      name: "Anthropic",
      blacklist: ["opus"],
      models: {
        sonnet: {
          name: "Sonnet Override",
        },
      },
    }

    expect(buildProviderModelConfig(config, ["sonnet", "haiku"])).toEqual({
      name: "Anthropic",
      whitelist: ["haiku", "sonnet"],
      blacklist: [],
      models: {
        sonnet: {
          name: "Sonnet Override",
        },
      },
    })
  })

  test("adds selected catalog models to custom provider config", () => {
    const entry = { id: "sonnet", model: model("anthropic", "sonnet", "Sonnet") }

    expect(buildProviderModelConfig(undefined, ["sonnet"], [entry], { includeModels: true })).toEqual({
      whitelist: ["sonnet"],
      blacklist: [],
      models: {
        sonnet: {
          name: "Sonnet",
          temperature: false,
          reasoning: false,
          attachment: false,
          tool_call: true,
          release_date: "2026-01-01",
          limit: {
            context: 128000,
            output: 4096,
          },
        },
      },
    })
  })

  test("can add only explicit new models to a provider-specific catalog config", () => {
    const catalogEntry = { id: "sonnet", model: model("anthropic", "sonnet", "Sonnet") }
    const newEntry = { id: "new-model", model: model("anthropic", "new-model", "New Model") }

    expect(
      buildProviderModelConfig(undefined, ["sonnet", "new-model"], [catalogEntry, newEntry], {
        includeModelIDs: ["new-model"],
      }),
    ).toEqual({
      whitelist: ["new-model", "sonnet"],
      blacklist: [],
      models: {
        "new-model": {
          name: "New Model",
          temperature: false,
          reasoning: false,
          attachment: false,
          tool_call: true,
          release_date: "2026-01-01",
          limit: {
            context: 128000,
            output: 4096,
          },
        },
      },
    })
  })
})
