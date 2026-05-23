import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "@codeplane-ai/ui/context"
import { showToast } from "@codeplane-ai/ui/toast"
import { useDialog } from "@codeplane-ai/ui/context/dialog"
import { useGlobalSDK } from "./global-sdk"
import { useLanguage } from "./language"
import { type PlatformReleaseNotes, type PlatformUpdateStatus } from "./platform"
import { formatServerError } from "@/utils/server-errors"
import { DialogWhatsNew } from "@/components/dialog-whats-new"
import { normalizeUpdateStatus } from "./update-version"

export type ReleaseNotes = PlatformReleaseNotes

const LAST_SEEN_KEY = "codeplane:last-seen-version"

type DesktopUpdaterBridge = {
  status: () => Promise<{ current: string; latest: string | null; hasUpdate: boolean; method: string }>
  check: () => Promise<{ ok: true; updateAvailable: boolean; version?: string } | { ok: false; error: string }>
  download: () => Promise<{ ok: true; mocked?: boolean } | { ok: false; error: string }>
  install?: () => Promise<{ ok: true; mocked?: boolean }>
  onUpdateAvailable: (cb: (info: { version: string }) => void) => () => void
  onUpdateNotAvailable: (cb: (info: { version: string } | undefined) => void) => () => void
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => () => void
  onProgress: (cb: (info: { percent: number; transferred: number; total: number }) => void) => () => void
  onError: (cb: (message: string) => void) => () => void
  onRequiresManualDownload: (cb: (info: { version: string | null; url: string; reason: string }) => void) => () => void
}
type DesktopStorageWindow = Window & {
  codeplaneDesktop?: {
    storage?: {
      getItem: (storageName: string | undefined, key: string) => string | null
      setItem: (storageName: string | undefined, key: string, value: string) => void
    }
    desktopUpdater?: DesktopUpdaterBridge
    auth?: {
      openExternal: (url: string) => Promise<boolean>
    }
  }
}

function getDesktopUpdater(): DesktopUpdaterBridge | undefined {
  if (typeof window === "undefined") return undefined
  return (window as DesktopStorageWindow).codeplaneDesktop?.desktopUpdater
}

