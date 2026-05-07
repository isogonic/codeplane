/**
 * Mobile-side instance store.
 *
 * Mirrors the desktop's `createInstanceStore` but persists through
 * Capacitor Preferences instead of a JSON file. The shape of the
 * `SavedInstance` record is the same (imported from
 * `@codeplane-ai/shared/instance`) so the same business logic — and
 * later the same shared UI components — work in both shells.
 *
 * The headers field is split into the secure store; on disk we only
 * keep a boolean marker `headers: { __secure: true }` so the picker
 * can show a "headers configured" badge without touching plaintext.
 */

import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { mobilePreferences } from "./storage"
import type { SSOConfig } from "./sso-types"

const KEY_INSTANCES = "cp:instances:v1"
const KEY_LAST = "cp:instances:last"
const KEY_SSO_CONFIG = (id: string) => `cp:sso:config:${id}`

type Persisted = SavedInstance & { headers?: Record<string, string> }
type StoredState = {
  instances: Persisted[]
  lastInstanceID?: string
}

const readState = async (): Promise<StoredState> => {
  const raw = await mobilePreferences.getItem(KEY_INSTANCES)
  if (!raw) return { instances: [] }
  try {
    const parsed = JSON.parse(raw) as StoredState
    return {
      instances: Array.isArray(parsed.instances) ? parsed.instances : [],
      lastInstanceID: parsed.lastInstanceID,
    }
  } catch {
    return { instances: [] }
  }
}

const writeState = async (state: StoredState) => {
  await mobilePreferences.setItem(KEY_INSTANCES, JSON.stringify(state))
}

type HeadersStore = {
  get: (id: string) => Promise<Record<string, string>>
  set: (id: string, headers: Record<string, string>) => Promise<void>
  clear: (id: string) => Promise<void>
}

const stripPlaintextHeaders = (instance: SavedInstance): Persisted => {
  const { headers, ...rest } = instance
  if (headers && Object.keys(headers).length > 0) {
    return { ...rest, headers: { __secure: "1" } }
  }
  return rest
}

export function mobileInstanceStore(headersStore: HeadersStore) {
  const list = async (): Promise<SavedInstance[]> => {
    const state = await readState()
    return state.instances.map((entry) => {
      // Re-attach a marker so the renderer can display "headers configured"
      // without us having to leak the secret values into the renderer.
      const { headers, ...rest } = entry
      const hasSecret = headers && headers.__secure === "1"
      return hasSecret ? { ...rest, headers: { __secure: "1" } } : rest
    })
  }

  const getLastId = async () => (await readState()).lastInstanceID

  const setLastId = async (id: string) => {
    const state = await readState()
    await writeState({ ...state, lastInstanceID: id })
  }

  const save = async (instance: SavedInstance): Promise<SavedInstance[]> => {
    const state = await readState()
    const persisted = stripPlaintextHeaders(instance)
    const idx = state.instances.findIndex((item) => item.id === instance.id)
    const next: Persisted[] =
      idx === -1
        ? [...state.instances, persisted]
        : state.instances.map((item, i) => (i === idx ? persisted : item))
    await writeState({ instances: next, lastInstanceID: instance.id })
    if (instance.headers && Object.keys(instance.headers).length > 0 && !("__secure" in instance.headers)) {
      await headersStore.set(instance.id, instance.headers)
    }
    return list()
  }

  const remove = async (id: string): Promise<SavedInstance[]> => {
    const state = await readState()
    await writeState({
      instances: state.instances.filter((item) => item.id !== id),
      lastInstanceID: state.lastInstanceID === id ? undefined : state.lastInstanceID,
    })
    await headersStore.clear(id)
    // SSO config + tokens are also instance-scoped; clear them on
    // removal so a re-added instance with the same id doesn't inherit
    // stale credentials. The token store is cleared by the caller
    // (api.ts) after this returns to avoid pulling more deps in here.
    await mobilePreferences.removeItem(KEY_SSO_CONFIG(id))
    return list()
  }

  /**
   * Per-instance SSO configuration. Lives in plain preferences (not
   * the keychain) because the contents are public-client OAuth
   * metadata — clientId, scopes, redirect URI, endpoints. Tokens
   * obtained from this config are stored separately by `sso-store.ts`.
   */
  const ssoConfig = {
    async get(instanceId: string): Promise<SSOConfig | null> {
      const raw = await mobilePreferences.getItem(KEY_SSO_CONFIG(instanceId))
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as Partial<SSOConfig>
        if (!parsed || typeof parsed !== "object") return null
        if (typeof parsed.clientId !== "string" || typeof parsed.redirectUri !== "string") return null
        return {
          enabled: !!parsed.enabled,
          provider: (parsed.provider ?? "custom") as SSOConfig["provider"],
          displayName: parsed.displayName,
          clientId: parsed.clientId,
          scopes: Array.isArray(parsed.scopes) ? parsed.scopes.filter((s) => typeof s === "string") : [],
          redirectUri: parsed.redirectUri,
          tenant: typeof parsed.tenant === "string" ? parsed.tenant : undefined,
          endpoints: parsed.endpoints,
          audience: typeof parsed.audience === "string" ? parsed.audience : undefined,
          extraAuthParams: parsed.extraAuthParams,
        }
      } catch {
        return null
      }
    },
    async set(instanceId: string, config: SSOConfig): Promise<void> {
      await mobilePreferences.setItem(KEY_SSO_CONFIG(instanceId), JSON.stringify(config))
    },
    async clear(instanceId: string): Promise<void> {
      await mobilePreferences.removeItem(KEY_SSO_CONFIG(instanceId))
    },
  }

  return {
    list,
    getLastId,
    setLastId,
    save,
    remove,
    secrets: {
      get: (instanceId: string) => headersStore.get(instanceId),
      set: (instanceId: string, headers: Record<string, string>) => headersStore.set(instanceId, headers),
      clear: (instanceId: string) => headersStore.clear(instanceId),
    },
    ssoConfig,
  }
}
