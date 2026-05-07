//  CodeplaneActivityAttributes.swift
//
//  This file is shared between the App target and the Widget Extension
//  target. After running `bun run cap:add:ios`, copy it into the iOS
//  project at `ios/App/Shared/CodeplaneActivityAttributes.swift` and
//  add it to BOTH the `App` target and the
//  `CodeplaneLiveActivityWidget` target's Compile Sources phase. The
//  shared file is what lets the JS side pass an `ActivityAttributes`-
//  shaped payload that decodes into the same Swift type the widget
//  renders.
//
//  Keep the field names + Codable shape in sync with
//  `LiveActivityAttributes`, `LiveActivityTask`, and
//  `LiveActivityContentState` in
//  `packages/mobile/src/platform/live-activities.ts` — the JSON
//  encoder on the JS side and the Codable decoder here are what
//  handshake.
//
//  Duo model — one Activity per Codeplane *instance*, with up to two
//  tasks visible at once on the Lock Screen / Dynamic Island. The
//  task-monitor selects the top-2 by (longest-running, then most
//  turns); anything past the top 2 is folded into `totalActive` for a
//  "+N more" indicator.

import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct CodeplaneActivityAttributes: ActivityAttributes {
    public typealias ContentState = State

    /// Stable identifier set by JS. One activity per Codeplane
    /// instance, regardless of how many tasks are running there.
    public let instanceId: String
    /// User-facing label of the Codeplane instance, e.g. "Production".
    public let instanceLabel: String
    /// Hostname displayed under the label on the Lock Screen.
    public let instanceHost: String

    public init(instanceId: String, instanceLabel: String, instanceHost: String) {
        self.instanceId = instanceId
        self.instanceLabel = instanceLabel
        self.instanceHost = instanceHost
    }

    public struct State: Codable, Hashable {
        public enum Phase: String, Codable, Hashable {
            case queued
            case running
            case completed
            case failed
        }

        public struct Task: Codable, Hashable {
            /// Stable identifier for this task within its instance.
            public let id: String
            public let phase: Phase
            /// Single-line preview of the message being processed.
            public let title: String
            /// Number of messages still queued behind this one.
            public let queueDepth: Int
            /// 0...1 if known; nil hides the bar in the widget.
            public let progress: Double?
            /// ISO timestamp of when the task started.
            public let startedAt: String
            /// Optional server-authoritative elapsed-seconds override.
            public let elapsedSeconds: Int?
            /// Number of turns / messages in the session.
            public let turns: Int

            public init(
                id: String,
                phase: Phase,
                title: String,
                queueDepth: Int,
                progress: Double?,
                startedAt: String,
                elapsedSeconds: Int? = nil,
                turns: Int = 0
            ) {
                self.id = id
                self.phase = phase
                self.title = title
                self.queueDepth = max(0, queueDepth)
                self.progress = progress.map { min(1, max(0, $0)) }
                self.startedAt = startedAt
                self.elapsedSeconds = elapsedSeconds.map { max(0, $0) }
                self.turns = max(0, turns)
            }
        }

        /// The task being shown most prominently. Always present
        /// while the activity exists.
        public let primary: Task
        /// Optional second task for the duo layout. `nil` collapses
        /// to single-row layout.
        public let secondary: Task?
        /// Total tasks currently active (running + queued) for this
        /// instance. Drives the "+N more" indicator when this exceeds 2.
        public let totalActive: Int

        public init(primary: Task, secondary: Task? = nil, totalActive: Int = 1) {
            self.primary = primary
            self.secondary = secondary
            self.totalActive = max(1, totalActive)
        }

        /// Convenience: how many tasks the user can't see right now.
        public var hiddenActive: Int {
            let visible = secondary == nil ? 1 : 2
            return max(0, totalActive - visible)
        }
    }
}
