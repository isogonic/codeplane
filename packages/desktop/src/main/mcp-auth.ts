import type { Session } from "electron"

type InstanceLike = { id: string; label?: string }

type BrowserWindowLike = {
  close: () => void
  focus: () => void
  isDestroyed: () => boolean
  loadURL: (url: string) => Promise<unknown>
  on: (event: string, listener: (...args: unknown[]) => void) => unknown
  webContents: {
    on: (event: string, listener: (...args: unknown[]) => void) => unknown
  }
}

type BrowserWindowCtor = new (options?: any) => any

export type DesktopMcpOAuthLaunch = {
  name: string
  authorizationUrl: string
  redirectUri: string
}

function normalizePathname(pathname: string) {
  const value = pathname.replace(/\/+$/, "")
  return value || "/"
}

export function isMcpOAuthRedirect(currentUrl: string, redirectUri: string) {
  try {
    const current = new URL(currentUrl)
    const redirect = new URL(redirectUri)
    return current.origin === redirect.origin && normalizePathname(current.pathname) === normalizePathname(redirect.pathname)
  } catch {
    return false
  }
}

export async function fetchAutoConnectMcpOAuthLaunches(input: {
  baseUrl: string
  fetchFn: typeof fetch
}): Promise<DesktopMcpOAuthLaunch[]> {
  const response = await input.fetchFn(new URL("mcp/auth/auto-connect", input.baseUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    redirect: "follow",
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching MCP OAuth launches`)
  }
  const payload = await response.json().catch(() => [])
  if (!Array.isArray(payload)) return []
  return payload.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const name = "name" in entry && typeof entry.name === "string" ? entry.name : undefined
    const authorizationUrl =
      "authorizationUrl" in entry && typeof entry.authorizationUrl === "string" ? entry.authorizationUrl : undefined
    const redirectUri = "redirectUri" in entry && typeof entry.redirectUri === "string" ? entry.redirectUri : undefined
    if (!name || !authorizationUrl || !redirectUri) return []
    return [{ name, authorizationUrl, redirectUri }]
  })
}

export function createDesktopMcpOAuthManager(input: {
  BrowserWindow: BrowserWindowCtor
  log: (event: string, data?: unknown) => void
}) {
  const windows = new Map<string, BrowserWindowLike>()

  const keyFor = (instance: InstanceLike, launch: DesktopMcpOAuthLaunch) => `${instance.id}\x00${launch.name}`

  const cleanup = (key: string, window: BrowserWindowLike) => {
    if (windows.get(key) === window) {
      windows.delete(key)
    }
  }

  return {
    async open(instance: InstanceLike, session: Session, launch: DesktopMcpOAuthLaunch) {
      const key = keyFor(instance, launch)
      const existing = windows.get(key)
      if (existing && !existing.isDestroyed()) {
        input.log("mcp.oauth.window.focus-existing", { instanceID: instance.id, mcpName: launch.name })
        existing.focus()
        return
      }

      const child = new input.BrowserWindow({
        width: 620,
        height: 780,
        title: `Authorize ${launch.name}`,
        autoHideMenuBar: true,
        webPreferences: {
          session,
          partition: undefined,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      }) as BrowserWindowLike
      windows.set(key, child)
      child.on("closed", () => cleanup(key, child))

      const closeOnRedirect = (...args: unknown[]) => {
        const navigatedUrl = args.find((value): value is string => typeof value === "string")
        if (!navigatedUrl || !isMcpOAuthRedirect(navigatedUrl, launch.redirectUri)) return
        input.log("mcp.oauth.window.callback", { instanceID: instance.id, mcpName: launch.name, url: navigatedUrl })
        setTimeout(() => {
          if (!child.isDestroyed()) child.close()
        }, 250)
      }

      child.webContents.on("did-navigate", closeOnRedirect)
      child.webContents.on("did-navigate-in-page", closeOnRedirect)

      input.log("mcp.oauth.window.open", {
        authorizationUrl: launch.authorizationUrl,
        instanceID: instance.id,
        mcpName: launch.name,
        redirectUri: launch.redirectUri,
      })

      try {
        await child.loadURL(launch.authorizationUrl)
      } catch (error) {
        cleanup(key, child)
        input.log("mcp.oauth.window.load-error", {
          error: error instanceof Error ? error.message : String(error),
          instanceID: instance.id,
          mcpName: launch.name,
        })
        if (!child.isDestroyed()) child.close()
        throw error
      }
    },
    size() {
      return windows.size
    },
  }
}
