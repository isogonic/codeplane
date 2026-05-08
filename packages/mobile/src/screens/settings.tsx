import { Component, Show, createResource, createSignal, onCleanup, onMount } from "solid-js"
import type {
  CodeplaneMobileAPI,
  MobileAppInfo,
  MobileDeviceInfo,
  MobilePermissionState,
} from "../platform/api"
import { MobileHeader } from "../components/mobile-header"

/**
 * App-level settings — opened from the picker's leading header slot.
 *
 * Layout follows iOS Settings → Codeplane:
 *
 *   ┌──────── header (44pt) ────────┐
 *   │ ‹ Back     Settings           │
 *   ├───────────────────────────────┤
 *   │ PERMISSIONS                   │
 *   │ ┌───────────────────────────┐ │
 *   │ │ Notifications      Allow  │ │
 *   │ │ Live Activities  Enabled  │ │
 *   │ └───────────────────────────┘ │
 *   │  iOS controls these — open    │
 *   │  Settings → Codeplane to      │
 *   │  change a denied permission.  │
 *   │                               │
 *   │ ABOUT                         │
 *   │ ┌───────────────────────────┐ │
 *   │ │ Version            28.0.13│ │
 *   │ │ Build                   28│ │
 *   │ │ Bundle ID  ai.codeplane.…│ │
 *   │ └───────────────────────────┘ │
 *   │                               │
 *   │ DEVICE                        │
 *   │ ┌───────────────────────────┐ │
 *   │ │ Platform              iOS │ │
 *   │ │ OS Version           17.4 │ │
 *   │ │ Model            iPhone15 │ │
 *   │ │ Manufacturer        Apple │ │
 *   │ └───────────────────────────┘ │
 *   └───────────────────────────────┘
 *
 * The screen is intentionally read-only-by-default; the only mutating
 * actions are the per-permission "Request" / "Open Settings" buttons.
 * iOS gates the actual permission state, so we mirror what the system
 * tells us rather than trying to keep our own opt-in flag in sync.
 */
export const SettingsScreen: Component<{
  api: CodeplaneMobileAPI
  onBack: () => void
}> = (props) => {
  const [scrolled, setScrolled] = createSignal(false)

  // Refresh-key bumped whenever a permission changes so the resources
  // re-fetch instead of caching the stale "denied" / "prompt" tone.
  const [permsRefreshKey, setPermsRefreshKey] = createSignal(0)

  const [appInfo] = createResource<MobileAppInfo>(async () => {
    return await props.api.app.info()
  })

  const [deviceInfo] = createResource<MobileDeviceInfo>(async () => {
    return await props.api.device()
  })

  const [notifPermission] = createResource<MobilePermissionState, number>(
    () => permsRefreshKey(),
    async () => {
      return await props.api.notifications.check()
    },
  )

  const [liveActivitiesStatus] = createResource<
    { supported: boolean; enabled: boolean },
    number
  >(
    () => permsRefreshKey(),
    async () => {
      try {
        return await props.api.liveActivities.isSupported()
      } catch {
        return { supported: false, enabled: false }
      }
    },
  )

  // Re-probe whenever the user lifts the focus back to the picker —
  // typical flow is "tap Open Settings → flip switch in iOS → swipe
  // back to the app", and we want the row to reflect the change
  // without forcing a manual refresh. The Visibility API fires
  // `visibilitychange` when the WebView is brought back to the
  // foreground after iOS Settings was on top.
  onMount(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setPermsRefreshKey((k) => k + 1)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility))
  })

  const requestNotifications = async () => {
    props.api.haptics.selection().catch(() => {})
    await props.api.notifications.request().catch(() => false)
    setPermsRefreshKey((k) => k + 1)
  }

  const openSystemSettings = async () => {
    props.api.haptics.selection().catch(() => {})
    await props.api.app.openSettings().catch(() => false)
  }

  return (
    <div class="mobile-page">
      <MobileHeader title="Settings" elevated={scrolled()} onBack={props.onBack} />

      <div
        class="mobile-page__scroll"
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}
      >
        {/* ----- Permissions ----- */}
        <section class="mobile-section">
          <h2 class="mobile-section__title">Permissions</h2>
          <div class="mobile-list">
            <PermissionRow
              title="Notifications"
              help="Used for the 'task ready' alerts when a Codeplane session finishes in the background."
              state={notifPermission()}
              platform={props.api.platform}
              onRequest={requestNotifications}
              onOpenSettings={openSystemSettings}
            />
            {/* Live Activities are an iOS-only OS surface. Hiding
                the row entirely whenever the platform isn't iOS
                — and additionally whenever the iOS plugin reports
                `supported: false` (Mac Catalyst, iOS < 16.2,
                ActivityKit unavailable for any other reason) —
                stops the picker from advertising a "Live
                Activities · Unavailable" pill that reads as broken
                rather than informative. We deliberately keep the
                row visible while the probe is in-flight (status is
                undefined) so users on iOS see "Checking…" instead
                of a mid-load flash of nothing. */}
            <Show
              when={
                props.api.platform === "ios" &&
                (liveActivitiesStatus() === undefined || liveActivitiesStatus()?.supported === true)
              }
            >
              <LiveActivitiesRow
                status={liveActivitiesStatus()}
                platform={props.api.platform}
                onOpenSettings={openSystemSettings}
              />
            </Show>
          </div>
          <Show when={props.api.platform === "ios"}>
            <p class="mobile-section__footer">
              iOS controls these. Once you've answered a prompt, only the system Settings page can
              flip the switch — tap "Open Settings" to jump straight there.
            </p>
          </Show>
        </section>

        {/* ----- About ----- */}
        <section class="mobile-section">
          <h2 class="mobile-section__title">About</h2>
          <div class="mobile-list">
            <ValueRow label="Version" value={formatString(appInfo()?.version)} />
            <ValueRow label="Build" value={formatString(appInfo()?.build)} />
            <ValueRow label="Bundle ID" value={formatString(appInfo()?.id)} />
            <ValueRow label="Name" value={formatString(appInfo()?.name)} />
          </div>
        </section>

        {/* ----- Device ----- */}
        <section class="mobile-section">
          <h2 class="mobile-section__title">Device</h2>
          <div class="mobile-list">
            <ValueRow label="Platform" value={formatPlatform(deviceInfo()?.platform)} />
            <ValueRow label="OS Version" value={formatString(deviceInfo()?.osVersion)} />
            <ValueRow label="Model" value={formatString(deviceInfo()?.model)} />
            <ValueRow label="Manufacturer" value={formatString(deviceInfo()?.manufacturer)} />
            <Show when={deviceInfo()?.webViewVersion}>
              <ValueRow label="WebView" value={deviceInfo()!.webViewVersion!} />
            </Show>
            <ValueRow
              label="Hardware"
              value={deviceInfo() ? (deviceInfo()!.isVirtual ? "Simulator" : "Physical") : "—"}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

