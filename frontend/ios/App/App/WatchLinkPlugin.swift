import Foundation
import Capacitor
import HealthKit
import WatchConnectivity
import os

/**
 * The phone's end of the link to the openGym watch app (frontend/ios/App/OpenGymWatch). The
 * workout's start and end go as messages when the watch app is reachable and as userInfo
 * transfers otherwise, the rest timer and the current set as the application context, where only
 * the latest counts: both are kept here and always sent together, so one never clobbers the other.
 * Starting also launches the watch app through HealthKit, so the session starts without the user
 * opening it.
 *
 * Usage from JS (lib/watch-link.js):
 *   const W = registerPlugin('WatchLink');
 *   await W.status();                          // { supported, paired, appInstalled, reachable }
 *   await W.startSession({ id, name, start }); // { sent: 'message' | 'transfer' }
 *   await W.endSession({ id, end, discard });  // { sent: 'message' | 'transfer' }
 *   await W.rest({ endsAt, total, paused, left, ready }); // ready: heart rate back down (lib/hr-readiness.js)
 *   await W.clearRest();
 *   await W.set({ id, entryId, name, idx, i, setNo, setCount, warmup, mode, w, r, unit, each, inc, nextName });
 *   await W.clearSet();
 *   W.addListener('heartRate' | 'watchState' | 'restAction' | 'reachability' | 'setDone', cb);
 */
@objc(WatchLinkPlugin)
public class WatchLinkPlugin: CAPPlugin, WCSessionDelegate {

    private let log = Logger(subsystem: "ch.duartesantos.opengym", category: "WatchLink")
    private let healthStore = HKHealthStore()
    // WCSession is only usable once activated; what comes before that waits here.
    private let queue = DispatchQueue(label: "ch.duartesantos.opengym.watchlink")
    private var waiting: [(WCSession) -> Void] = []
    // The last rest and set sent, only touched on `queue`: the context is always both.
    private var lastRest: [String: Any]?
    private var lastSet: [String: Any]?

