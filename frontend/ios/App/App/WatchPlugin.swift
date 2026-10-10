import Foundation
import Capacitor
import UIKit
import WatchConnectivity

/**
 * The iPhone side of the Apple Watch app (ios/App/OpenGymWatch). The watch keeps no log: the
 * running workout reaches it as one JSON snapshot (lib/watch-model.js), sent whenever it changes
 * (lib/watch-sync.js), and the watch answers with an action — a set done with its reps and
 * weight, or the rest skipped, lengthened, held or carried on — which goes to JS as an "action"
 * event. "hello" is the watch app asking for the snapshot again.
 *
 * The snapshot goes as the application context, which the watch reads even when it was not
 * running, and as a message too while the watch app is in front, which is faster. An action comes
 * as a message while both are awake, else as a queued user-info transfer the phone gets once it
 * runs. A message wakes this app in the background; a background task gives the page the moment
 * it needs to tick the set and send the next snapshot back.
 *
 * Usage from JS (lib/watch-sync.js):
 *   const W = registerPlugin('Watch');
 *   await W.update({ snapshot: '{…}' });
 *   await W.status();   // { supported, paired, installed, reachable }
 *   W.addListener('action', a => …); W.addListener('hello', () => …);
 */
@objc(WatchPlugin)
public class WatchPlugin: CAPPlugin, WCSessionDelegate {

    private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }
    private var lastSnapshot: String?

    override public func load() {
        guard let s = session else { return }
        s.delegate = self
        s.activate()
    }

    @objc func update(_ call: CAPPluginCall) {
        guard let json = call.getString("snapshot") else {
            call.reject("snapshot is required")
            return
        }
        lastSnapshot = json
        call.resolve(["sent": push(json)])
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let s = session, s.activationState == .activated else {
            call.resolve(["supported": session != nil, "paired": false, "installed": false, "reachable": false])
            return
        }
        call.resolve(["supported": true, "paired": s.isPaired, "installed": s.isWatchAppInstalled, "reachable": s.isReachable])
    }

    @discardableResult
    private func push(_ json: String) -> Bool {
        guard let s = session, s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { return false }
        try? s.updateApplicationContext(["snapshot": json])
        if s.isReachable { s.sendMessage(["snapshot": json], replyHandler: nil, errorHandler: nil) }
        return true
    }

    // MARK: - WCSessionDelegate

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // A snapshot that came from JS before the session was up goes now.
        if activationState == .activated, let json = lastSnapshot { push(json) }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    // The user switched to another watch: start again with that one.
    public func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forward(message)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        forward(message)
        replyHandler(["ok": true])
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forward(userInfo)
    }

    private func forward(_ message: [String: Any]) {
        keepAwake()
        if message["hello"] != nil {
            notifyListeners("hello", data: [:])
            return
        }
        guard let action = message["action"] as? [String: Any] else { return }
        // Only plain values cross to JS; lib/watch-model.js readWatchAction checks each one.
        var data: [String: Any] = [:]
        for (key, value) in action where value is String || value is NSNumber {
            data[key] = value
        }
        notifyListeners("action", data: data, retainUntilConsumed: true)
    }

    // A message can wake this app in the background, where it would be suspended again before the
    // page ticked the set. Twenty seconds are plenty for that and the snapshot after it.
    private func keepAwake() {
        DispatchQueue.main.async {
            var task: UIBackgroundTaskIdentifier = .invalid
            let end = {
                if task != .invalid {
                    UIApplication.shared.endBackgroundTask(task)
                    task = .invalid
                }
            }
            task = UIApplication.shared.beginBackgroundTask(withName: "openGym watch action", expirationHandler: end)
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: end)
        }
    }
}