function openExternal(url: string) {
  try {
    if (typeof window === "undefined") return
    const opener = (window as DesktopStorageWindow).codeplaneDesktop?.auth?.openExternal
    if (opener) {
      void opener(url)
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  } catch {
    // ignore — best-effort UX, the toast description still names the version
  }
}

function readLastSeen(): string | null {
  try {
    if (typeof window === "undefined") return null
    const storage = (window as DesktopStorageWindow).codeplaneDesktop?.storage
    return storage
      ? storage.getItem(undefined, LAST_SEEN_KEY)
      : window.localStorage.getItem(LAST_SEEN_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(version: string) {
  try {
    if (typeof window === "undefined") return
    const storage = (window as DesktopStorageWindow).codeplaneDesktop?.storage
    if (storage) {
      storage.setItem(undefined, LAST_SEEN_KEY, version)
      return
    }
    window.localStorage.setItem(LAST_SEEN_KEY, version)
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
    const [status, setStatus] = createSignal<PlatformUpdateStatus | undefined>(undefined)
    let reloadTimer: ReturnType<typeof setTimeout> | undefined
    // When the user is running inside the Electron shell the same preload
    // that exposes storage also exposes the desktop's electron-updater
    // bridge. We mirror its status into the in-instance settings so the
    // "Update now" / "Check for updates" buttons drive a real install
    // instead of pointing the user back at the selector page.
    const desktopUpdater = getDesktopUpdater()

    // Release notes always come from the *connected server*. When the user
    // is in an instance — desktop or web — "What's new" describes the
    // server they are connected to. Desktop-shell release notes live on
    // the selector page and are wired separately.
    const fetchReleaseNotes = async (version: string): Promise<PlatformReleaseNotes | null> => {
      try {
        const response = await fetch(
          `${globalSDK.url}/global/release-notes/${encodeURIComponent(version.replace(/^v/, ""))}`,
        )
        if (!response.ok) return null
        return (await response.json()) as PlatformReleaseNotes
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

    // We used to auto-open the "What's new" dialog the first time the user
    // ran a newer release. People found it intrusive, so now we silently
    // bookmark the version they're on and only surface release notes when
    // they explicitly click the toast action or the Settings → Updates
    // "What's new" button. That marker still avoids showing the dialog for
    // versions older than the one already running.
    const checkPostUpdate = (current: string | undefined) => {
      if (!current || !isReleaseVersion(current)) return
      const previous = readLastSeen()
      if (previous !== current) writeLastSeen(current)
    }

    // Reflects the *connected server's* version. When that server runs as
    // a desktop-managed local instance the server-side /global/upgrade
    // route refuses to do anything (electron-updater owns the lifecycle),
    // so we layer the desktop shell's update status on top of the
    // server's response. `current` still comes from the server, but
    // `latest` / `hasUpdate` come from electron-updater — which is the
    // only source that can decide whether a new desktop release exists.
    const fetchStatus = async (refresh = false) => {
      try {
        const url = `${globalSDK.url}/global/version${refresh ? "?refresh=1" : ""}`
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Status ${response.status}`)
        const next = normalizeUpdateStatus((await response.json()) as PlatformUpdateStatus)
        const merged = desktopUpdater && next.method === "desktop" ? await mergeDesktopStatus(next) : next
        setStatus(merged)
        checkPostUpdate(merged.current)
        return merged
      } catch {
        return undefined
      }
    }

    const mergeDesktopStatus = async (next: PlatformUpdateStatus): Promise<PlatformUpdateStatus> => {
      if (!desktopUpdater) return next
      try {
        const shell = normalizeUpdateStatus(await desktopUpdater.status())
        return {
          ...next,
          latest: shell.latest ?? next.latest,
          hasUpdate: shell.hasUpdate,
        }
      } catch {
        return next
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

    // Upgrades the *connected server*. Goes through the SDK for normal
    // installs, but routes through the desktop bridge when the server
    // reports method=desktop — the SDK path would short-circuit with an
    // error because electron-updater owns the lifecycle in that case.
    const startUpgrade = async (target?: string) => {
      if (upgrading()) return
      if (desktopUpdater && status()?.method === "desktop") {
        await startDesktopUpgrade()
        return
      }
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

    // Drives a desktop-shell update via the electron-updater bridge. We
    // own the "upgrading" signal for the duration of the download — the
    // bridge's onUpdateDownloaded / onError / onRequiresManualDownload
    // events clear it. The shell auto-restarts ~1.5s after the download
    // completes; until then we keep the loading toast pinned.
    const startDesktopUpgrade = async () => {
      if (!desktopUpdater) return
      setUpgrading(true)
      showToast({
        id: "codeplane.update",
        title: language.t("toast.update.installing.title"),
        description: language.t("toast.update.installing.description"),
        variant: "loading",
        persistent: true,
      })
      try {
        const result = await desktopUpdater.download()
        if (!result.ok) {
          showToast({
            id: "codeplane.update",
            title: language.t("toast.update.failed.title"),
            description: result.error || language.t("toast.update.failed.description"),
            variant: "error",
            icon: "warning",
            actions: [
              {
                label: language.t("toast.update.action.retry"),
                onClick: () => void startDesktopUpgrade(),
              },
              {
                label: language.t("toast.update.action.dismiss"),
                onClick: "dismiss",
              },
            ],
          })
          setUpgrading(false)
        }
        // On success we wait for onUpdateDownloaded / onError to settle
        // the loading state — the shell relaunches once the download
        // finishes, so we never reach a "downloaded but not installed"
        // resting state.
      } catch (err) {
        showToast({
          id: "codeplane.update",
          title: language.t("toast.update.failed.title"),
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
          icon: "warning",
          actions: [
            {
              label: language.t("toast.update.action.retry"),
              onClick: () => void startDesktopUpgrade(),
            },
            {
              label: language.t("toast.update.action.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        setUpgrading(false)
      }
    }

    const recheck = async (notify = true) => {
      const next = await fetchStatus(true)
      if (notify && next?.hasUpdate && next.latest) showAvailable(next.latest)
      return next
    }

    // Subscribes to the connected server's update lifecycle. Desktop-shell
    // events are attached separately below when the Electron bridge exists.
    const unsub = globalSDK.event.listen((e) => {
      const event = e.details
      if (event.type === "installation.update-available") {
        const version = event.properties?.version
        if (!version) return
        let shouldAnnounce = false
        setStatus((prev) => {
          const next = normalizeUpdateStatus(
            prev
              ? { ...prev, latest: version, hasUpdate: true }
              : { current: "", latest: version, hasUpdate: true, method: "unknown" },
          )
          shouldAnnounce = next.hasUpdate
          return next
        })
        if (shouldAnnounce) showAvailable(version)
        return
      }

      if (event.type === "installation.updated") {
        const version = event.properties?.version
        if (version) announcedAvailable.delete(version)
        showInstalled(version)
        void fetchStatus(true)
      }
    })

    // Desktop-shell update lifecycle. Only attaches inside the Electron
    // shell where electron-updater is running; otherwise these are
    // no-ops because `desktopUpdater` is undefined.
    const desktopUnsubs: Array<() => void> = []
    if (desktopUpdater) {
      desktopUnsubs.push(
        desktopUpdater.onUpdateAvailable((info) => {
          if (!info.version) return
          let shouldAnnounce = false
          setStatus((prev) => {
            const next = normalizeUpdateStatus(
              prev
                ? { ...prev, latest: info.version, hasUpdate: true }
                : { current: "", latest: info.version, hasUpdate: true, method: "desktop" },
            )
            shouldAnnounce = next.hasUpdate
            return next
          })
          if (shouldAnnounce) showAvailable(info.version)
        }),
        desktopUpdater.onUpdateNotAvailable((info) => {
          setStatus((prev) =>
            prev ? normalizeUpdateStatus({ ...prev, latest: info?.version ?? prev.latest, hasUpdate: false }) : prev,
          )
        }),
        desktopUpdater.onUpdateDownloaded((info) => {
          if (info.version) announcedAvailable.delete(info.version)
          // The shell quits and installs ~1.5s after this fires, so we
          // surface a restart-style toast with no manual restart action.
          showInstalled(info.version, true, false)
          setUpgrading(false)
        }),
        desktopUpdater.onError((message) => {
          if (!upgrading()) return
          showToast({
            id: "codeplane.update",
            title: language.t("toast.update.failed.title"),
            description: message || language.t("toast.update.failed.description"),
            variant: "error",
            icon: "warning",
            actions: [
              {
                label: language.t("toast.update.action.retry"),
                onClick: () => void startDesktopUpgrade(),
              },
              {
                label: language.t("toast.update.action.dismiss"),
                onClick: "dismiss",
              },
            ],
          })
          setUpgrading(false)
        }),
        desktopUpdater.onRequiresManualDownload((info) => {
          // Unsigned macOS builds can't self-update through electron-updater
          // — fall back to "open the GitHub release in a browser" so the
          // user can grab the installer manually.
          showToast({
            id: "codeplane.update",
            title: language.t("toast.update.failed.title"),
            description: info.reason || language.t("toast.update.failed.description"),
            variant: "error",
            icon: "warning",
            actions: [
              {
                label: language.t("toast.update.action.updateNow"),
                onClick: () => openExternal(info.url),
              },
              {
                label: language.t("toast.update.action.dismiss"),
                onClick: "dismiss",
              },
            ],
          })
          setUpgrading(false)
        }),
      )
    }

    void fetchStatus(false)

    onCleanup(() => {
      unsub()
      for (const off of desktopUnsubs) off()
      if (reloadTimer) clearTimeout(reloadTimer)
    })

    return {
      startUpgrade,
      recheck,
      status,
      isUpgrading: upgrading,
      hasDesktopBridge: () => !!desktopUpdater,
      openWhatsNew: (version?: string) => {
        const v = version ?? status()?.current
        if (!v) return
        whatsNewShown.delete(v)
        void showWhatsNew(v)
      },
    }
  },
})
