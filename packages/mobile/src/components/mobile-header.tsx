import { Component, JSX, Show } from "solid-js"

/**
 * Standard iOS/Android nav bar.
 *
 *   ‹ Back        Title         Action
 *
 * Both side slots are 44px touch targets. We mimic the iOS HIG layout
 * because Android Material navigation is also compatible with this
 * shape (Material 3 calls it a "Top app bar (small)" with optional
 * leading + trailing icons).
 *
 * The vector chevron and `+` are SVGs rather than plain Unicode — at
 * 17px line-heights iOS Safari would render the lone `+` glyph
 * without proper optical alignment, so a vector keeps the action
 * crisp and centred at every density.
 */
export const MobileHeader: Component<{
  title: string
  leading?: JSX.Element
  trailing?: JSX.Element
  /** Called when the leading slot is pressed if no custom leading is given. */
  onBack?: () => void
  /**
   * Called every time the title text is pressed. The picker uses this
   * for the hidden 5-tap Live Activity demo trigger; everywhere else
   * it goes unset and the title behaves as a plain heading.
   */
  onTitlePress?: () => void
  /** Whether content scrolls under the bar — drives the bottom hairline. */
  elevated?: boolean
}> = (props) => {
  return (
    <header class="mobile-header" data-elevated={props.elevated ? "true" : "false"}>
      <div class="mobile-header__action" style={{ "justify-content": "flex-start" }}>
        <Show
          when={props.leading}
          fallback={
            <Show when={props.onBack}>
              <button
                type="button"
                class="mobile-icon-button"
                aria-label="Back"
                onClick={() => props.onBack?.()}
              >
                <BackChevron />
              </button>
            </Show>
          }
        >
          {props.leading}
        </Show>
      </div>
      <Show
        when={props.onTitlePress}
        fallback={<h1 class="mobile-header__title">{props.title}</h1>}
      >
        {/* Tapping the title fires `onTitlePress` — used by the picker
            to expose a hidden Live Activity demo trigger via 5 quick
            taps. Rendered as a button (not a heading) only when a
            handler is wired in so screen readers announce the
            interactivity correctly. */}
        <button
          type="button"
          class="mobile-header__title"
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "default",
            "-webkit-tap-highlight-color": "transparent",
          }}
          onClick={() => props.onTitlePress?.()}
          aria-label={props.title}
        >
          {props.title}
        </button>
      </Show>
      <div class="mobile-header__action" style={{ "justify-content": "flex-end" }}>
        {props.trailing}
      </div>
    </header>
  )
}

const BackChevron: Component = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    aria-hidden
    role="presentation"
  >
    <path
      d="M13.5 4.5L7 11l6.5 6.5"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

/** Reusable `+` icon. Exported so the picker's trailing slot can use it. */
export const PlusIcon: Component = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden role="presentation">
    <path
      d="M11 4.5v13M4.5 11h13"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

/** Right-pointing chevron for list rows — matches the iOS list style. */
export const RightChevron: Component = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden role="presentation">
    <path
      d="M5 3l4 4-4 4"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
)

/**
 * Settings icon — three horizontal sliders, the iOS Control-Center
 * convention. Replaces the previous cog because at 22px on the
 * dark picker background, the cog's eight rounded teeth read as
 * a sunburst (i.e. a theme-toggle glyph) and got mistaken for one.
 * Sliders are unambiguous, share the same horizontal/vertical
 * symmetry as `PlusIcon`, and stay legible at the small size.
 *
 * The track segments break around each knob rather than passing
 * through it, which is what makes the row read as "an adjustable
 * control" rather than three lines with three discs floating on
 * top.
 */
export const SettingsIcon: Component = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    fill="none"
    aria-hidden
    role="presentation"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {/* Row 1 — knob at x=15 */}
    <line x1="3" y1="6" x2="13" y2="6" />
    <line x1="17" y1="6" x2="19" y2="6" />
    <circle cx="15" cy="6" r="2" />
    {/* Row 2 — knob at x=8 */}
    <line x1="3" y1="11" x2="6" y2="11" />
    <line x1="10" y1="11" x2="19" y2="11" />
    <circle cx="8" cy="11" r="2" />
    {/* Row 3 — knob at x=14 */}
    <line x1="3" y1="16" x2="12" y2="16" />
    <line x1="16" y1="16" x2="19" y2="16" />
    <circle cx="14" cy="16" r="2" />
  </svg>
)
