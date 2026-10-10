import Foundation
import WatchConnectivity

// The watch's end of the link to the iPhone app (WatchPlugin.swift there). It holds the latest
// snapshot and sends actions back: as a message while the phone is in reach, else as a queued
// transfer the phone gets once it runs again.
final class PhoneLink: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = PhoneLink()

    @Published private(set) var snapshot: Snapshot?
    // An action is on its way and no snapshot has answered it yet.
    @Published private(set) var waiting = false

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func send(_ action: [String: Any]) {
        let s = WCSession.default
        guard s.activationState == .activated else { return }
        waiting = true
        if s.isReachable {
            s.sendMessage(["action": action], replyHandler: nil) { _ in
                s.transferUserInfo(["action": action])
            }
        } else {
            s.transferUserInfo(["action": action])
        }
    }

    // Asks the phone for the snapshot again: the app opened, or the phone came back in reach.
    func hello() {
        let s = WCSession.default
        guard s.activationState == .activated, s.isReachable else { return }
        s.sendMessage(["hello": true], replyHandler: nil, errorHandler: nil)
    }

    private func take(_ payload: [String: Any]) {
        guard let json = payload["snapshot"] as? String, let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            self.waiting = false
            if snap != self.snapshot { self.snapshot = snap }
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        take(session.receivedApplicationContext)
        hello()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        if session.isReachable { hello() }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        take(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        take(message)
    }
}
