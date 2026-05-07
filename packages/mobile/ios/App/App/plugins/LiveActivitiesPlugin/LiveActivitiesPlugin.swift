//  LiveActivitiesPlugin.swift
//
//  Custom Capacitor plugin bridging the JS `CodeplaneLiveActivities`
//  API in `packages/mobile/src/platform/live-activities.ts` to
//  ActivityKit. After running `bun run cap:add:ios`, drop this file
//  (and `LiveActivitiesPlugin.m`) into the iOS app target at
//  `ios/App/App/plugins/LiveActivitiesPlugin/` and add both to the
//  App target's Compile Sources.
//
//  The plugin must be added to the *App* target — NOT the widget
//  extension. Only the app process can call `Activity.request(...)`.
//
//  The widget extension consumes the shared
//  `CodeplaneActivityAttributes.swift` for its rendering.
//
//  Duo model — every activity carries a `primary` task plus an
//  optional `secondary` task. The JS `task-monitor` aggregates all
//  per-task events for an instance into one activity and re-selects
//  the top-2 (longest-running, most turns) on every update.

import Capacitor
import ActivityKit
import Foundation

@objc(CodeplaneLiveActivitiesPlugin)
public class CodeplaneLiveActivitiesPlugin: CAPPlugin {
    /// Maps Capacitor-facing activity IDs to live ActivityKit handles.
    /// We use the ActivityKit `id` directly so the JS side stays in sync.
    private var activities: [String: Any] = [:]
    private let queue = DispatchQueue(label: "ai.codeplane.live-activities", qos: .userInitiated)

