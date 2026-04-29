export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { CodeplaneClient } from "./gen/sdk.gen.js"
export { type Config as CodeplaneClientConfig, CodeplaneClient }

function pick(value: string | null, fallback?: string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (value === encodeURIComponent(fallback)) return fallback
  return value
}

function rewrite(request: Request, directory?: string) {
  const json =
    request.credentials === "include" &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json"
  const value = pick(request.headers.get("x-codeplane-directory"), directory)
  if (!value && !json) return request

  const url = new URL(request.url)
  if (value && !url.searchParams.has("directory")) {
    url.searchParams.set("directory", value)
  }

  const next = new Request(value ? url : request.url, request)
  next.headers.delete("x-codeplane-directory")
  if (json) next.headers.set("content-type", "text/plain")
  return next
}

export function createCodeplaneClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-codeplane-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request) => rewrite(request, config?.directory))
  return new CodeplaneClient({ client })
}
