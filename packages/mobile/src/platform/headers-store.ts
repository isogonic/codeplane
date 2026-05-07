/**
 * Per-instance auth headers, stored in the OS keychain on native.
 *
 * On iOS this writes to the Keychain (kSecClassGenericPassword), on
 * Android to the EncryptedSharedPreferences. In the dev/browser
 * fallback we keep them in `sessionStorage` (deliberately ephemeral —
 * we don't want plaintext secrets in localStorage during development).
 *
 * Each instance gets one entry: `cp:headers:<instanceId>` mapping to a
 * JSON-encoded `Record<string, string>`. The renderer never reads
 * secrets that don't belong to the currently focused instance.
 */

import { SecureStoragePlugin } from "capacitor-secure-storage-plugin"
import { Capacitor } from "@capacitor/core"

const useNative = Capacitor.isNativePlatform()
const KEY_PREFIX = "cp:headers:"

type HeaderMap = Record<string, string>

const safeParse = (value: string | null): HeaderMap => {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: HeaderMap = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v
      }
      return out
    }
  } catch {
    // fall through
  }
  return {}
}

export const mobileHeadersStore = {
  async get(instanceId: string): Promise<HeaderMap> {
    const key = KEY_PREFIX + instanceId
    if (useNative) {
      try {
        const { value } = await SecureStoragePlugin.get({ key })
        return safeParse(value)
      } catch {
        return {}
      }
    }
    return safeParse(sessionStorage.getItem(key))
  },

  async set(instanceId: string, headers: HeaderMap): Promise<void> {
    const key = KEY_PREFIX + instanceId
    const value = JSON.stringify(headers)
    if (useNative) {
      try {
        await SecureStoragePlugin.set({ key, value })
        return
      } catch {
        // ignore — better to no-op than to leak a fallback
        return
      }
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