/** Reads a tri-state and renders the matching `Allow / Open Settings / —` UI. */
const PermissionRow: Component<{
  title: string
  help: string
  state: MobilePermissionState | undefined
  platform: "ios" | "android" | "web"
  onRequest: () => void
  onOpenSettings: () => void
}> = (props) => {
  return (
    <div class="mobile-list__row">
      <div class="mobile-list__row-body">
        <span class="mobile-list__row-title">{props.title}</span>
        <span class="mobile-list__row-help">{props.help}</span>
      </div>
      <PermissionTrailing
        state={props.state}
        platform={props.platform}
        onRequest={props.onRequest}
        onOpenSettings={props.onOpenSettings}
      />
    </div>
  )
}

/** Trailing slot of a permission row — renders pill OR action button. */
const PermissionTrailing: Component<{
  state: MobilePermissionState | undefined
  platform: "ios" | "android" | "web"
  onRequest: () => void
  onOpenSettings: () => void
}> = (props) => {
  return (
    <Show
      when={props.state && props.state !== "unknown"}
      fallback={<span class="mobile-list__row-value">—</span>}
    >
      <Show when={props.state === "granted"}>
        <span class="mobile-pill" data-tone="ok">
          Allowed
        </span>
      </Show>
      <Show when={props.state === "denied"}>
        <Show
          when={props.platform === "ios"}
          fallback={
            <span class="mobile-pill" data-tone="warn">
              Denied
            </span>
          }
        >
          <button type="button" class="mobile-list__action" onClick={props.onOpenSettings}>
            Open Settings
          </button>
        </Show>
      </Show>
      <Show when={props.state === "prompt" || props.state === "prompt-with-rationale"}>
        <button type="button" class="mobile-list__action" onClick={props.onRequest}>
          Request
        </button>
      </Show>
    </Show>
  )
}

/** Live Activities row — separate from permission rows because the
 * status is "supported / supported-but-disabled / unsupported", not
 * iOS's standard tri-state. The picker can't *request* this; users
 * have to flip it in Settings → Face ID / Live Activities. */
const LiveActivitiesRow: Component<{
  status: { supported: boolean; enabled: boolean } | undefined
  platform: "ios" | "android" | "web"
  onOpenSettings: () => void
}> = (props) => {
  // Caller hides the whole row when `status.supported === false`,
  // so the unsupported-text and "Unavailable" pill branches that
  // used to live here have been pruned — they were dead code that
  // only made the file harder to read.
  const help = () => {
    if (!props.status) return "Checking…"
    if (!props.status.enabled) {
      return "Disabled in iOS Settings — turn it on to surface running tasks on the Lock Screen."
    }
    return "Surfaces running Codeplane tasks on the Lock Screen and Dynamic Island."
  }

  const trailing = () => {
    if (!props.status) {
      return (
        <span class="mobile-pill" data-tone="muted">
          …
        </span>
      )
    }
    if (!props.status.enabled) {
      return (
        <button type="button" class="mobile-list__action" onClick={props.onOpenSettings}>
          Open Settings
        </button>
      )
    }
    return (
      <span class="mobile-pill" data-tone="ok">
        Enabled
      </span>
    )
  }

  return (
    <div class="mobile-list__row">
      <div class="mobile-list__row-body">
        <span class="mobile-list__row-title">Live Activities</span>
        <span class="mobile-list__row-help">{help()}</span>
      </div>
      {trailing()}
    </div>
  )
}

/** Plain label-on-left, value-on-right read-only row. */
const ValueRow: Component<{ label: string; value: string }> = (props) => (
  <div class="mobile-list__row">
    <div class="mobile-list__row-body">
      <span class="mobile-list__row-title">{props.label}</span>
    </div>
    <span class="mobile-list__row-value">{props.value}</span>
  </div>
)

const formatString = (value: string | undefined): string => {
  // Show an em-dash for empty/missing values so the row keeps its
  // visual rhythm — empty strings would collapse the right column
  // and break the alignment with the rest of the list.
  if (!value) return "—"
  return value
}

const formatPlatform = (p: "ios" | "android" | "web" | undefined): string => {
  if (p === "ios") return "iOS"
  if (p === "android") return "Android"
  if (p === "web") return "Web"
  return "—"
}
