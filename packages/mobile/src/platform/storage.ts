/**
 * Non-sensitive key/value storage for the mobile app.
 *
 * Backed by `@capacitor/preferences` on native (NSUserDefaults on iOS,
 * SharedPreferences on Android), and falls back to `localStorage` when
 * running in the Vite dev server / desktop browser preview so the same
 * code path works during development.
 *
 * Sensitive material — auth headers, client cert references — never
 * goes through here; see `headers-store.ts`.
 */

import { Preferences } from "@capacitor/preferences"
import { Capacitor } from "@capacitor/core"

const useNative = Capacitor.isNativePlatform()

export const mobilePreferences = {
  async getItem(key: string): Promise<string | null> {
    if (useNative) {
      const { value } = await Preferences.get({ key })
      return value ?? null
    }
    return localStorage.getItem(key)
  },

  async setItem(key: string, value: string): Promise<void> {
    if (useNative) {
      await Preferences.set({ key, value })
      return
    }
    localStorage.setItem(key, value)
  },

  async removeItem(key: string): Promise<void> {
    if (useNative) {
      await Preferences.remove({ key })
      return
    }
    localStorage.removeItem(key)
  },
}