    @objc public func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            let info = ActivityAuthorizationInfo()
            call.resolve([
                "supported": true,
                "enabled": info.areActivitiesEnabled
            ])
        } else {
            call.resolve([
                "supported": false,
                "enabled": false
            ])
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2+")
            return
        }
        guard
            let attrs = call.getObject("attributes"),
            let state = call.getObject("contentState"),
            let instanceId = attrs["instanceId"] as? String,
            let instanceLabel = attrs["instanceLabel"] as? String,
            let instanceHost = attrs["instanceHost"] as? String
        else {
            call.reject("Invalid attributes/contentState payload")
            return
        }

        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are disabled in Settings")
            return
        }

        guard let parsedState = decodeState(state) else {
            call.reject("Could not decode contentState")
            return
        }

        let attributes = CodeplaneActivityAttributes(
            instanceId: instanceId,
            instanceLabel: instanceLabel,
            instanceHost: instanceHost
        )

        // Stale-after hint — past this, ActivityKit dims the activity.
        // Defaults to 8 hours; the JS side can override per-task.
        let staleAfter = call.getInt("staleAfterSeconds") ?? (8 * 60 * 60)
        let staleDate = Date().addingTimeInterval(TimeInterval(staleAfter))

        do {
            let content = ActivityContent(state: parsedState, staleDate: staleDate)
            let activity = try Activity<CodeplaneActivityAttributes>.request(
                attributes: attributes,
                content: content,
                pushType: nil
            )
            queue.sync {
                self.activities[activity.id] = activity
            }
            call.resolve(["activityId": activity.id])
        } catch let error {
            call.reject("Could not start activity: \(error.localizedDescription)")
        }
    }

    @objc public func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["ok": false])
            return
        }
        guard
            let activityId = call.getString("activityId"),
            let state = call.getObject("contentState"),
            let parsedState = decodeState(state)
        else {
            call.resolve(["ok": false])
            return
        }

        let entry: Any? = queue.sync { activities[activityId] }
        guard let activity = entry as? Activity<CodeplaneActivityAttributes> else {
            call.resolve(["ok": false])
            return
        }

        let staleDate = Date().addingTimeInterval(TimeInterval(8 * 60 * 60))
        let content = ActivityContent(state: parsedState, staleDate: staleDate)

        Task {
            await activity.update(content)
            call.resolve(["ok": true])
        }
    }

    @objc public func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["ok": false])
            return
        }
        guard let activityId = call.getString("activityId") else {
            call.resolve(["ok": false])
            return
        }

        let entry: Any? = queue.sync { activities.removeValue(forKey: activityId) }
        guard let activity = entry as? Activity<CodeplaneActivityAttributes> else {
            call.resolve(["ok": false])
            return
        }

        let dismissalPolicy = parseDismissalPolicy(call)
        let final = call.getObject("finalContentState").flatMap { decodeState($0) }

        Task {
            if let final {
                let content = ActivityContent(
                    state: final,
                    staleDate: Date().addingTimeInterval(60)
                )
                await activity.end(content, dismissalPolicy: dismissalPolicy)
            } else {
                await activity.end(nil, dismissalPolicy: dismissalPolicy)
            }
            call.resolve(["ok": true])
        }
    }

    @objc public func list(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["activities": [Any]()])
            return
        }
        let snapshot = queue.sync { activities }
        var out: [[String: Any]] = []
        for (id, raw) in snapshot {
            guard let activity = raw as? Activity<CodeplaneActivityAttributes> else { continue }
            out.append([
                "activityId": id,
                "instanceId": activity.attributes.instanceId,
                "startedAt": activity.content.state.primary.startedAt
            ])
        }
        call.resolve(["activities": out])
    }

    @objc public func registerForUpdates(_ call: CAPPluginCall) {
        if #available(iOS 17.2, *) {
            // Push-driven updates need iOS 17.2+. The JS bridge accepts a
            // null token gracefully; we only reach here on supported OSes.
            Task {
                for try await tokenData in Activity<CodeplaneActivityAttributes>.pushToStartTokenUpdates {
                    let token = tokenData.map { String(format: "%02x", $0) }.joined()
                    self.notifyListeners("liveActivities:pushTokenUpdate", data: ["token": token])
                }
            }
        }
        call.resolve(["token": NSNull()])
    }

    // MARK: - decoding helpers

    @available(iOS 16.2, *)
    private func decodeState(_ raw: [String: Any]) -> CodeplaneActivityAttributes.State? {
        guard
            let primaryRaw = raw["primary"] as? [String: Any],
            let primary = decodeTask(primaryRaw)
        else {
            return nil
        }
        let secondary: CodeplaneActivityAttributes.State.Task? = {
            // `null` from JSON arrives as NSNull on the iOS bridge —
            // both produce nil after the cast.
            if let dict = raw["secondary"] as? [String: Any] {
                return decodeTask(dict)
            }
            return nil
        }()
        let totalActive = (raw["totalActive"] as? Int) ?? 1
        return CodeplaneActivityAttributes.State(
            primary: primary,
            secondary: secondary,
            totalActive: totalActive
        )
    }

    @available(iOS 16.2, *)
    private func decodeTask(_ raw: [String: Any]) -> CodeplaneActivityAttributes.State.Task? {
        guard
            let id = raw["id"] as? String,
            let phaseRaw = raw["phase"] as? String,
            let phase = CodeplaneActivityAttributes.State.Phase(rawValue: phaseRaw),
            let title = raw["title"] as? String,
            let queueDepth = raw["queueDepth"] as? Int,
            let startedAt = raw["startedAt"] as? String
        else {
            return nil
        }
        let progress = raw["progress"] as? Double
        let elapsedSeconds = raw["elapsedSeconds"] as? Int
        let turns = (raw["turns"] as? Int) ?? 0
        return CodeplaneActivityAttributes.State.Task(
            id: id,
            phase: phase,
            title: title,
            queueDepth: queueDepth,
            progress: progress,
            startedAt: startedAt,
            elapsedSeconds: elapsedSeconds,
            turns: turns
        )
    }

    @available(iOS 16.2, *)
    private func parseDismissalPolicy(_ call: CAPPluginCall) -> ActivityUIDismissalPolicy {
        // The JS side sends either a string ("default" / "immediate") or
        // an object {afterSeconds: Number}. Capacitor unwraps both as
        // ordinary getString / getObject calls.
        if let str = call.getString("dismissalPolicy") {
            switch str {
            case "immediate": return .immediate
            default: return .default
            }
        }
        if let obj = call.getObject("dismissalPolicy"), let after = obj["afterSeconds"] as? Double {
            return .after(Date().addingTimeInterval(after))
        }
        return .default
    }
}
