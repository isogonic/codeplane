export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config, type ResolvedRequestOptions } from "./gen/client/types.gen.js"
import { CodeplaneClient } from "./gen/sdk.gen.js"
export { type Config as CodeplaneClientConfig, CodeplaneClient }

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function initFromRequest(request: Request, options: ResolvedRequestOptions): RequestInit {
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : ((options.serializedBody ?? options.body) as BodyInit | null | undefined)

  return {
    body,
    cache: request.cache,
    credentials: request.credentials,
    headers: request.headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  }
}

function rewrite(
  request: Request,
  options: ResolvedRequestOptions,
  values: { directory?: string; workspace?: string },
) {
  const url = new URL(request.url)
  let changed = false
  const json =
    request.credentials === "include" &&
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json"

  for (const [name, key] of [
    ["x-codeplane-directory", "directory"],
    ["x-codeplane-workspace", "workspace"],
  ] as const) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
    changed = true
  }

  if (!changed && !json) return request

  const next = new Request(changed ? url : request.url, initFromRequest(request, options))
  next.headers.delete("x-codeplane-directory")
  next.headers.delete("x-codeplane-workspace")
  if (json) next.headers.set("content-type", "text/plain")
  return next
}

export function createCodeplaneClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
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

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-codeplane-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  client.interceptors.request.use((request, options) =>
    rewrite(request, options, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  client.interceptors.response.use((response) => {
    const contentType = response.headers.get("content-type")
    if (contentType === "text/html")
      throw new Error("Request is not supported by this version of CodePlane Server (Server responded with text/html)")

    return response
  })
  return new CodeplaneClient({ client })
}
