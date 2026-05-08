import { type ComponentProps, createMemo, onCleanup, onMount, Show, splitProps } from "solid-js"
import { Button } from "./button"
import { Tooltip } from "./tooltip"

/**
 * Stable DOM id shared with the mobile shell's `closeButtonScript`
 * fallback inject. The shell looks for an element with this id before
 * painting its own pill — when this component is mounted it bumps a
 * window-level flag (see `MOBILE_BACK_FLAG`) that the inject polls,
 * so the two never paint at the same time. Older shells that don't
 * read the flag still get short-circuited on subsequent re-injects
 * because `getElementById(STABLE_ID)` finds *us* once we've mounted.
 */
const STABLE_ID = "__cp-mobile-close-button"

/**
 * `window.__cpMobileBackEmbedded` — the contract between the embedded
 * UI and the mobile shell. Truthy ⇒ the embedded UI exposes its own
 * Back affordance, so the shell skips its `executeScript` fallback.
 * The shell's poll runs for ~3 s after open, which means even if the
 * embedded button mounts a frame after the inject paints, the shell
 * notices the flag on its next poll tick and removes its own pill.
 */
const MOBILE_BACK_FLAG = "__cpMobileBackEmbedded"

/**
 * Detect whether the embedded UI is hosted by the Codeplane mobile
 * shell (Capacitor WKWebView on iOS / WebView on Android). The shell
 * appends `Codeplane/Mobile` to the user-agent at config time
 * (`packages/mobile/capacitor.config.ts`), so a single regex on
 * `navigator.userAgent` is the source of truth — no platform context
 * needed at the call site.
 *
 * Returns `false` in SSR / Node / Storybook where `navigator` is
 * undefined or the UA doesn't carry our tag, which means
 * `<MobileBackButton />` renders nothing on those surfaces.
 */
const isMobileShell = (): boolean => {
  if (typeof navigator !== "object" || !navigator.userAgent) return false
  return /Codeplane\/Mobile/.test(navigator.userAgent)
}

/**
 * Bridge to the host shell's "dismiss this WebView" entry point.
 *
 * `window.mobileApp` is auto-injected by `@capgo/inappbrowser` once the
 * embedded UI runs inside the in-app WKWebView. The fallback to the
 * raw WebKit message handler covers the (rare) early-paint window
 * where the JS bridge wrapper hasn't been wired yet — both end up
 * triggering the plugin's `closeEvent`, which the shell listens for
 * to route back to the picker.
 */
const triggerHostClose = () => {
  try {
    const mobileApp = (window as unknown as { mobileApp?: { close?: () => void } }).mobileApp
    if (mobileApp && typeof mobileApp.close === "function") {
      mobileApp.close()
      return
    }
  } catch {
    /* mobileApp lookup threw — fall through to the WebKit handler. */
  }
  try {
    const webkit = (
      window as unknown as {
        webkit?: { messageHandlers?: { close?: { postMessage: (m: unknown) => void } } }
      }
    ).webkit
    webkit?.messageHandlers?.close?.postMessage(null)
  } catch {
    /* Defensive — if neither bridge is wired we silently no-op rather
       than throw an unhandled error onto the page. */
  }
}

export interface MobileBackButtonProps
  extends Omit<ComponentProps<"button">, "onClick" | "id" | "children"> {
  /**
   * Force-override the auto-detected "running inside the mobile shell"
   * heuristic. Useful for Storybook or e2e tests that want to render
   * the button on a non-mobile UA. Omit in production code — the
   * default UA sniff is correct for every real shell.
   */
  visible?: boolean
  /**
   * Tooltip + aria label. Defaults to "Back". Pass a translated
   * string from the consumer's i18n layer when localising.
   */
  label?: string
}

/**
 * Mobile-only "Back" affordance for the embedded Codeplane web UI.
 *
 * The mobile shell hosts each instance in a chromeless WKWebView with
 * `toolbarType: BLANK`, so there's no native dismiss control. This
 * component fills that gap by rendering an inline icon button styled
 * to slot in alongside the existing titlebar toggles (terminal / review
 * / file-tree) — same `Button` primitive, same `chevron-left` glyph the
 * desktop's history-back already uses, so it reads as part of the
 * cluster instead of floating on top of it.
 *
 * Renders nothing on desktop / web — the UA sniff is the gate. The
 * `__cpMobileBackEmbedded` flag we set on mount tells the shell's
 * fallback pill (the legacy `executeScript` injection) to step aside
 * so users on newer instance versions only see this in-chrome button,
 * never both.
 */
export function MobileBackButton(props: MobileBackButtonProps) {
  const [split, rest] = splitProps(props, ["visible", "label", "class", "classList"])
  const visible = createMemo(() =>
    typeof split.visible === "boolean" ? split.visible : isMobileShell(),
  )

  // Coordinate with the shell's `closeButtonScript` fallback. While
  // mounted, raise the flag the shell polls for; clean it up on
  // unmount so a later re-mount in a different document state
  // (e.g. SPA route change) re-establishes it from scratch.
  onMount(() => {
    if (!visible() || typeof window === "undefined") return
    ;(window as Record<string, unknown>)[MOBILE_BACK_FLAG] = true
  })
  onCleanup(() => {
    if (typeof window === "undefined") return
    delete (window as Record<string, unknown>)[MOBILE_BACK_FLAG]
  })

  return (
    <Show when={visible()}>
      <Tooltip placement="bottom" value={split.label ?? "Back"}>
        <Button
          {...rest}
          id={STABLE_ID}
          variant="ghost"
          icon="chevron-left"
          aria-label={split.label ?? "Back"}
          class={split.class}
          classList={split.classList}
          onClick={() => triggerHostClose()}
        />
      </Tooltip>
    </Show>
  )
}
