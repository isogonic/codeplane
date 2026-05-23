import { describe, expect, test } from "bun:test"
import {
  customProviderModelsURL,
  readCustomProviderModelsResponse,
  validateCustomProvider,
} from "./dialog-custom-provider-form"

const t = (key: string) => key

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })
})

describe("custom provider model fetching", () => {
  test("targets the API root even when the app is served below /app", () => {
    expect(customProviderModelsURL("https://example.com/app")).toBe("https://example.com/provider/custom-models")
    expect(customProviderModelsURL("https://example.com/app/")).toBe("https://example.com/provider/custom-models")
  })

  test("rejects HTML responses without surfacing JSON parse errors", async () => {
    await expect(
      readCustomProviderModelsResponse(
        new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
        "fetch failed",
      ),
    ).rejects.toThrow("fetch failed")
  })

  test("accepts JSON responses with charset", async () => {
    await expect(
      readCustomProviderModelsResponse(
        Response.json(
          { models: [{ id: "model-a", name: "Model A" }] },
          { headers: { "content-type": "application/json; charset=utf-8" } },
        ),
        "fetch failed",
      ),
    ).resolves.toEqual({ models: [{ id: "model-a", name: "Model A" }] })
  })
})
