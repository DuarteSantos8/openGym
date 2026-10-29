import ActivityKit
import Capacitor
import Foundation

/**
 * The running workout's Live Activity, for the page (lib/live-activity.js). The page sends the
 * whole activity whenever it changes; this starts it for a new workout, updates it for the same
 * one, and ends it with the workout. Its buttons' taps (WorkoutActivity.swift: Log set, Next
 * exercise, Skip rest) wait in LiveActivityQueue until the page drains and acknowledges them; a "liveActivityEvent"
 * tells a page that is awake that one came in.
 *
 * iOS 17 and later (the interactive Done button); earlier, status says unsupported and the page
 * sends nothing.
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(queued), name: LiveActivityQueue.didChange, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func queued() {
        notifyListeners("liveActivityEvent", data: [:])
    }

    @objc func status(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(["shown": false]); return }
        let decoder = JSONDecoder()
        guard let a = call.getString("attributes")?.data(using: .utf8),
              let s = call.getString("state")?.data(using: .utf8),
              let attributes = try? decoder.decode(WorkoutActivityAttributes.self, from: a),
              let state = try? decoder.decode(WorkoutActivityAttributes.ContentState.self, from: s) else {
            call.reject("attributes and state are required")
            return
        }
        Task {
            let content = ActivityContent(state: state, staleDate: nil)
            let all = Activity<WorkoutActivityAttributes>.activities
            // Another workout's activity (a session that ended while the app was gone) goes first.
            for other in all where other.attributes.wid != attributes.wid {
                await other.end(nil, dismissalPolicy: .immediate)
            }
            if let mine = all.first(where: { $0.attributes.wid == attributes.wid && $0.activityState == .active }) {
                await mine.update(content)
                call.resolve(["shown": true])
                return
            }
            do {
                _ = try Activity.request(attributes: attributes, content: content, pushType: nil)
                call.resolve(["shown": true])
            } catch {
                // Switched off in Settings, or the app is not in front: the next change tries again.
                call.resolve(["shown": false])
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else { call.resolve(); return }
        Task {
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @objc func drain(_ call: CAPPluginCall) {
        call.resolve(["events": LiveActivityQueue.all()])
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        LiveActivityQueue.remove(ids: Set(ids))
        call.resolve()
    }
}
