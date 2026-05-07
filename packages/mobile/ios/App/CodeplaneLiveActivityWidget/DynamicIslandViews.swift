//  DynamicIslandViews.swift
//
//  Dynamic Island layouts for the Codeplane Live Activity.
//
//  iOS asks for four presentations:
//
//      compactLeading / compactTrailing — the small pill that sits
//          around the camera notch when only this activity is active.
//          We put the brand chevron on the leading side and a small
//          progress / queue / multi-task indicator on the trailing
//          side. The trailing slot belongs to the *primary* task —
//          there's not enough horizontal space to show two task
//          glyphs in compact view; the active count is what surfaces
//          to hint at the duo.
//
//      minimal — when multiple activities share the island, the
//          system collapses each one to a single dot. We use a
//          small ring that fills with the primary task's progress
//          (or a steady mark when indeterminate / queued / done).
//
//      Expanded leading / trailing / center / bottom — the long-press
//          / drag-down preview. Mirrors the lock-screen layout: the
//          bottom region paints the primary task on top, and (when
//          present) the secondary task underneath with a divider and
//          an optional "+N more" footer.
//
//  Brand colours come from CodeplaneLiveActivityWidget.swift. Palette
//  is monochrome — same tokens the picker uses in dark mode — so the
//  Dynamic Island reads as the same product as the lock-screen
//  surface and the in-app picker.

import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - compact (the always-visible pill around the notch)

@available(iOS 16.2, *)
struct CodeplaneCompactLeading: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .heavy))
            .foregroundColor(.codeplaneText)
            .accessibilityLabel("Codeplane")
    }
}

@available(iOS 16.2, *)
struct CodeplaneCompactTrailing: View {
    let state: CodeplaneActivityAttributes.State

    var body: some View {
        let task = state.primary
        if task.phase == .completed {
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.codeplaneText)
        } else if task.phase == .failed {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(.codeplaneFailure)
        } else if let progress = task.progress {
            // Tiny progress ring. Filled in `--text-strong` so it
            // stays monochrome.
            ZStack {
                Circle()
                    .stroke(Color.codeplaneText.opacity(0.18), lineWidth: 2)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.codeplaneText, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.4), value: progress)
            }
            .frame(width: 16, height: 16)
        } else if state.totalActive > 1 {
            // Multi-task: surface the active count instead of a
            // queue-depth pill (queue depth is a per-task concept,
            // counts is the duo-aware concept).
            HStack(spacing: 2) {
                Image(systemName: "rectangle.stack.fill")
                    .font(.system(size: 11, weight: .medium))
                Text("\(state.totalActive)")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
            }
            .foregroundColor(.codeplaneText)
        } else if task.queueDepth > 0 {
            HStack(spacing: 2) {
                Image(systemName: "tray.full.fill")
                    .font(.system(size: 10, weight: .medium))
                Text("\(task.queueDepth)")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
            }
            .foregroundColor(.codeplaneText)
        } else {
            // Indeterminate spinner stand-in.
            Image(systemName: "circle.dashed")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.codeplaneText)
        }
    }
}

// MARK: - minimal (one dot, when multiple activities share the island)

@available(iOS 16.2, *)
struct CodeplaneMinimal: View {
    let state: CodeplaneActivityAttributes.State

    var body: some View {
        let task = state.primary
        if task.phase == .completed {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.codeplaneText)
        } else if task.phase == .failed {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.codeplaneFailure)
        } else if let progress = task.progress {
            ZStack {
                Circle()
                    .stroke(Color.codeplaneText.opacity(0.18), lineWidth: 1.5)
                Circle()
                    .trim(from: 0, to: progress)
                    .stroke(Color.codeplaneText, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.4), value: progress)
            }
            .frame(width: 14, height: 14)
        } else {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .heavy))
                .foregroundColor(.codeplaneText)
        }
    }
}

// MARK: - expanded — leading region (brand chevron + active count)

@available(iOS 16.2, *)
struct CodeplaneIslandLeading: View {
    let state: CodeplaneActivityAttributes.State

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .heavy))
                .foregroundColor(.codeplaneText)
            if state.totalActive > 1 {
                // Quick "2 of 3"-style cue from the leading edge.
                Text("\(state.totalActive)")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(.codeplaneTextMuted)
            }
        }
    }
}

// MARK: - expanded — trailing region (per-primary stat block)

@available(iOS 16.2, *)
struct CodeplaneIslandTrailing: View {
    let state: CodeplaneActivityAttributes.State
    let attributes: CodeplaneActivityAttributes

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            ElapsedText(
                startedAt: state.primary.startedAt,
                override: state.primary.elapsedSeconds
            )
            if let progress = state.primary.progress {
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.codeplaneTextMuted)
            } else if state.primary.queueDepth > 0 {
                Text("\(state.primary.queueDepth) queued")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.codeplaneTextMuted)
            }
        }
    }
}

// MARK: - expanded — center region (instance label / host)

@available(iOS 16.2, *)
struct CodeplaneIslandCenter: View {
    let attributes: CodeplaneActivityAttributes

    var body: some View {
        VStack(spacing: 1) {
            Text(attributes.instanceLabel)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundColor(.codeplaneText)
                .lineLimit(1)
            Text(attributes.instanceHost)
                .font(.system(size: 10, weight: .regular, design: .monospaced))
                .foregroundColor(.codeplaneTextMuted)
                .lineLimit(1)
        }
    }
}

// MARK: - expanded — bottom region (duo body)

@available(iOS 16.2, *)
struct CodeplaneIslandBottom: View {
    let state: CodeplaneActivityAttributes.State

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CodeplaneIslandTaskLine(task: state.primary)
            if let secondary = state.secondary {
                Divider().background(Color.codeplaneBorder)
                CodeplaneIslandTaskLine(task: secondary)
            }
            if state.hiddenActive > 0 {
                Text("+\(state.hiddenActive) more running")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundColor(.codeplaneTextMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .padding(.top, 2)
    }
}

@available(iOS 16.2, *)
struct CodeplaneIslandTaskLine: View {
    let task: CodeplaneActivityAttributes.State.Task

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            PhaseGlyph(phase: task.phase)
            Text(task.title)
                .font(.system(size: 12, weight: .regular))
                .foregroundColor(.codeplaneText.opacity(0.92))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let progress = task.progress {
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.codeplaneTextMuted)
            } else if task.queueDepth > 0 {
                Text("\(task.queueDepth) queued")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.codeplaneTextMuted)
            }
        }
    }
}
