import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import { showToast } from "@codeplane-ai/ui/toast"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { useGlobalSDK } from "./global-sdk"
import { useLanguage } from "./language"
import { formatServerError } from "@/utils/server-errors"
import { DialogWhatsNew } from "@/components/dialog-whats-new"

type Status = {
  current: string
  latest: string | null
  hasUpdate: boolean
  method: string
}

export type ReleaseNotes = {
  tag: string
  name: string | null
  body: string | null
  url: string | null
  publishedAt: string | null
}

const LAST_SEEN_KEY = "codeplane:last-seen-version"

function readLastSeen(): string | null {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(LAST_SEEN_KEY) : null
  } catch {
    return null
  }
}

function writeLastSeen(version: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_SEEN_KEY, version)
  } catch {
    // localStorage can throw in private/quota contexts; just skip persistence
  }
}

function isReleaseVersion(value: string | undefined | null) {
  if (!value) return false
  if (value === "local" || value === "dev") return false
  return /^\d+\.\d+\.\d+/.test(value)
}

function isNewer(current: string, previous: string | null) {
  if (!previous) return false
  if (current === previous) return false
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n))
  const a = parse(current)
  const b = parse(previous)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export const { use: useUpdates, provider: UpdatesProvider } = createSimpleContext({
  name: "Updates",
  init: () => {
    const globalSDK = useGlobalSDK()
    const language = useLanguage()
    const dialog = useDialog()
    const announcedAvailable = new Set<string>()
    const announcedInstalled = new Set<string>()
    const whatsNewShown = new Set<string>()
    const [upgrading, setUpgrading] = createSignal(false)
    const [status, setStatus] = createSignal<Status | undefined>(undefined)
    let reloadTimer: ReturnType<typeof setTimeout> | undefined

    const fetchReleaseNotes = async (version: string): Promise<ReleaseNotes | null> => {
      try {
        const response = await fetch(
          `${globalSDK.url}/global/release-notes/${encodeURIComponent(version.replace(/^v/, ""))}`,
        )
        if (!response.ok) return null
        return (await response.json()) as ReleaseNotes
      } catch {
        return null
      }
    }

    const showWhatsNew = async (current: string, previous?: string) => {
      if (!isReleaseVersion(current)) return
      if (whatsNewShown.has(current)) return
      whatsNewShown.add(current)
      const notes = await fetchReleaseNotes(current)
      if (!notes) return
      dialog.show(() => DialogWhatsNew({ notes, previousVersion: previous }))
    }

    const checkPostUpdate = (current: string | undefined) => {
      if (!current || !isReleaseVersion(current)) return
      const previous = readLastSeen()
      if (previous === current) return
      writeLastSeen(current)
      if (isNewer(current, previous)) {
        void showWhatsNew(current, previous ?? undefined)
      }
    }

    const fetchStatus = async (refresh = false) => {
      try {
        const url = `${globalSDK.url}/global/version${refresh ? "?refresh=1" : ""}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const next = (await response.json()) as Status
        setStatus(next)
        checkPostUpdate(next.current)
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
      const baseActions: { label: string; onClick: (() => void) | "dismiss" }[] = []
      if (!restart) {
        baseActions.push({
          label: language.t("toast.update.action.restart"),
          onClick: () => window.location.reload(),
        })
      }
      if (version && isReleaseVersion(version)) {
        baseActions.push({
          label: language.t("toast.update.action.whatsNew"),
          onClick: () => void showWhatsNew(version, status()?.current),
        })
      }
      baseActions.push({
        label: language.t("toast.update.action.dismiss"),
        onClick: "dismiss",
      })
      showToast({
        id: "codeplane.update",
        title: language.t("toast.update.installed.title"),
        description,
        variant: "success",
        icon: "check",
        persistent: !restart,
        actions: restart ? undefined : baseActions,
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
      openWhatsNew: (version?: string) => {
        const v = version ?? status()?.current
        if (!v) return
        whatsNewShown.delete(v)
        void showWhatsNew(v)
      },
    }
  },
})
