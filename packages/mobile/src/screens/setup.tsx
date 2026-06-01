import { Component, Show, createMemo, createResource, createSignal } from "solid-js"
import type { SavedInstance } from "@codeplane-ai/shared/instance"
import type { CodeplaneMobileAPI } from "../platform/api"
import { MobileHeader, PlusIcon, SettingsIcon } from "../components/mobile-header"
import { InstanceList } from "../components/instance-list"
import { BottomSheet } from "../components/bottom-sheet"
import { InstanceForm } from "../components/instance-form"
import { demoLiveActivity } from "../platform/live-activities"

/**
 * The mobile picker — equivalent of the desktop `setup/app.tsx`.
 *
 * Layout:
 *
 *   ┌───────────── header (44pt) ─────────────┐
 *   │   Codeplane                          +  │
 *   ├──────────────────────────────────────────┤
 *   │  ┌─────────────────────────────────────┐ │
 *   │  │ ◐ Production         AUTH  last     │ │
 *   │  │   prod.codeplane.example.com        │ │
 *   │  └─────────────────────────────────────┘ │
 *   │  …                                       │
 *   ├──────────────────────────────────────────┤
 *   │              (safe-area-bottom)          │
 *   └──────────────────────────────────────────┘
 *
 * Tap a row → opens the instance host. Long-press → bottom sheet
 * with the edit form. The "+" in the header opens the same sheet
 * with an empty draft.
 *
 * The empty state replaces the previous text-only "tap the +" with a
 * real CTA card so the path forward is unmissable on first launch.
 */
export type SheetState =
  | { kind: "closed" }
  | { kind: "create" }
  | {
      kind: "edit"
      instance: SavedInstance
      plaintextHeaders: Record<string, string>
      liveActivitiesEnabled: boolean
    }

