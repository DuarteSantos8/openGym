import ActivityKit
import Capacitor
import Foundation
import UIKit

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
        // `island`: whether this iPhone has a Dynamic Island, so Settings previews only what the
        // phone can show (an iPhone without one shows the activity on the Lock Screen and as a
        // banner). Read on the main thread, where the window's safe area lives.
        DispatchQueue.main.async {
            let island = LiveActivityPlugin.hasDynamicIsland()
            if #available(iOS 17.0, *) {
                call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled, "island": island])
            } else {
                call.resolve(["supported": false, "island": island])
            }
        }
    }

    /// The iPhones with a Dynamic Island by model identifier (14 Pro and later; the 16e has a notch).
    static let islandModels: Set<String> = [
        "iPhone15,2", "iPhone15,3",               // 14 Pro, 14 Pro Max
        "iPhone15,4", "iPhone15,5",               // 15, 15 Plus
        "iPhone16,1", "iPhone16,2",               // 15 Pro, 15 Pro Max
        "iPhone17,1", "iPhone17,2", "iPhone17,3", "iPhone17,4", // 16 Pro, 16 Pro Max, 16, 16 Plus
    ]
    static let notchModels: Set<String> = ["iPhone17,5"]   // 16e

    /// Whether this device has a Dynamic Island: by its model when the model is known, else by the
    /// top safe area (59 points or more only on an island iPhone in portrait). Unknown: no.
    static func hasDynamicIsland() -> Bool {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return false }
        var sys = utsname()
        uname(&sys)
        let machine = withUnsafeBytes(of: &sys.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        if islandModels.contains(model) { return true }
        if notchModels.contains(model) { return false }
        // iPhone14,x and before (up to the 14 and 14 Plus): never an island.
        if model.hasPrefix("iPhone"), let major = Int(model.dropFirst(6).split(separator: ",").first ?? ""), major <= 14 {
            return false
        }
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        guard let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first,
              window.bounds.height > window.bounds.width else { return false }
        return window.safeAreaInsets.top >= 59
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
        // The live widget's stills (LIVE_VERSION 3): copied small into the App Group, where the
        // widget extension draws them from. The 180 px still the app ships, never an animation.
        let stills = ([state.cur] + state.ahead.map { Optional($0) } + (state.unitStarts ?? []).map { Optional($0) }).compactMap { $0?.img }
        if !stills.isEmpty { LiveStills.prepare(stills) }
        // The ids of the taps the page had drained when it built this state (lib/live-activity.js
        // send). Nil from Settings' "Try it" and from a page before this: then nothing is checked.
        let seen = (call.getArray("seen") as? [String]).map { Set($0) }
        Task {
            let content = ActivityContent(state: state, staleDate: nil)
            let all = Activity<WorkoutActivityAttributes>.activities
            // Another workout's activity (a session that ended while the app was gone) goes first.
            for other in all where other.attributes.wid != attributes.wid {
                await other.end(nil, dismissalPolicy: .immediate)
            }
            if let mine = all.first(where: { $0.attributes.wid == attributes.wid && $0.activityState == .active }) {
                // This state's turn, for a button only the page can draw that waits for its answer
                // (WorkoutActivity.swift LiveAnswer). Counted before the check below, and such a
                // button reads the count after it queued its tap: a state counted later than that
                // meets the tap in the check, so it has the tap in it or is turned down and never
                // said to be drawn.
                let turn = LiveAnswer.took(wid: attributes.wid)
                // A button was tapped after the page drained: the activity already shows that tap,
                // and this state is from before it. Drawing it would put the logged set back for a
                // moment. The page drains, applies and sends again.
                if let seen = seen, LiveActivityQueue.hasUnseen(wid: attributes.wid, seen: seen) {
                    call.resolve(["shown": true, "stale": true])
                    return
                }
                // The page agrees with what a button already drew: no second update, no second
                // animation, and one update less against iOS's budget.
                if mine.content.state == state {
                    LiveAnswer.drew(wid: attributes.wid, turn: turn)
                    call.resolve(["shown": true])
                    return
                }
                await mine.update(content)
                LiveAnswer.drew(wid: attributes.wid, turn: turn)
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
        // The page is up and listening: a button only it can draw may wait for its answer.
        LiveAnswer.pageAsked()
        call.resolve(["events": LiveActivityQueue.all()])
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        LiveActivityQueue.remove(ids: Set(ids))
        call.resolve()
    }
}
