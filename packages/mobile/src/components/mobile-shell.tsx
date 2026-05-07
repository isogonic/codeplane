import { Component, JSX, onCleanup, onMount } from "solid-js"
import type { CodeplaneMobileAPI } from "../platform/api"

/**
 * Outer mobile-only chrome. Owns:
 *  - safe-area passthrough so the screens never have to think about it
 *  - native back-button wiring (Android hardware back, iOS swipe is
 *    handled by the navigation system itself)
 *  - splash screen dismissal once the first paint lands
 *  - status-bar style sync to the current colour scheme — the picker
 *    follows `prefers-color-scheme` (same model as the desktop and web
 *    shells), so the bar foreground has to flip with it. We listen on
 *    a `matchMedia` query and re-call the appropriate `statusBar.set*`
 *    helper whenever the user changes their OS theme while the app is
 *    open (e.g. iOS auto-dark at sunset).
 *
 * It deliberately renders nothing besides children plus a single
 * `<header>` slot — the shell is structural, not visual chrome.
 */
export const MobileShell: Component<{
  api: CodeplaneMobileAPI
  onBack?: () => boolean | void
  children: JSX.Element
}> = (props) => {
  onMount(() => {
    // Hide the native splash as soon as the renderer has mounted; the
    // user should see the picker UI fade in instead of staring at a
    // brand image. Matches the desktop's "open straight to picker".
    props.api.splash.hide().catch(() => {})

    // Sync the status-bar foreground with the active CSS colour-scheme.
    // Dark UI → light icons (`setLight`); light UI → dark icons (`setDark`).
    // We use `matchMedia` rather than reading `--background-base` because
    // the helper already abstracts the dark/light decision and matches
    // the same primitive the shared theme uses to flip its tokens.
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const syncStatusBar = () => {
      if (mq.matches) {
        props.api.statusBar.setLight().catch(() => {})
      } else {
        props.api.statusBar.setDark().catch(() => {})
      }
    }
    syncStatusBar()
    const onSchemeChange = () => syncStatusBar()
    mq.addEventListener("change", onSchemeChange)

    const off = props.api.back.onBack(() => {
      if (props.onBack) {
        const handled = props.onBack()
        return handled === undefined ? true : handled
      }
      return false
    })
    onCleanup(() => {
      mq.removeEventListener("change", onSchemeChange)
      off()
    })
  })

  return (
    <div class="flex flex-col h-full w-full no-select">
      <div class="h-safe-top" aria-hidden />
      {props.children}
    </div>
  )
}
