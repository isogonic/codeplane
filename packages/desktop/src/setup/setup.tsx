/* @refresh reload */
import { ErrorBoundary } from "solid-js"
import { render } from "solid-js/web"
import { CodeplaneVersion } from "@codeplane-ai/shared/version"
import "./index.css"

// Forward window-level renderer errors to the desktop log so they show up
// in `<codeplaneHome>/log/desktop/desktop.log` next to main-process events.
// `console-message` already pipes console.error to the log via the main
// process's webContents listener, but uncaught errors and unhandled
// promise rejections only surface as the browser's default "Uncaught …"
// noise — without these listeners they'd be lost the moment the window
// is closed. Installed as early as possible (before app.tsx loads) so
// initial-render crashes are captured.
function serializeRendererError(err: unknown) {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  if (err === undefined) return { message: "" }
  if (err === null) return { message: "null" }
  try {
    return { message: typeof err === "string" ? err : JSON.stringify(err) }
  } catch {
    return { message: String(err) }
  }
}
function rendererDebugLog(event: string, data: unknown) {
  // `codeplaneDesktop` is exposed by the preload in packaged Electron and
  // by the dev stub below in the browser; either way `debug.log` is a
  // best-effort fire-and-forget IPC.
  const desktop = (window as unknown as { codeplaneDesktop?: { debug?: { log?: (e: string, d: unknown, scope?: string) => void } } }).codeplaneDesktop
  desktop?.debug?.log?.(event, data, "setup")
}
window.addEventListener("error", (event) => {
  rendererDebugLog("renderer.error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: serializeRendererError(event.error),
  })
})
window.addEventListener("unhandledrejection", (event) => {
  rendererDebugLog("renderer.unhandledrejection", {
    reason: serializeRendererError(event.reason),
  })
})

// Browser dev (vite) has no Electron preload — stub the API so renders work.
// In packaged Electron, `window.codeplaneDesktop` is already set; this is a no-op.
if (!(window as any).codeplaneDesktop) {
  const noop = () => () => {}
  const params = new URLSearchParams(window.location.search)
  if (params.get("seed") === "1") {
    localStorage.setItem(
      "codeplane:dev:instances",
      JSON.stringify([
        { id: "remote-team", url: "https://codeplane.example.com", label: "Team Production" },
        { id: "remote-staging", url: "https://staging.codeplane.example.com", label: "Internal Staging" },
        { id: "local-dev", url: "local://local-dev", label: "Local Dev", local: { binaryVersion: CodeplaneVersion } },
      ]),
    )
  } else if (params.get("seed") === "0") {
    localStorage.removeItem("codeplane:dev:instances")
  }
  const list: any[] = JSON.parse(localStorage.getItem("codeplane:dev:instances") || "[]")
  const save = () => localStorage.setItem("codeplane:dev:instances", JSON.stringify(list))
  const storageKey = (storageName: string | undefined, key: string) =>
    `codeplane:dev:storage:${storageName ?? "default"}:${key}`
  ;(window as any).codeplaneDesktop = {
    version: "dev",
    debug: { log: (event: string, data: unknown, scope: string) => console.debug(`[${scope}] ${event}`, data) },
    storage: {
      getItem: (storageName: string | undefined, key: string) => localStorage.getItem(storageKey(storageName, key)),
      setItem: (storageName: string | undefined, key: string, value: string) => {
        localStorage.setItem(storageKey(storageName, key), value)
      },
      removeItem: (storageName: string | undefined, key: string) => {
        localStorage.removeItem(storageKey(storageName, key))
      },
    },
    instances: {
      list: async () => list.slice(),
      save: async (i: any) => {
        const idx = list.findIndex((e) => e.id === i.id)
        if (idx === -1) list.push(i)
        else list[idx] = i
        save()
        return list.slice()
      },
      remove: async (id: string) => {
        const idx = list.findIndex((e) => e.id === id)
        if (idx >= 0) list.splice(idx, 1)
        save()
        return list.slice()
      },
      open: async () => true,
      probe: async () => ({ ok: true, version: "dev" }),
      prepare: async () => ({ ok: true, version: "dev", url: "about:blank" }),
      onPrepareProgress: noop,
      onOpenProgress: noop,
      showSetup: async () => true,
      getDefaultKey: async () => null,
      setDefaultKey: async () => true,
      getLast: async () => undefined,
    },
    local: {
      target: async () => ({
        archiveName: "codeplane-darwin-arm64.tgz",
        archiveExt: ".tgz",
        binaryName: "codeplane",
        os: "darwin",
        arch: "arm64",
        packageName: "codeplane-darwin-arm64",
        defaultVersion: "dev",
      }),
      listVersions: async () => ({
        ok: true,
        latest: CodeplaneVersion,
        distTags: { latest: CodeplaneVersion },
        versions: [CodeplaneVersion, "27.4.10", "27.4.8", "27.4.0"],
      }),
      status: async () => ({ installed: false }),
      install: async () => ({ ok: true }),
      onInstallProgress: noop,
    },
    desktopUpdater: {
      status: async () => ({ current: "dev", latest: "dev", hasUpdate: false }),
      check: async () => ({ ok: true, updateAvailable: false }),
      download: async () => ({ ok: true }),
      install: async () => ({ ok: true }),
      releaseNotes: async () => null,
      onUpdateAvailable: noop,
      onUpdateNotAvailable: noop,
      onProgress: noop,
      onUpdateDownloaded: noop,
      onError: noop,
      onRequiresManualDownload: noop,
    },
    updater: { check: async () => ({ ok: true, updateAvailable: false }) },
    auth: { openExternal: async () => true },
    notifications: {
      isSupported: async () => true,
      notify: async (input: { title: string; description?: string; href?: string }) => {
        console.debug("[desktop-notification]", input)
        return true
      },
      onClick: noop,
    },
  }
}

const { App } = await import("./app")

// Tag <html> with the host platform so the setup window can match the
// macOS-native styling (vibrancy-aware bg, native scrollbars) configured
// in index.css. Mirrors what the in-instance entry does.
const desktopPlatform = (window as any).codeplaneDesktop?.platform as string | undefined
const desktopOs = desktopPlatform === "darwin"
  ? "macos"
  : desktopPlatform === "win32"
    ? "windows"
    : desktopPlatform === "linux"
      ? "linux"
      : undefined
if (desktopOs) {
  document.documentElement.dataset.os = desktopOs
  document.documentElement.dataset.desktop = "true"
}

const root = document.getElementById("root")
if (root) {
  render(
    () => (
      <ErrorBoundary
        fallback={(err) => {
          // Side-effect inside the JSX factory: Solid runs this once per
          // captured error (the boundary memoizes on the err value), so
          // it logs each crash exactly once. Rendering is unchanged —
          // same red `<pre>` as before.
          rendererDebugLog("renderer.error-boundary", serializeRendererError(err))
          return (
            <pre style="white-space:pre-wrap;color:#b00;padding:20px;font:12px monospace;background:#fff5f5">
              {String(err)}
              {"\n\n"}
              {err instanceof Error ? err.stack : ""}
            </pre>
          )
        }}
      >
        <App />
      </ErrorBoundary>
    ),
    root,
  )
}
