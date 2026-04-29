import { onCleanup } from "solid-js"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import { showToast } from "@codeplane-ai/ui/toast"
import { useGlobalSDK } from "./global-sdk"
import { useLanguage } from "./language"
import { formatServerError } from "@/utils/server-errors"

export const { use: useUpdates, provider: UpdatesProvider } = createSimpleContext({
  name: "Updates",
  init: () => {
    const globalSDK = useGlobalSDK()
    const language = useLanguage()
    const announced = new Set<string>()
    const state = { upgrading: false }
    let reloadTimer: ReturnType<typeof setTimeout> | undefined

    const showInstalled = (version?: string, restart?: boolean) => {
      const key = `updated:${version ?? "unknown"}`
      if (announced.has(key) && !restart) return
      announced.add(key)
      showToast({
        id: "codeplane.update",
        title: language.t("toast.update.installed.title"),
        description: version
          ? language.t("toast.update.installed.description", { version })
          : language.t("toast.update.installed.descriptionFallback"),
        variant: "success",
        icon: "check",
        persistent: !restart,
        actions: restart
          ? undefined
          : [
              {
                label: language.t("toast.update.action.restart"),
                onClick: () => window.location.reload(),
              },
              {
                label: language.t("toast.update.action.dismiss"),
                onClick: "dismiss",
              },
            ],
      })
      if (!restart) return
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => window.location.reload(), 4_500)
    }

    const startUpgrade = async (target?: string) => {
      if (state.upgrading) return
      state.upgrading = true
      showToast({
        id: "codeplane.update",
        title: language.t("toast.update.installing.title"),
        description: language.t("toast.update.installing.description"),
        variant: "loading",
        persistent: true,
      })
      try {
        const result = await globalSDK.client.global.upgrade(target ? { target } : undefined)
        const data = result.data
        if (!data || ("success" in data && data.success === false)) {
          const message = data && "error" in data ? data.error : language.t("toast.update.failed.description")
          showToast({
            id: "codeplane.update",
            title: language.t("toast.update.failed.title"),
            description: message,
            variant: "error",
            icon: "warning",
          })
          return
        }
        if ("success" in data && data.success) {
          if (data.skipped) {
            showToast({
              id: "codeplane.update",
              title: language.t("toast.update.installed.title"),
              description: language.t("settings.general.row.version.descriptionUpToDate", { current: data.version }),
              variant: "success",
              icon: "check",
            })
            return
          }
          showInstalled(data.version, data.restart === true)
        }
      } catch (err) {
        showToast({
          id: "codeplane.update",
          title: language.t("toast.update.failed.title"),
          description: formatServerError(err, language.t),
          variant: "error",
          icon: "warning",
        })
      } finally {
        state.upgrading = false
      }
    }

    const unsub = globalSDK.event.listen((e) => {
      const event = e.details
      if (event.type === "installation.update-available") {
        const version = event.properties?.version
        if (!version || announced.has(`available:${version}`)) return
        announced.add(`available:${version}`)
        showToast({
          title: language.t("toast.update.available.title"),
          description: language.t("toast.update.available.description", { version }),
          icon: "download",
          persistent: true,
          actions: [
            {
              label: language.t("toast.update.action.updateNow"),
              onClick: () => void startUpgrade(version),
            },
            {
              label: language.t("toast.update.action.later"),
              onClick: "dismiss",
            },
          ],
        })
        return
      }

      if (event.type === "installation.updated") {
        const version = event.properties?.version
        showInstalled(version)
      }
    })

    onCleanup(() => {
      unsub()
      if (reloadTimer) clearTimeout(reloadTimer)
    })

    return {
      startUpgrade,
      isUpgrading: () => state.upgrading,
    }
  },
})
