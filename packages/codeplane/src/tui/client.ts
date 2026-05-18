import { createCodeplaneClient } from "@codeplane-ai/sdk/v2/client"
import type { SavedInstance } from "@codeplane-ai/shared/instance"

export function normalizeInstanceUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function headersForInstance(instance: SavedInstance) {
  return {
    ...(instance.headers ?? {}),
  }
}

export function createInstanceClient(input: {
  instance: SavedInstance
  directory?: string
  signal?: AbortSignal
  throwOnError?: boolean
}) {
  const baseUrl = normalizeInstanceUrl(input.instance.url)
  if (!baseUrl) {
    throw new Error(`Invalid instance URL: ${input.instance.url}`)
  }

  return createCodeplaneClient({
    baseUrl,
    directory: input.directory,
    headers: headersForInstance(input.instance),
    signal: input.signal,
    throwOnError: input.throwOnError ?? true,
  })
}

export function wsUrlForInstance(instance: SavedInstance, pathname: string) {
  const baseUrl = normalizeInstanceUrl(instance.url)
  if (!baseUrl) {
    throw new Error(`Invalid instance URL: ${instance.url}`)
  }
  const url = new URL(pathname.replace(/^\/+/, ""), `${baseUrl}/`)
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Instance URL protocol is not websocket-compatible: ${url.protocol}`)
  }
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}
