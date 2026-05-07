/**
 * Per-instance SSO token cache, keyed by `cp:sso:tokens:<instanceId>`
 * in the OS keychain (via the existing secure-storage plugin) on
 * native, and `sessionStorage` on web for dev/preview ergonomics.
 *
 * We deliberately use the same `mobileHeadersStore` infrastructure
 * we already audited for the per-instance auth headers: same threat
 * model, same lifecycle, same `clear` semantics on instance delete.
 */

import { SecureStoragePlugin } from "capacitor-secure-storage-plugin"
import { Capacitor } from "@capacitor/core"
import type { SSOTokens } from "./sso-types"

const useNative = Capacitor.isNativePlatform()
const KEY_PREFIX = "cp:sso:tokens:"

const safeParse = (raw: string | null): SSOTokens | null => {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<SSOTokens>
    if (typeof v.accessToken === "string" && typeof v.expiresAt === "number" && typeof v.tokenType === "string") {
      return {
        accessToken: v.accessToken,
        refreshToken: typeof v.refreshToken === "string" ? v.refreshToken : undefined,
        idToken: typeof v.idToken === "string" ? v.idToken : undefined,
        expiresAt: v.expiresAt,
        tokenType: v.tokenType,
        scope: typeof v.scope === "string" ? v.scope : undefined,
      }
    }
  } catch {
    // fall through
  }
  return null
}

export const ssoTokenStore = {
  async get(instanceId: string): Promise<SSOTokens | null> {
    const key = KEY_PREFIX + instanceId
    if (useNative) {
      try {
        const { value } = await SecureStoragePlugin.get({ key })
        return safeParse(value)
      } catch {
        return null
      }
    }
    return safeParse(sessionStorage.getItem(key))
  },

  async set(instanceId: string, tokens: SSOTokens): Promise<void> {
    const key = KEY_PREFIX + instanceId
    const value = JSON.stringify(tokens)
    if (useNative) {
      try {
        await SecureStoragePlugin.set({ key, value })
      } catch {
        // Better to no-op than to fall through to a less-secure store —
        // the user can re-auth on next open if persistence fails.
      }
      return
    }
    sessionStorage.setItem(key, value)
  },

  async clear(instanceId: string): Promise<void> {
    const key = KEY_PREFIX + instanceId
    if (useNative) {
      try {
        await SecureStoragePlugin.remove({ key })
      } catch {
        // already gone
      }
      return
    }
    sessionStorage.removeItem(key)
  },
}