export const SetupScreen: Component<{
  api: CodeplaneMobileAPI
  sheet: SheetState
  setSheet: (s: SheetState) => void
  onOpenInstance: (instance: SavedInstance) => void
  onOpenSettings: () => void
}> = (props) => {
  const [refreshKey, setRefreshKey] = createSignal(0)
  const [scrolled, setScrolled] = createSignal(false)
  /**
   * Hidden Live Activity demo trigger. Tapping the "Codeplane" title
   * in the header 5 times in quick succession (≤ 1.5 s between taps)
   * fires `demoLiveActivity()` — a real ActivityKit-backed activity
   * that ticks progress for 30 s and then ends with a "Completed"
   * terminal frame. Useful for verifying the widget extension is
   * wired correctly without needing a Codeplane server emitting
   * `codeplane:task` events. The same iOS Settings → Codeplane →
   * Live Activities toggle still gates the OS-level permission.
   */
  const [titleTaps, setTitleTaps] = createSignal<number[]>([])
  const [demoStatus, setDemoStatus] = createSignal<string | null>(null)
  const onTitleTap = () => {
    const now = Date.now()
    const recent = [...titleTaps(), now].filter((t) => now - t <= 1500)
    setTitleTaps(recent)
    if (recent.length >= 5) {
      setTitleTaps([])
      void runDemoActivity()
    }
  }
  const runDemoActivity = async () => {
    setDemoStatus("Starting demo activity…")
    props.api.haptics.impactMedium().catch(() => {})
    try {
      const id = await demoLiveActivity(props.api.liveActivities, {
        instanceLabel: "Codeplane Demo",
        instanceHost: "demo.codeplane.example.com",
        durationSeconds: 30,
        title: "Refactoring authentication middleware…",
      })
      if (id) {
        setDemoStatus("Live Activity started — lock the simulator (⌘L) to view it.")
        setTimeout(() => setDemoStatus(null), 6_000)
      } else {
        setDemoStatus("Live Activities aren't available on this device (need iOS 16.2+).")
        setTimeout(() => setDemoStatus(null), 6_000)
      }
    } catch (err) {
      setDemoStatus(`Demo failed: ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setDemoStatus(null), 8_000)
    }
  }

  // Narrow the sheet signal to "the editing variant or null" so <Show keyed>
  // can hand the full edit payload to its child without re-narrowing inside.
  const editingSheet = createMemo(() => {
    const s = props.sheet
    return s.kind === "edit" ? s : null
  })

  const [instances] = createResource(
    () => refreshKey(),
    async () => {
      const list = await props.api.instances.list()
      return list
    },
  )
  const [lastId] = createResource(
    () => refreshKey(),
    async () => (await props.api.instances.getLastId()) ?? undefined,
  )

  // Probed once per session — drives whether the form shows the
  // toggle row at all. We treat "supported but disabled in Settings"
  // and "not supported" as the same state for the form, since the
  // user's choice is the same: they can't get a Live Activity right
  // now. The toggle still saves the preference so a future install
  // / re-enable picks it up automatically.
  const [liveActivitiesSupportedRes] = createResource(async () => {
    const r = await props.api.liveActivities.isSupported()
    return r.supported && r.enabled
  })
  const liveActivitiesSupported = () => liveActivitiesSupportedRes() ?? false

  const openCreate = () => {
    props.api.haptics.selection().catch(() => {})
    props.setSheet({ kind: "create" })
  }

  const openEdit = async (instance: SavedInstance) => {
    props.api.haptics.impactLight().catch(() => {})
    const [plaintext, liveActivitiesEnabled] = await Promise.all([
      props.api.instances.secrets.get(instance.id),
      props.api.instances.prefs.getLiveActivitiesEnabled(instance.id),
    ])
    props.setSheet({ kind: "edit", instance, plaintextHeaders: plaintext, liveActivitiesEnabled })
  }

  const closeSheet = () => props.setSheet({ kind: "closed" })

  const handleSave = async (
    instance: SavedInstance,
    plaintextHeaders: Record<string, string>,
    prefs: { liveActivitiesEnabled: boolean },
  ) => {
    // The picker passes plaintext headers separately so the secure
    // store can take over without ever persisting them in plain.
    const stripped: SavedInstance = {
      ...instance,
      headers: Object.keys(plaintextHeaders).length ? { __secure: "1" } : undefined,
    }
    await props.api.instances.save({ ...stripped, headers: plaintextHeaders })
    await props.api.instances.prefs.setLiveActivitiesEnabled(instance.id, prefs.liveActivitiesEnabled)
    closeSheet()
    setRefreshKey((k) => k + 1)
  }

  const handleDelete = async (id: string) => {
    await props.api.instances.remove(id)
    closeSheet()
    setRefreshKey((k) => k + 1)
  }

  const handleOpen = (instance: SavedInstance) => {
    // CRITICAL: we used to `await setLastId(...)` here, which made
    // every tap on a card wait ~30ms on a Capacitor Preferences write
    // before the route could even change. The "remember last opened"
    // behaviour only matters on the NEXT launch, so it never needs
    // to block the current open — fire-and-forget instead.
    void props.api.instances.setLastId(instance.id)
    props.api.haptics.impactMedium().catch(() => {})
    // Tell the UI cache the user is opening whatever the server is
    // currently serving — flips the entry's state from `stale` back
    // to `fresh`, dismissing the "Update available" badge until the
    // next watcher tick. Best-effort: we may not know the version
    // yet (`unknown` state) on a first launch, in which case we
    // skip and let the watcher sort it out.
    void props.api.uiCache.get(instance.id).then((entry) => {
      if (entry?.remoteVersion) {
        return props.api.uiCache.markOpened(instance.id, entry.remoteVersion)
      }
      // Even if we don't have a version yet, kick off a probe so the
      // next time this card paints we know whether to show the badge.
      return props.api.uiCache.check(instance.id, instance.url)
    })
    // Route change is synchronous from here on. The webview-host's
    // createEffect fires during the same microtask block, so the
    // native InAppBrowser.openWebView call is queued before any of
    // the fire-and-forget I/O above can resolve.
    props.onOpenInstance(instance)
  }

  return (
    <div class="flex flex-col h-full w-full" style={{ "min-height": 0 }}>
      <MobileHeader
        title="Codeplane"
        elevated={scrolled()}
        onTitlePress={onTitleTap}
        leading={
          <button
            type="button"
            class="mobile-icon-button"
            aria-label="Settings"
            onClick={() => {
              props.api.haptics.selection().catch(() => {})
              props.onOpenSettings()
            }}
          >
            <SettingsIcon />
          </button>
        }
        trailing={
          <button
            type="button"
            class="mobile-icon-button"
            aria-label="Add server"
            onClick={openCreate}
          >
            <PlusIcon />
          </button>
        }
      />

      <Show when={demoStatus()}>
        <div
          role="status"
          class="mobile-alert"
          style={{
            margin: "8px 16px 0",
            "background-color": "var(--surface-strong)",
            color: "var(--text-strong)",
            border: "1px solid var(--border-weak-base)",
          }}
        >
          {demoStatus()}
        </div>
      </Show>

      <div
        class="mobile-scroll pb-safe"
        style={{ flex: "1 1 auto" }}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}
      >
        <Show when={!instances.loading} fallback={<LoadingPlaceholder />}>
          <Show
            when={(instances() ?? []).length > 0}
            fallback={<EmptyState onAdd={openCreate} />}
          >
            <InstanceList
              instances={instances() ?? []}
              lastId={lastId() ?? undefined}
              uiCache={props.api.uiCache}
              assetCache={props.api.assetCache}
              onOpen={handleOpen}
              onEdit={openEdit}
            />
          </Show>
        </Show>
      </div>

      <BottomSheet
        open={props.sheet.kind !== "closed"}
        title={props.sheet.kind === "edit" ? "Edit server" : "Add server"}
        onDismiss={closeSheet}
      >
        <Show when={props.sheet.kind === "create"}>
          <InstanceForm
            authStatus={props.api.instances.authStatus}
            verifyOtp={props.api.instances.verifyOtp}
            onSubmit={handleSave}
            onCancel={closeSheet}
            liveActivitiesEnabled={true}
            liveActivitiesSupported={liveActivitiesSupported()}
          />
        </Show>
        <Show when={editingSheet()} keyed>
          {(s) => (
            <InstanceForm
              instance={s.instance}
              plaintextHeaders={s.plaintextHeaders}
              liveActivitiesEnabled={s.liveActivitiesEnabled}
              liveActivitiesSupported={liveActivitiesSupported()}
              authStatus={props.api.instances.authStatus}
              verifyOtp={props.api.instances.verifyOtp}
              onSubmit={handleSave}
              onCancel={closeSheet}
              onDelete={handleDelete}
            />
          )}
        </Show>
      </BottomSheet>
    </div>
  )
}

const EmptyState: Component<{ onAdd: () => void }> = (props) => (
  <div class="mobile-empty">
    {/* Icon block removed — the headline + body + primary CTA are
        already enough on a small screen, and the brand-tinted square
        was crowding the top of the empty state. */}
    <h2 class="mobile-empty__title">Connect your first server</h2>
    <p class="mobile-empty__body">
      Codeplane Mobile opens any Codeplane server you own, with the same UI as the desktop. Add a server URL
      to get started.
    </p>
    <button
      type="button"
      class="mobile-button mobile-button--primary"
      style={{ "min-width": "200px", "margin-top": "8px" }}
      onClick={props.onAdd}
    >
      Add a server
    </button>
  </div>
)

const LoadingPlaceholder: Component = () => (
  <div
    style={{
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      gap: "12px",
      padding: "64px 16px",
      color: "var(--text-weak)",
      "font-size": "13px",
    }}
  >
    <span class="mobile-spinner" aria-hidden />
    <span>Loading instances…</span>
  </div>
)
