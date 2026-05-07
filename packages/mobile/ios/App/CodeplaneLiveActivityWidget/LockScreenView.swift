//  LockScreenView.swift
//
//  Lock-Screen / Notification-Center presentation of the Codeplane
//  Live Activity. Goes into the widget extension target.
//
//  Visual layout — single-task (totalActive == 1):
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  ◤  Production            prod.codeplane.example.com    │
//  │                                                         │
//  │  ●  Refactoring authentication middleware…              │
//  │     3 turns · 2:14 elapsed                              │
//  │     ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  38%   │
//  └─────────────────────────────────────────────────────────┘
//
//  Visual layout — duo (totalActive >= 2):
//
//  ┌─────────────────────────────────────────────────────────┐
//  │  ◤  Production         prod.codeplane.example.com       │
//  │                                                         │
//  │  ●  Refactoring authentication middleware…              │
//  │     3 turns · 2:14                                 38%  │
//  │  ─────────────────────────────────────────────────      │
//  │  ●  Updating database schema for v2 endpoints           │
//  │     1 turn · 0:42                                  ⏳   │
//  │                                                         │
//  │                       +1 more running                   │
//  └─────────────────────────────────────────────────────────┘
//
//  Palette is monochrome — same tokens the picker uses in dark mode
//  (`--text-strong`, `--text-weak`, `--border-weak-base`). The single
//  chromatic concession is `codeplaneFailure` for the `failed` phase
//  glyph; everything else lives on a white-on-dark scale.
//
//  When `progress` is nil we render an indeterminate striped bar
//  instead of "0% forever". For the duo layout the bar shrinks to a
//  thin strip and the percent sits to the right of the title.

import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct CodeplaneLockScreenView: View {
    let attributes: CodeplaneActivityAttributes
    let state: CodeplaneActivityAttributes.State
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CodeplaneHeader(attributes: attributes)

            CodeplaneTaskRow(
                task: state.primary,
                isStale: isStale,
                isCompact: state.secondary != nil
            )

            if let secondary = state.secondary {
                Divider()
                    .background(Color.codeplaneBorder)
                CodeplaneTaskRow(
                    task: secondary,
                    isStale: isStale,
                    isCompact: true
                )
            }

            if state.hiddenActive > 0 {
                Text("+\(state.hiddenActive) more running")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundColor(.codeplaneTextMuted)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 2)
            }
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
        .opacity(isStale ? 0.7 : 1)
    }
}

// MARK: - header

@available(iOS 16.2, *)
struct CodeplaneHeader: View {
    let attributes: CodeplaneActivityAttributes

    var body: some View {
        HStack(spacing: 10) {
            CodeplaneMark()
                .frame(width: 22, height: 22)

            VStack(alignment: .leading, spacing: 1) {
                Text(attributes.instanceLabel)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(.codeplaneText)
                    .lineLimit(1)
                Text(attributes.instanceHost)
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundColor(.codeplaneTextMuted)
                    .lineLimit(1)
            }

            Spacer()
        }
    }
}

// MARK: - one task row (used for primary AND secondary)

@available(iOS 16.2, *)
struct CodeplaneTaskRow: View {
    let task: CodeplaneActivityAttributes.State.Task
    let isStale: Bool
    /// In the duo layout we use a tighter row (smaller progress bar,
    /// percent-on-the-right). In the single-task layout the row gets
    /// the full vertical space so the progress bar can stretch.
    let isCompact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                PhaseGlyph(phase: task.phase)
                Text(task.title)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(.codeplaneText.opacity(isStale ? 0.5 : 0.94))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isCompact, let progress = task.progress {
                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.codeplaneTextMuted)
                }
            }
            HStack(spacing: 8) {
                MetaLabel(task: task)
                Spacer(minLength: 0)
            }
            // In the single-task layout the bar stretches across
            // its own line so it's visible at a glance. In the duo
            // layout we drop the bar entirely (the percent already
            // sits next to the title) — vertical space is too
            // precious.
            if !isCompact {
                ProgressStrip(progress: task.progress)
            }
        }
    }
}

// MARK: - phase glyph

@available(iOS 16.2, *)
struct PhaseGlyph: View {
    let phase: CodeplaneActivityAttributes.State.Phase

