import { Component, JSX, Show } from "solid-js"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeIcon } from "@codeplane-ai/ui/huge-icon"

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
 * All affordance icons (chevron, plus, sliders) come from the shared
 * HugeIcons set via `<HugeIcon>` so the entire app pulls from one
 * library. Sticking to a single icon family keeps optical weight
 * consistent across screens — the picker, the settings page, and any
 * future detail screens all share the 1.5-stroke HugeIcons rounded
 * profile rather than mixing weights.
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

/** Back chevron used in the header's leading slot. */
const BackChevron: Component = () => <HugeIcon icon={ArrowLeft01Icon} size={22} />

/** Reusable `+` icon. Exported so the picker's trailing slot can use it. */
export const PlusIcon: Component = () => <HugeIcon icon={PlusSignIcon} size={22} />

/** Right-pointing chevron for list rows — matches the iOS list style. */
export const RightChevron: Component = () => <HugeIcon icon={ArrowRight01Icon} size={14} />

/**
 * Settings icon — HugeIcons' `FilterHorizontalIcon`, the iOS
 * Control-Center "horizontal sliders with knobs" convention. Three
 * adjustable rows make the affordance unmistakably about
 * configuration without the sunburst ambiguity that small cog
 * silhouettes have at 22px on dark backgrounds.
 */
export const SettingsIcon: Component = () => <HugeIcon icon={FilterHorizontalIcon} size={22} />
