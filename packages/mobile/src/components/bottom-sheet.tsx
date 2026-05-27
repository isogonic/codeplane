import { Component, JSX, Show, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"

/**
 * Bottom sheet. Replaces the desktop's centered-modal pattern.
 *
 * iOS users expect modals to slide up from the bottom and snap; Android
 * follows the same convention (Material 3 "modal bottom sheet"). The
 * scrim behind it dismisses on tap, and the drag handle on top acts as
 * a hint that the sheet is dismissible.
 *
 * Visual rules — both encoded in `mobile.css`:
 *  - When `data-open="false"` the sheet has NO box-shadow, so the
 *    upward-cast shadow doesn't bleed into the parent viewport while
 *    the sheet is parked off-screen.
 *  - The scrim is `backdrop-filter: blur(2px)` so the underlying
 *    chrome stays legible without competing with the sheet.
 *
 * For accessibility we set role="dialog" with aria-modal and the title
 * is referenced via aria-labelledby. We don't try to be a full focus
 * trap library — Kobalte's Dialog primitive already does that and is
 * available in @codeplane-ai/ui if a screen needs the heavy version.
 * We do, however, listen for the Escape key while the sheet is open
 * so a connected keyboard / external switch dismisses it cleanly.
 */
export const BottomSheet: Component<{
  open: boolean
  title?: string
  onDismiss?: () => void
  children: JSX.Element
}> = (props) => {
  let previousOverflow: string | undefined

  const restoreOverflow = () => {
    if (previousOverflow === undefined) return
    document.body.style.overflow = previousOverflow
    previousOverflow = undefined
  }

  createEffect(() => {
    const open = props.open
    if (!open) {
      restoreOverflow()
      return
    }
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
  })

  onCleanup(restoreOverflow)

  createEffect(() => {
    if (!props.open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onDismiss?.()
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => {
      window.removeEventListener("keydown", onKey)
    })
  })

  return (
    <Portal>
      <div
        class="bottom-sheet__scrim"
        data-open={props.open ? "true" : "false"}
        aria-hidden={!props.open}
        onClick={() => props.onDismiss?.()}
      />
      <div
        class="bottom-sheet"
        data-open={props.open ? "true" : "false"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.title ? "bottom-sheet-title" : undefined}
        aria-hidden={!props.open}
      >
        <div class="bottom-sheet__handle" aria-hidden />
        <Show when={props.title}>
          <div id="bottom-sheet-title" class="bottom-sheet__title">
            {props.title}
          </div>
        </Show>
        <div class="mobile-scroll" style={{ flex: "1 1 auto", "padding-bottom": "16px" }}>
          {props.children}
        </div>
      </div>
    </Portal>
  )
}