    var body: some View {
        switch phase {
        case .running:
            Circle()
                .fill(Color.codeplaneText)
                .frame(width: 7, height: 7)
                .padding(.top, 4)
        case .queued:
            Circle()
                .stroke(Color.codeplaneTextMuted, lineWidth: 1)
                .frame(width: 7, height: 7)
                .padding(.top, 4)
        case .completed:
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.codeplaneText)
                .frame(width: 7, height: 7)
                .padding(.top, 3)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.codeplaneFailure)
                .frame(width: 7, height: 7)
                .padding(.top, 3)
        }
    }
}

// MARK: - meta label (turns + elapsed)

@available(iOS 16.2, *)
struct MetaLabel: View {
    let task: CodeplaneActivityAttributes.State.Task

    var body: some View {
        // Build a single-line, space-` · `-space joined meta string —
        // doing it as one Text composition keeps the dots vertically
        // aligned and lets SwiftUI truncate the whole line at once
        // instead of stranding a leading separator on a new row.
        let parts = collectParts()
        if parts.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 0) {
                ForEach(Array(parts.enumerated()), id: \.offset) { idx, content in
                    if idx > 0 {
                        Text(" · ")
                            .font(.system(size: 11))
                            .foregroundColor(.codeplaneTextMuted)
                    }
                    content
                }
            }
        }
    }

    private func collectParts() -> [AnyView] {
        var parts: [AnyView] = []
        if task.turns > 0 {
            parts.append(
                AnyView(
                    Text(turnsText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.codeplaneTextMuted)
                )
            )
        }
        parts.append(
            AnyView(ElapsedText(startedAt: task.startedAt, override: task.elapsedSeconds))
        )
        if task.queueDepth > 0 {
            parts.append(
                AnyView(
                    Text("\(task.queueDepth) queued")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.codeplaneTextMuted)
                )
            )
        }
        return parts
    }

    private var turnsText: String {
        task.turns == 1 ? "1 turn" : "\(task.turns) turns"
    }
}

// MARK: - elapsed timer

@available(iOS 16.2, *)
struct ElapsedText: View {
    let startedAt: String
    let override: Int?

    var body: some View {
        if let override {
            Text(formatSeconds(override))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.codeplaneTextMuted)
        } else if let start = ISO8601DateFormatter().date(from: startedAt) {
            // Auto-updating "in 2 minutes" style. ActivityKit re-renders
            // periodically without us having to push updates just to
            // bump the clock.
            Text(start, style: .timer)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.codeplaneTextMuted)
        } else {
            EmptyView()
        }
    }

    private func formatSeconds(_ s: Int) -> String {
        let m = s / 60
        let r = s % 60
        return String(format: "%d:%02d", m, r)
    }
}

// MARK: - progress

@available(iOS 16.2, *)
struct ProgressStrip: View {
    let progress: Double?

    var body: some View {
        HStack(spacing: 10) {
            if let progress {
                DeterminateBar(progress: progress)
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundColor(.codeplaneTextMuted)
                    .frame(width: 36, alignment: .trailing)
            } else {
                IndeterminateBar()
            }
        }
    }
}

@available(iOS 16.2, *)
struct DeterminateBar: View {
    let progress: Double // 0...1

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.codeplaneText.opacity(0.10))
                Capsule()
                    .fill(Color.codeplaneText.opacity(0.92))
                    .frame(width: max(2, geo.size.width * progress))
                    .animation(.easeInOut(duration: 0.4), value: progress)
            }
        }
        .frame(height: 4)
    }
}

@available(iOS 16.2, *)
struct IndeterminateBar: View {
    @State private var phase: CGFloat = 0

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.codeplaneText.opacity(0.10))
                Capsule()
                    .fill(Color.codeplaneText.opacity(0.78))
                    .frame(width: geo.size.width * 0.32)
                    .offset(x: -(geo.size.width * 0.32) + (geo.size.width * 1.32) * phase)
                    .animation(
                        .linear(duration: 1.6).repeatForever(autoreverses: false),
                        value: phase
                    )
            }
            .clipShape(Capsule())
            .onAppear { phase = 1 }
        }
        .frame(height: 4)
    }
}

// MARK: - brand mark

@available(iOS 16.2, *)
struct CodeplaneMark: View {
    var body: some View {
        // Same chevron the desktop logo uses (commits b809f468b +
        // e9ea36d08). Monochrome — the rounded background tile uses
        // the standard subtle surface tone the picker has.
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.codeplaneText.opacity(0.12))
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .heavy))
                .foregroundColor(.codeplaneText)
        }
    }
}
