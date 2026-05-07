//  CodeplaneLiveActivityWidget.swift
//
//  Entry point for the Live Activity widget extension. This file
//  belongs to the *widget extension* target only — NOT the App target.
//
//  After running `bun run cap:add:ios`, add a new target in Xcode:
//      File → New → Target… → Widget Extension
//      ✓ Include Live Activity
//      Name: CodeplaneLiveActivityWidget
//
//  Then replace the auto-generated entry file with this one and add
//  the shared `CodeplaneActivityAttributes.swift` to the extension's
//  Compile Sources phase. Add `LockScreenView.swift` and
//  `DynamicIslandViews.swift` to the same target.
//
//  Visual language goals: stay close to the desktop's Codeplane brand
//  (deep `#0B0D10` background, single accent), be readable at a glance,
//  and never lie about state — when no progress info is available we
//  show motion (an indeterminate-style stripe) instead of "0%".

import ActivityKit
import SwiftUI
import WidgetKit

@main
struct CodeplaneWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            CodeplaneLiveActivityWidget()
        }
    }
}

@available(iOS 16.2, *)
struct CodeplaneLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CodeplaneActivityAttributes.self) { context in
            // Lock Screen + Notification Center presentation.
            CodeplaneLockScreenView(
                attributes: context.attributes,
                state: context.state,
                isStale: context.isStale
            )
            .activityBackgroundTint(.codeplaneBackground)
            .activitySystemActionForegroundColor(.codeplaneText)
        } dynamicIsland: { context in
            // Dynamic Island layouts. iOS uses these on devices that
            // have one; on older devices the same model still drives
            // the compact / minimal status notch via the system.
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    CodeplaneIslandLeading(state: context.state)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CodeplaneIslandTrailing(state: context.state, attributes: context.attributes)
                }
                DynamicIslandExpandedRegion(.center) {
                    CodeplaneIslandCenter(attributes: context.attributes)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    CodeplaneIslandBottom(state: context.state)
                }
            } compactLeading: {
                CodeplaneCompactLeading()
            } compactTrailing: {
                CodeplaneCompactTrailing(state: context.state)
            } minimal: {
                CodeplaneMinimal(state: context.state)
            }
            // Keyline tint hugs the Dynamic Island's outer edge when
            // the activity is active. We use the same `--text-strong`
            // tone the rest of the widget paints with so the keyline
            // matches the chevron and progress fill, not a chromatic
            // accent that would clash with the picker's monochrome
            // identity.
            .keylineTint(.codeplaneText)
        }
    }
}

// MARK: - Brand palette
//
// Mirrored from packages/ui/src/styles/tailwind/index.css and the
// mobile picker's `mobile.css` so the widget reads as the same
// product the user sees in the picker. The picker is monochrome —
// any chromatic accent (the cool blue we used in earlier widgets)
// would now look out of place against the rest of the app, so we
// stick to the OC-2 dark palette: `--text-strong` for prominent
// glyphs, `--text-weak` for muted text, `--border-weak-base` for
// divider hairlines.
//
// `codeplaneFailure` is the lone chromatic concession — the failed
// phase glyph is a small triangle alert and a red tone genuinely
// reads "danger" faster than any monochrome treatment. Everything
// else stays on the white-on-dark scale.

extension Color {
    /// `--background-base` (dark mode) — `0x101010` matches the
    /// picker's body bg, but the live-activity surface is
    /// presented over the system Lock Screen which already has its
    /// own backdrop, so we use a slightly deeper Codeplane-brand
    /// shade for activity-tint purposes.
    static let codeplaneBackground = Color(red: 0x0B / 255, green: 0x0D / 255, blue: 0x10 / 255)

    /// `--text-strong` (dark, ~0.94 white). Used for primary glyphs,
    /// instance label, task title, progress fill.
    static let codeplaneText = Color(red: 0xED / 255, green: 0xED / 255, blue: 0xED / 255)

    /// `--text-weak` (~0.42 white). Used for hostname, meta line
    /// (turns / elapsed / queue), percent labels, "+N more" footer.
    static let codeplaneTextMuted = Color.white.opacity(0.55)

    /// `--border-weak-base` — divider hairline between primary and
    /// secondary task rows in the duo layout.
    static let codeplaneBorder = Color.white.opacity(0.12)

    /// `--surface-base` — never directly used as a fill in the
    /// activity (the Lock Screen backdrop is the surface), but kept
    /// for symmetry with the picker's tokens in case a future view
    /// wants a tinted plate.
    static let codeplaneSurface = Color.white.opacity(0.06)

    /// `--surface-critical-strong` — the only chromatic colour the
    /// widget keeps. Used by the `failed` phase glyph.
    static let codeplaneFailure = Color(red: 0xFC / 255, green: 0x53 / 255, blue: 0x3A / 255)
}
