import Foundation
import WatchConnectivity
import os

/// The watch's end of WatchConnectivity. Start and end come by message when the watch app is
/// reachable and by userInfo transfer otherwise, the rest timer and the current set by application
/// context; all of them go through `deliver`. Everything sent back is a message, with state changes
/// and logged sets falling back to a transfer so an `ended` or a set always reaches the phone.
@MainActor
final class ConnectivityManager: NSObject {

    var onMessage: ((PhoneMessage) -> Void)?

    private static let heartRateInterval: TimeInterval = 2
    private nonisolated static let log = Logger(subsystem: "ch.duartesantos.opengym.watchkitapp", category: "Connectivity")
    private var lastHeartRateSent = Date.distantPast

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// At most one every two seconds; a dropped one is replaced by the next reading anyway.
    func sendHeartRate(_ bpm: Int) {
        let now = Date()
        guard now.timeIntervalSince(lastHeartRateSent) >= Self.heartRateInterval,
              let session = activeSession, session.isReachable else { return }
        lastHeartRateSent = now
        session.sendMessage(["type": "hr", "bpm": bpm, "t": now.millis], replyHandler: nil) { error in
            Self.log.debug("Heart rate not sent: \(error.localizedDescription, privacy: .public)")
        }
    }

    func sendState(_ state: String, id: String, error: String? = nil) {
        var payload: [String: Any] = ["type": "state", "state": state, "id": id]
        if let error { payload["error"] = error }
        sendReliably(payload)
    }

    func sendRestAction(_ action: String) {
        guard let session = activeSession, session.isReachable else { return }
        session.sendMessage(["type": "rest", "action": action], replyHandler: nil) { error in
            Self.log.error("Rest action not sent: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Completed on the wrist: reliable, since the phone may be asleep and the set must not be lost.
    func sendSetDone(_ set: SetState, weight: Double, reps: Int, at: Date) {
        sendReliably([
            "type": "set", "action": "done", "id": set.workoutId, "entryId": set.entryId,
            "idx": set.idx, "i": set.i, "w": weight, "r": reps, "at": at.millis,
        ])
    }

    private var activeSession: WCSession? {
        guard WCSession.isSupported() else { return nil }
        let session = WCSession.default
        return session.activationState == .activated ? session : nil
    }

    private func sendReliably(_ payload: [String: Any]) {
        guard let session = activeSession else { return }
        guard session.isReachable else {
            session.transferUserInfo(payload)
            return
        }
        // Sendable copy for the error handler, which runs off the main actor.
        let fallback = PlistBox(payload)
        session.sendMessage(payload, replyHandler: nil) { error in
            Self.log.info("Message failed, transferring instead: \(error.localizedDescription, privacy: .public)")
            WCSession.default.transferUserInfo(fallback.value)
        }
    }

    private func handle(_ messages: [PhoneMessage]) {
        messages.forEach { onMessage?($0) }
    }
}

/// A property-list dictionary handed across queues; WatchConnectivity only ever reads it.
private struct PlistBox: @unchecked Sendable {
    let value: [String: Any]
    init(_ value: [String: Any]) { self.value = value }
}

extension ConnectivityManager: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                             error: Error?) {
        if let error {
            Self.log.error("Activation failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        // The rest the phone set while this app was not running.
        deliver(session.receivedApplicationContext)
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        deliver(message)
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        deliver(userInfo)
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        deliver(applicationContext)
    }

    private nonisolated func deliver(_ payload: [String: Any]) {
        let messages = PhoneMessage.parseAll(payload)
        Task { @MainActor in self.handle(messages) }
    }
}
