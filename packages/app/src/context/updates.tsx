import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import { showToast } from "@codeplane-ai/ui/toast"
import { useGlobalSDK } from "./global-sdk"
import { useLanguage } from "./language"
import { formatServerError } from "@/utils/server-errors"

type Status = {
  current: string
  latest: string | null
  hasUpdate: boolean
  method: string
}

export const { use: useUpdates, provider: UpdatesProvider } = createSimpleContext({
  name: "Updates",
  init: () => {
    const globalSDK = useGlobalSDK()
    const language = useLanguage()
    const announcedAvailable = new Set<string>()
    const announcedInstalled = new Set<string>()
    const [upgrading, setUpgrading] = createSignal(false)
    const [status, setStatus] = createSignal<Status | undefined>(undefined)
    let reloadTimer: ReturnType<typeof setTimeout> | undefined

    const fetchStatus = async (refresh = false) => {
      try {
        const url = `${globalSDK.url}/global/version${refresh ? "?refresh=1" : ""}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const next = (await response.json()) as Status
        setStatus(next)
        return next
      } catch {
        return undefined
      }
    }

    const showAvailable = (version: string) => {
      if (announcedAvailable.has(version)) return
      announcedAvailable.add(version)
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
    }

    const showInstalled = (version?: string, restart?: boolean, restartRequired?: boolean) => {
      const key = `${version ?? "unknown"}:${restart ? "restart" : restartRequired ? "manual" : "ok"}`
      if (announcedInstalled.has(key) && !restart) return
      announcedInstalled.add(key)
      const description = restartRequired
        ? language.t("toast.update.installed.descriptionRestartRequired", {
            version: version ?? language.t("settings.general.row.version.developmentBuild"),
          })
        : version
          ? language.t("toast.update.installed.description", { version })
          : language.t("toast.update.installed.descriptionFallback")
      showToast({
        id: "codeplane.update",
        title: language.t("toast.update.installed.title"),
        description,
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
      if (upgrading()) return
      setUpgrading(true)
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
            actions: [
              {
                label: language.t("toast.update.action.retry"),
                onClick: () => void startUpgrade(target),
              },
              {
                label: language.t("toast.update.action.dismiss"),
                onClick: "dismiss",
              },
            ],
          })
          return
        }
        if ("success" in data && data.success) {
          if (data.skipped) {
            showToast({
              id: "codeplane.update",
              title: language.t("toast.update.upToDate.title"),
              description: language.t("settings.general.row.version.descriptionUpToDate", { current: data.version }),
              variant: "success",
              icon: "check",
            })
            return
          }
          showInstalled(data.version, data.restart === true, data.restartRequired === true)
          await fetchStatus(true)
        }
      } catch (err) {
        showToast({
          id: "codeplane.update",
          title: language.t("toast.update.failed.title"),
          description: formatServerError(err, language.t),
          variant: "error",
          icon: "warning",
          actions: [
            {
              label: language.t("toast.update.action.retry"),
              onClick: () => void startUpgrade(target),
            },
            {
              label: language.t("toast.update.action.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
      } finally {
        setUpgrading(false)
      }
    }

    const recheck = async (notify = true) => {
      const next = await fetchStatus(true)
      if (notify && next?.hasUpdate && next.latest) showAvailable(next.latest)
      return next
    }

    const unsub = globalSDK.event.listen((e) => {
      const event = e.details
      if (event.type === "installation.update-available") {
        const version = event.properties?.version
        if (!version) return
        setStatus((prev) =>
          prev ? { ...prev, latest: version, hasUpdate: true } : { current: "", latest: version, hasUpdate: true, method: "unknown" },
        )
        showAvailable(version)
        return
      }

      if (event.type === "installation.updated") {
        const version = event.properties?.version
        if (version) announcedAvailable.delete(version)
        showInstalled(version)
        void fetchStatus(true)
      }
    })

    void fetchStatus(false)

    onCleanup(() => {
      unsub()
      if (reloadTimer) clearTimeout(reloadTimer)
    })

    return {
      startUpgrade,
      recheck,
      status,
      isUpgrading: upgrading,
    }
  },
})
