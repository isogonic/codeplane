/* @refresh reload */
import { ErrorBoundary } from "solid-js"
import { render } from "solid-js/web"
import "./index.css"

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
        { id: "local-dev", url: "local://local-dev", label: "Local Dev", local: { binaryVersion: "27.1.1" } },
      ]),
    )
  } else if (params.get("seed") === "0") {
    localStorage.removeItem("codeplane:dev:instances")
  }
  const list: any[] = JSON.parse(localStorage.getItem("codeplane:dev:instances") || "[]")
  const save = () => localStorage.setItem("codeplane:dev:instances", JSON.stringify(list))
  ;(window as any).codeplaneDesktop = {
    version: "dev",
    debug: { log: (event: string, data: unknown, scope: string) => console.debug(`[${scope}] ${event}`, data) },
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
      target: async () => ({ archiveName: "x", binaryName: "x", os: "darwin", arch: "arm64", defaultVersion: "dev" }),
      status: async () => ({ installed: false }),
      install: async () => ({ ok: true }),
      onInstallProgress: noop,
    },
    desktopUpdater: {
      status: async () => ({ current: "dev", latest: "dev", hasUpdate: false }),
      check: async () => ({ ok: true, updateAvailable: false }),
      download: async () => ({ ok: true }),
      install: async () => undefined,
      releaseNotes: async () => null,
      onUpdateAvailable: noop,
      onUpdateNotAvailable: noop,
      onProgress: noop,
      onUpdateDownloaded: noop,
      onError: noop,
    },
    updater: { check: async () => ({ ok: true, updateAvailable: false }) },
    auth: { openExternal: async () => true },
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
        fallback={(err) => (
          <pre style="white-space:pre-wrap;color:#b00;padding:20px;font:12px monospace;background:#fff5f5">
            {String(err)}
            {"\n\n"}
            {err instanceof Error ? err.stack : ""}
          </pre>
        )}
      >
        <App />
      </ErrorBoundary>
    ),
    root,
  )
}
