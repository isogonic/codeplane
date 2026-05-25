import { createStore, reconcile } from "solid-js/store"
import { createSimpleContext } from "./helper"
import type { PromptInfo } from "../component/prompt/history"

export type HomeRoute = {
  type: "home"
  prompt?: PromptInfo
}

export type SessionRoute = {
  type: "session"
  sessionID: string
  prompt?: PromptInfo
}

export type PluginRoute = {
  type: "plugin"
  id: string
  data?: Record<string, unknown>
}

export type Route = HomeRoute | SessionRoute | PluginRoute

// Parse CODEPLANE_ROUTE defensively — a malformed value here would otherwise
// crash the TUI bootstrap before any error UI is mounted.
const parseRouteEnv = (raw: string | undefined): Route | undefined => {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw)
    if (value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string") {
      return value as Route
    }
  } catch {
    // fall through to undefined → default to home route
  }
  return undefined
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: (props: { initialRoute?: Route }) => {
    const [store, setStore] = createStore<Route>(
      props.initialRoute ?? parseRouteEnv(process.env["CODEPLANE_ROUTE"]) ?? { type: "home" },
    )

    return {
      get data() {
        return store
      },
      navigate(route: Route) {
        setStore(reconcile(route))
      },
    }
  },
})

export type RouteContext = ReturnType<typeof useRoute>

export function useRouteData<T extends Route["type"]>(type: T) {
  const route = useRoute()
  return route.data as Extract<Route, { type: typeof type }>
}
