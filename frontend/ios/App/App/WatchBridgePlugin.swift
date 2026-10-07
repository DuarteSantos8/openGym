import Foundation
import Capacitor
import WatchConnectivity
import HealthKit
import UserNotifications
import UIKit
import CryptoKit

@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, WCSessionDelegate {
    private let queueKey = "openGym.watch.commands"
    private let notifiedKey = "openGym.watch.notifiedStarts"
    private let health = HKHealthStore()
    private let thumbnailKeysKey = "openGym.watch.thumbnailKeys"
    private var loadingThumbnails: Set<String> = []

    private func thumbnailURL(_ key: String) -> URL {
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WatchThumbnails").appendingPathComponent(name + ".jpg")
    }

    @objc func missingThumbnails(_ call: CAPPluginCall) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else {
            call.resolve(["missing": []]); return
        }
        let acknowledged = Set(UserDefaults.standard.stringArray(forKey: thumbnailKeysKey) ?? [])
        let queued = Set(WCSession.default.outstandingFileTransfers.compactMap { $0.file.metadata?["thumbnailKey"] as? String })
        let keys = call.getArray("keys", String.self) ?? []
        call.resolve(["missing": keys.filter { !acknowledged.contains($0) && !queued.contains($0) && !loadingThumbnails.contains($0) }])
    }

    @objc func sendThumbnail(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), key.count <= 2048, !key.isEmpty,
              WCSession.isSupported(), WCSession.default.activationState == .activated else {
            call.reject("Thumbnail unavailable"); return
        }
        let destination = thumbnailURL(key)
        if FileManager.default.fileExists(atPath: destination.path) {
            WCSession.default.transferFile(destination, metadata: ["thumbnailKey": key])
            call.resolve(); return
        }
        let save: (Data?) -> Void = { data in
            guard let data, data.count <= 5 * 1024 * 1024, let image = UIImage(data: data),
                  image.size.width > 0, image.size.height > 0 else {
                DispatchQueue.main.async { self.loadingThumbnails.remove(key); call.reject("Thumbnail unavailable") }
                return
            }
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            format.opaque = true
            let bytes = UIGraphicsImageRenderer(size: CGSize(width: 96, height: 96), format: format).jpegData(withCompressionQuality: 0.8) { context in
                UIColor.white.setFill()
                context.fill(CGRect(x: 0, y: 0, width: 96, height: 96))
                let scale = min(96 / image.size.width, 96 / image.size.height)
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: (96 - size.width) / 2, y: (96 - size.height) / 2, width: size.width, height: size.height))
            }
            do {
                try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                try bytes.write(to: destination, options: .atomic)
                DispatchQueue.main.async {
                    self.loadingThumbnails.remove(key)
                    WCSession.default.transferFile(destination, metadata: ["thumbnailKey": key])
                    call.resolve()
                }
            } catch {
                DispatchQueue.main.async { self.loadingThumbnails.remove(key); call.reject(error.localizedDescription) }
            }
        }
        loadingThumbnails.insert(key)
        if let encoded = call.getString("data"), encoded.count <= 65536 {
            DispatchQueue.global(qos: .utility).async { save(Data(base64Encoded: encoded)) }
        } else if let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" {
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            URLSession.shared.dataTask(with: request) { data, response, _ in
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                save((200..<300).contains(status) ? data : nil)
            }.resume()
        } else { loadingThumbnails.remove(key); call.reject("Thumbnail unavailable") }
    }

    public override func load() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    @objc func publish(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else { call.resolve(["supported": false]); return }
        let state = call.getObject("state") ?? [:]
        UserDefaults.standard.set(state["profile"], forKey: "openGym.watch.profile")
        do {
            try WCSession.default.updateApplicationContext(state)
            call.resolve(["supported": true])
        } catch { call.reject(error.localizedDescription) }
    }

    @objc func drain(_ call: CAPPluginCall) {
        let commands = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
        call.resolve(["commands": commands])
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = Set(call.getArray("ids", String.self) ?? [])
        let commands = UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
        UserDefaults.standard.set(commands.filter { !ids.contains($0["id"] as? String ?? "") }, forKey: queueKey)
        call.resolve()
    }

    @objc func launchWorkout(_ call: CAPPluginCall) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else {
            call.resolve(["launched": false]); return
        }
        if WCSession.default.isReachable { call.resolve(["launched": true]); return }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        health.startWatchApp(with: configuration) { success, error in
            if let error { call.reject(error.localizedDescription) }
            else { call.resolve(["launched": success]) }
        }
    }

    @objc func prepareNotifications(_ call: CAPPluginCall) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isPaired, WCSession.default.isWatchAppInstalled else {
            call.resolve(["available": false]); return
        }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { allowed, _ in
            call.resolve(["available": allowed])
        }
    }

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        receive(message)
        replyHandler(["queued": true])
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { receive(message) }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) { receive(userInfo) }

    public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        receive(applicationContext)
    }

    private func receive(_ message: [String: Any]) {
        if let key = message["thumbnailReceived"] as? String {
            DispatchQueue.main.async {
                var keys = UserDefaults.standard.stringArray(forKey: self.thumbnailKeysKey) ?? []
                if !keys.contains(key) { keys.append(key) }
                UserDefaults.standard.set(Array(keys.suffix(2000)), forKey: self.thumbnailKeysKey)
            }
            return
        }
        let payload = message["watchSession"] as? [String: Any]
        let action = payload == nil ? message["action"] as? String : "syncSession"
        guard let action, ["syncSession", "completeSet", "skipRest", "addRest", "pauseRest", "resumeRest"].contains(action) else { return }
        let command: [String: Any]
        if let payload {
            let sessionId = payload["id"] as? String ?? ""
            let seq = payload["seq"] as? Int ?? 0
            guard !sessionId.isEmpty else { return }
            command = ["action": "syncSession", "session": payload, "id": "\(sessionId):\(seq)"]
        } else {
            command = ["action": action, "sessionId": message["sessionId"] ?? "", "entry": message["entry"] ?? -1, "set": message["set"] ?? -1, "id": message["id"] ?? UUID().uuidString]
        }
        DispatchQueue.main.async {
            var queue = UserDefaults.standard.array(forKey: self.queueKey) as? [[String: Any]] ?? []
            guard !queue.contains(where: { ($0["id"] as? String) == (command["id"] as? String) }) else { return }
            if action == "syncSession", let payload {
                let sessionId = payload["id"] as? String ?? ""
                let seq = payload["seq"] as? Int ?? 0
                queue.removeAll { old in
                    guard old["action"] as? String == "syncSession",
                          let previous = old["session"] as? [String: Any],
                          previous["id"] as? String == sessionId else { return false }
                    return (previous["seq"] as? Int ?? 0) <= seq
                }
                if queue.contains(where: { old in
                    guard old["action"] as? String == "syncSession",
                          let previous = old["session"] as? [String: Any] else { return false }
                    return previous["id"] as? String == sessionId && (previous["seq"] as? Int ?? 0) > seq
                }) { return }
            }
            queue.append(command)
            if queue.count > 100 { queue.removeFirst(queue.count - 100) }
            UserDefaults.standard.set(queue, forKey: self.queueKey)
            self.notifyListeners("watchCommand", data: [:])
            if action == "syncSession", let payload,
               payload["startedOnWatch"] as? Bool == true, payload["finished"] as? Bool != true,
               payload["discarded"] as? Bool != true,
               payload["profile"] as? String == UserDefaults.standard.string(forKey: "openGym.watch.profile"),
               UIApplication.shared.applicationState != .active {
                self.notifyWorkoutStarted(payload["id"] as? String ?? "")
            }
        }
    }

    private func notifyWorkoutStarted(_ id: String) {
        guard !id.isEmpty else { return }
        var notified = UserDefaults.standard.stringArray(forKey: notifiedKey) ?? []
        guard !notified.contains(id) else { return }
        notified.append(id)
        UserDefaults.standard.set(Array(notified.suffix(30)), forKey: notifiedKey)
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let content = UNMutableNotificationContent()
            content.title = "Workout started on Apple Watch"
            content.body = "Tap to open it in openGym."
            content.sound = .default
            content.userInfo = ["watchSessionId": id]
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "openGym.watch.\(id)", content: content, trigger: nil))
        }
    }
}
