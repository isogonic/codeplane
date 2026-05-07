import { Component, Show, createMemo, createSignal, onMount, onCleanup } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import { createCodeplaneMobile } from "./platform/api"
import { MobileShell } from "./components/mobile-shell"
import { SetupScreen } from "./screens/setup"
import { InstanceHostScreen } from "./screens/instance-host"
import { LiveActivityPreview } from "./screens/live-activity-preview"

/**
 * Top-level mobile app.
 *
 * State machine is intentionally tiny: we either show the picker or
 * we show one open instance. Everything else (edit sheet, dialogs)
 * lives inside one of those two screens. Mobile users don't want
 * deep router stacks for this kind of shell — the desktop runs each
 * instance in a separate BrowserWindow, mobile gets one window with
 * a hard-back to the picker.
 */
type Route = { kind: "setup" } | { kind: "instance"; instance: SavedInstance }

export const App: Component = () => {
  const api = createCodeplaneMobile()
  const [route, setRoute] = createSignal<Route>({ kind: "setup" })

  onMount(() => {
    // Honour incoming deep links of the form
    //   codeplane://open?url=https%3A%2F%2Fserver.example
    // by jumping straight to the matching saved instance, or surfacing
    // the picker pre-filled if we don't have one yet.
    const offDeepLink = api.deepLinks.onOpen(async (url) => {
      const target = url.searchParams.get("url")
      if (!target) return
      const list = await api.instances.list()
      const match = list.find((i) => i.url === target)
      if (match) {
        await api.instances.setLastId(match.id)
        setRoute({ kind: "instance", instance: match })
      }
    })

    // Kick off the UI-cache watcher — same role as the desktop's
    // `ui-host` version watcher. It probes `/global/version` for every
    // saved instance on a 10-minute interval, persists the result in
    // Capacitor preferences, and emits to any picker subscribers so
    // the "Update available" badge updates without a re-mount.
    //
    // The asset-cache auto-crawl is wired separately inside
    // `createCodeplaneMobile()` via `assetCache.bindAutoCrawl(...)`,
    // which subscribes to *every* uiCache record change globally. That
    // way newly-added instances pick up auto-download without needing
    // App.tsx to re-wire per-instance subscriptions on every list
    // change — earlier we tracked subs in an array here, which only
    // covered instances that existed at picker mount.
    const stopWatcher = api.uiCache.startWatcher(
      async () =>
        (await api.instances.list()).map((instance) => ({ id: instance.id, url: instance.url })),
    )

    onCleanup(() => {
      offDeepLink()
      stopWatcher()
    })
  })

  const handleBack = () => {
    if (route().kind === "instance") {
      setRoute({ kind: "setup" })
      return true
    }
    return false
  }

  // Narrowed signal that yields the active instance (or null) for the
  // instance route — lets <Show keyed> hand it to its child callback.
  const activeInstance = createMemo(() => {
    const r = route()
    return r.kind === "instance" ? r.instance : null
  })

  // Dev-only: hash-routed preview of the iOS Live Activity layouts.
  // Reachable on http://localhost:5182/#la-preview — short-circuits
  // the picker so we can iterate on the SwiftUI duo design without
  // bouncing through Xcode every time.
  const [hash, setHash] = createSignal(typeof window === "undefined" ? "" : window.location.hash)
  if (typeof window !== "undefined") {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener("hashchange", onHashChange)
    onCleanup(() => window.removeEventListener("hashchange", onHashChange))
  }
  const isLivePreview = () => hash() === "#la-preview"

  return (
    <MobileShell api={api} onBack={handleBack}>
      <Show
        when={!isLivePreview()}
        fallback={
          <div class="mobile-scroll" style={{ flex: "1 1 auto" }}>
            <LiveActivityPreview />
          </div>
        }
      >
        <Show
          when={activeInstance()}
          keyed
          fallback={
            <SetupScreen
              api={api}
              onOpenInstance={(instance) => setRoute({ kind: "instance", instance })}
            />
          }
        >
          {(instance) => (
            <InstanceHostScreen
              api={api}
              instance={instance}
              onBack={() => setRoute({ kind: "setup" })}
            />
          )}
        </Show>
      </Show>
    </MobileShell>
  )
}