    override public func load() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    @objc func status(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve(["supported": false, "paired": false, "appInstalled": false, "reachable": false])
            return
        }
        withSession { session in
            call.resolve([
                "supported": true,
                "paired": session.isPaired,
                "appInstalled": session.isWatchAppInstalled,
                "reachable": session.isReachable,
            ])
        }
    }

    @objc func startSession(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty, let start = call.getDouble("start"), start > 0 else {
            call.reject("id and start are required", "failed")
            return
        }
        let payload: [String: Any] = ["type": "start", "id": id, "name": call.getString("name") ?? "", "start": start]
        launchWatchApp()
        send(payload, call)
    }

    @objc func endSession(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("id is required", "failed")
            return
        }
        let end = call.getDouble("end") ?? Date().timeIntervalSince1970 * 1000
        let payload: [String: Any] = ["type": "end", "id": id, "end": end, "discard": call.getBool("discard") ?? false]
        send(payload, call)
    }

    @objc func rest(_ call: CAPPluginCall) {
        var rest: [String: Any] = [
            "total": call.getInt("total") ?? 0,
            "paused": call.getBool("paused") ?? false,
            "left": call.getInt("left") ?? 0,
            "ready": call.getBool("ready") ?? false,
            "at": Self.now(),
        ]
        if let endsAt = call.getDouble("endsAt") { rest["endsAt"] = endsAt }
        updateContext(rest: rest, call)
    }

    // NSNull is not a property-list type and the context refuses it: a clear is its own record.
    @objc func clearRest(_ call: CAPPluginCall) {
        updateContext(rest: ["cleared": true, "at": Self.now()], call)
    }

    /// The set to log on the wrist (lib/watch-set.js).
    @objc func set(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let entryId = call.getString("entryId"),
              let idx = call.getInt("idx"), let i = call.getInt("i") else {
            call.reject("id, entryId, idx and i are required", "failed")
            return
        }
        var set: [String: Any] = [
            "id": id, "entryId": entryId, "name": call.getString("name") ?? "",
            "idx": idx, "i": i,
            "setNo": call.getInt("setNo") ?? 1, "setCount": call.getInt("setCount") ?? 1,
            "warmup": call.getBool("warmup") ?? false, "mode": call.getString("mode") ?? "reps",
            "w": call.getDouble("w") ?? 0, "r": call.getInt("r") ?? 0,
            "unit": call.getString("unit") ?? "kg", "each": call.getBool("each") ?? false,
            "inc": call.getDouble("inc") ?? 2.5,
            "at": Self.now(),
        ]
        if let next = call.getString("nextName") { set["nextName"] = next }
        updateContext(set: set, call)
    }

    @objc func clearSet(_ call: CAPPluginCall) {
        updateContext(set: ["cleared": true, "at": Self.now()], call)
    }

    // MARK: - Sending

    private func send(_ payload: [String: Any], _ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.reject("Apple Watch is not supported on this device", "unavailable")
            return
        }
        withSession { [log] session in
            guard session.isPaired, session.isWatchAppInstalled else {
                call.reject("The watch app is not installed", "unavailable")
                return
            }
            guard session.isReachable else {
                session.transferUserInfo(payload)
                call.resolve(["sent": "transfer"])
                return
            }
            session.sendMessage(payload, replyHandler: nil) { error in
                // Not reachable after all: the transfer is delivered once the watch app runs.
                log.info("Message failed, transferring: \(error.localizedDescription, privacy: .public)")
                session.transferUserInfo(payload)
            }
            call.resolve(["sent": "message"])
        }
    }

    private func updateContext(rest: [String: Any]? = nil, set: [String: Any]? = nil, _ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.reject("Apple Watch is not supported on this device", "unavailable")
            return
        }
        withSession { [log] session in
            if let rest { self.lastRest = rest }
            if let set { self.lastSet = set }
            var context: [String: Any] = [:]
            if let rest = self.lastRest { context["rest"] = rest }
            if let set = self.lastSet { context["set"] = set }
            guard session.isPaired, session.isWatchAppInstalled else {
                call.resolve()
                return
            }
            do {
                try session.updateApplicationContext(context)
                call.resolve()
            } catch {
                log.error("Context not updated: \(error.localizedDescription, privacy: .public)")
                call.reject(error.localizedDescription, "failed", error)
            }
        }
    }

    /// Wakes the watch app into the foreground for the workout; the start message names it.
    private func launchWatchApp() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        healthStore.startWatchApp(with: config) { [log] _, error in
            if let error = error {
                log.info("Watch app not launched: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func withSession(_ body: @escaping (WCSession) -> Void) {
        queue.async {
            let session = WCSession.default
            if session.activationState == .activated {
                body(session)
            } else {
                self.waiting.append(body)
                if session.activationState == .notActivated, session.delegate != nil { session.activate() }
            }
        }
    }

    private static func now() -> Double {
        (Date().timeIntervalSince1970 * 1000).rounded()
    }

    // MARK: - WCSessionDelegate

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                        error: Error?) {
        if let error = error {
            log.error("Activation failed: \(error.localizedDescription, privacy: .public)")
        }
        queue.async {
            let ready = self.waiting
            self.waiting = []
            for body in ready { body(session) }
        }
        notifyReachability(session)
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    // The user switched watches: activate again for the new one.
    public func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        notifyReachability(session)
    }

    public func sessionWatchStateDidChange(_ session: WCSession) {
        notifyReachability(session)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        receive(userInfo)
    }

    private func receive(_ payload: [String: Any]) {
        switch payload["type"] as? String {
        case "hr":
            guard let bpm = (payload["bpm"] as? NSNumber)?.intValue else { return }
            let t = (payload["t"] as? NSNumber)?.doubleValue ?? Self.now()
            notifyListeners("heartRate", data: ["bpm": bpm, "t": t], retainUntilConsumed: true)
        case "state":
            guard let state = payload["state"] as? String, let id = payload["id"] as? String else { return }
            var data: JSObject = ["state": state, "id": id]
            if let error = payload["error"] as? String { data["error"] = error }
            notifyListeners("watchState", data: data, retainUntilConsumed: true)
        case "rest":
            guard let action = payload["action"] as? String, action == "add15" || action == "skip" else { return }
            notifyListeners("restAction", data: ["action": action])
        case "set":
            guard payload["action"] as? String == "done", let id = payload["id"] as? String,
                  let entryId = payload["entryId"] as? String,
                  let idx = (payload["idx"] as? NSNumber)?.intValue, let i = (payload["i"] as? NSNumber)?.intValue else { return }
            var data: JSObject = ["id": id, "entryId": entryId, "idx": idx, "i": i,
                                  "at": (payload["at"] as? NSNumber)?.doubleValue ?? Self.now()]
            if let w = (payload["w"] as? NSNumber)?.doubleValue { data["w"] = w }
            if let r = (payload["r"] as? NSNumber)?.intValue { data["r"] = r }
            // Kept until JS listens: a set logged while the phone app slept is not lost.
            notifyListeners("setDone", data: data, retainUntilConsumed: true)
        default:
            log.info("Ignored a message from the watch")
        }
    }

    private func notifyReachability(_ session: WCSession) {
        let paired = session.activationState == .activated && session.isPaired
        notifyListeners("reachability", data: [
            "reachable": paired && session.isReachable,
            "appInstalled": paired && session.isWatchAppInstalled,
        ])
    }
}
