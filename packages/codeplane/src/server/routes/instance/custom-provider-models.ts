import z from "zod"

export const CustomProviderModelsInputZod = z.object({
  baseURL: z.string(),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

export const CustomProviderModelsResultZod = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
})

export type CustomProviderModelsInput = z.infer<typeof CustomProviderModelsInputZod>
export type CustomProviderModelsResult = z.infer<typeof CustomProviderModelsResultZod>

export function customProviderModelsEndpoint(baseURL: string) {
  return `${baseURL.trim().replace(/\/+$/, "")}/models`
}

function isJSON(contentType: string | null) {
  const mediaType = contentType?.split(";")[0].trim().toLowerCase()
  return mediaType === "application/json" || mediaType?.endsWith("+json")
}

function modelItems(payload: unknown) {
  if (!payload || typeof payload !== "object") return []
  const result = payload as { data?: unknown; models?: unknown }
  if (Array.isArray(result.data)) return result.data
  if (Array.isArray(result.models)) return result.models
  return []
}

function modelFromItem(item: unknown) {
  if (typeof item === "string" && item) return { id: item, name: item }
  if (!item || typeof item !== "object") return
  const model = item as { id?: unknown; name?: unknown }
  if (typeof model.id !== "string" || !model.id) return
  return { id: model.id, name: typeof model.name === "string" && model.name ? model.name : model.id }
}

export async function fetchCustomProviderModels(input: CustomProviderModelsInput): Promise<CustomProviderModelsResult> {
  const headers = new Headers(input.headers ?? {})
  if (input.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${input.apiKey}`)
  if (!headers.has("accept")) headers.set("accept", "application/json")

  const response = await fetch(customProviderModelsEndpoint(input.baseURL), { headers })
  if (!response.ok) throw new Error(`Failed to fetch models: ${response.status}`)
  if (!isJSON(response.headers.get("content-type"))) throw new Error("Provider returned a non-JSON models response")

  const payload = await response.json().catch(() => undefined)
  return {
    models: modelItems(payload)
      .map(modelFromItem)
      .filter((item): item is { id: string; name: string } => !!item)
      .sort((a, b) => a.id.localeCompare(b.id)),
  }
}
