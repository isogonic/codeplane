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

    const startUpgrade = async (target?: string) => {
      if (state.upgrading) return
      state.upgrading = true
      showToast({
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
            title: language.t("toast.update.failed.title"),
            description: message,
            variant: "error",
            icon: "warning",
          })
        }
      } catch (err) {
        showToast({
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
        const key = `updated:${version ?? "unknown"}`
        if (announced.has(key)) return
        announced.add(key)
        showToast({
          title: language.t("toast.update.installed.title"),
          description: version
            ? language.t("toast.update.installed.description", { version })
            : language.t("toast.update.installed.descriptionFallback"),
          variant: "success",
          icon: "check",
          persistent: true,
          actions: [
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
      }
    })

    onCleanup(() => unsub())

    return {
      startUpgrade,
      isUpgrading: () => state.upgrading,
    }
  },
})
