import SwiftUI
import Combine
import WatchConnectivity
import HealthKit
import WatchKit
import UserNotifications
import CryptoKit
import UIKit

private func watchText(_ key: String) -> String { NSLocalizedString(key, comment: "") }

extension Notification.Name {
    static let openGymWorkoutLaunch = Notification.Name("openGym.watch.workoutLaunch")
}

final class WatchLaunchDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .openGymWorkoutLaunch, object: nil)
        }
    }
}

@main
struct OpenGymWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchLaunchDelegate.self) private var launchDelegate
    @StateObject private var model = WatchModel()
    var body: some Scene {
        WindowGroup { WatchHome().environmentObject(model) }
    }
}

struct WatchSet: Identifiable {
    let number: Int
    let done: Bool
    let weight: Double
    let reps: Int
    let seconds: Int?
    let sides: [String: [String: Any]]?
    var id: Int { number }
}

struct WatchEdit: Identifiable {
    let entry: Int
    let set: Int
    let field: String
    let side: String?
    let value: Double
    var id: String { "\(entry):\(set):\(field):\(side ?? "both")" }
}

struct WatchEntry: Identifiable {
    let index: Int
    let name: String
    let thumbnailKey: String?
    let sets: [WatchSet]
    var id: Int { index }
}

struct WatchRoutine: Identifiable {
    let id: String
    let name: String
    let entries: [[String: Any]]
}

final class WatchModel: NSObject, ObservableObject, WCSessionDelegate {
    @Published var sessionId = ""
    @Published var title = "openGym"
    @Published var unit = "kg"
    @Published var entries: [WatchEntry] = []
    @Published var restEndsAt = 0.0
    @Published var restLeft = 0
    @Published var restPaused = false
    @Published var restReady = false
    @Published var connected = false
    @Published var pending: Set<String> = []
    @Published var routines: [WatchRoutine] = []
    @Published var finished = false
    @Published var conflict = false
    @Published var restPresentationId = UUID()
    @Published var focusRevision = UUID()
    @Published var timerFont = "segments"
    @Published var timerColor = "#a3e635"
    @Published var thumbnailRevision = 0
    private(set) var focusEntry: Int?

    var restActive: Bool { !sessionId.isEmpty && !finished && (restPaused ? restLeft > 0 : restEndsAt > 0 && !restReady) }

    private var profile = UserDefaults.standard.string(forKey: "openGym.watch.profile") ?? ""
    private let finishedQueueKey = "openGym.watch.finishedPayloads"
    private var finishedQueue: [[String: Any]] = []
    private let sessionKey = "openGym.watch.session"
    private let routinesKey = "openGym.watch.routines"
    private let pendingFinishedKey = "openGym.watch.pendingFinished"
    private let pendingDiscardedKey = "openGym.watch.pendingDiscarded"
    private let displayKey = "openGym.watch.display"
    private let thumbnailCache = NSCache<NSString, UIImage>()
    private var localSession: [String: Any]?
    private var watchOwned = false
    private var pendingFinished: Set<String> = []
    private var pendingDiscarded: [[String: Any]] = []
    private let restAlert = WatchRestAlert()
    let vitals = WatchVitals()
    private var launchObserver: NSObjectProtocol?

    override init() {
        super.init()
        thumbnailCache.countLimit = 150
        if let display = UserDefaults.standard.dictionary(forKey: displayKey) { applyDisplay(display) }
        finishedQueue = UserDefaults.standard.array(forKey: finishedQueueKey) as? [[String: Any]] ?? []
        pendingFinished = Set(UserDefaults.standard.stringArray(forKey: pendingFinishedKey) ?? [])
        pendingDiscarded = UserDefaults.standard.array(forKey: pendingDiscardedKey) as? [[String: Any]] ?? []
        if let cached = UserDefaults.standard.array(forKey: routinesKey) as? [[String: Any]] { setRoutines(cached) }
        if let cached = UserDefaults.standard.dictionary(forKey: sessionKey) {
            localSession = cached
            watchOwned = cached["watchOwned"] as? Bool ?? false
            show(cached)
            if let rest = cached["_rest"] as? [String: Any] {
                restEndsAt = rest["endsAt"] as? Double ?? 0
                restLeft = rest["left"] as? Int ?? 0
                restPaused = rest["paused"] as? Bool ?? false
                restReady = rest["ready"] as? Bool ?? false
                updateRestAlert()
            }
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        apply(WCSession.default.receivedApplicationContext)
        launchObserver = NotificationCenter.default.addObserver(forName: .openGymWorkoutLaunch, object: nil, queue: .main) { [weak self] _ in
            self?.apply(WCSession.default.receivedApplicationContext)
        }
    }

    private func setRoutines(_ rows: [[String: Any]]) {
        routines = rows.compactMap { row in
            guard let id = row["id"] as? String, let name = row["name"] as? String else { return nil }
            return WatchRoutine(id: id, name: name, entries: row["entries"] as? [[String: Any]] ?? [])
        }
        UserDefaults.standard.set(rows, forKey: routinesKey)
    }

    private func show(_ value: [String: Any]?) {
        let previousId = sessionId
        let previousEntries = entries
        sessionId = value?["id"] as? String ?? ""
        title = value?["name"] as? String ?? "openGym"
        finished = value?["finished"] as? Bool ?? false
        if sessionId.isEmpty { vitals.stop() }
        else if finished { vitals.stop(resetMetrics: false) }
        else { vitals.start(id: sessionId) }
        entries = ((value?["entries"] as? [[String: Any]]) ?? []).enumerated().map { index, row in
            WatchEntry(index: index, name: row["name"] as? String ?? watchText("Exercise"),
                       thumbnailKey: row["thumbnailKey"] as? String,
                       sets: ((row["sets"] as? [[String: Any]]) ?? []).enumerated().map { number, item in
                return WatchSet(number: number, done: item["done"] as? Bool ?? false,
                                weight: (item["w"] as? NSNumber)?.doubleValue ?? 0,
                                reps: (item["r"] as? NSNumber)?.intValue ?? 0,
                                seconds: (item["sec"] as? NSNumber)?.intValue,
                                sides: item["sides"] as? [String: [String: Any]])
            })
        }
        if sessionId != previousId {
            focusEntry = entries.first(where: { $0.sets.contains { !$0.done } })?.index
            focusRevision = UUID()
        } else if let completed = entries.last(where: { entry in
            guard previousEntries.indices.contains(entry.index) else { return false }
            return entry.sets.contains { set in
                previousEntries[entry.index].sets.indices.contains(set.number) && set.done &&
                    !previousEntries[entry.index].sets[set.number].done
            }
        }) {
            focusEntry = entries.first(where: { $0.index >= completed.index && $0.sets.contains { !$0.done } })?.index
                ?? entries.first(where: { $0.sets.contains { !$0.done } })?.index
            focusRevision = UUID()
        }
    }

    private func saveLocal() {
        guard var value = localSession else {
            UserDefaults.standard.removeObject(forKey: sessionKey)
            clearRest()
            show(nil)
            return
        }
        value["watchOwned"] = watchOwned
        value["_rest"] = ["endsAt": restEndsAt, "left": restLeft, "paused": restPaused, "ready": restReady]
        localSession = value
        UserDefaults.standard.set(value, forKey: sessionKey)
        show(value)
    }

    func start(_ routine: WatchRoutine) {
        guard sessionId.isEmpty, !profile.isEmpty else { return }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        localSession = ["id": UUID().uuidString, "profile": profile, "name": routine.name,
                        "d": formatter.string(from: Date()), "start": Date().timeIntervalSince1970 * 1000,
                        "routineIds": [routine.id], "entries": routine.entries, "seq": 1,
                        "startedOnWatch": true]
        watchOwned = true
        conflict = false
        saveLocal()
        sendLocal()
    }

    func toggleSet(entry: Int, set: Int) {
        guard entries.indices.contains(entry), entries[entry].sets.indices.contains(set) else { return }
        changeSet(entry: entry, set: set, field: "done", value: !entries[entry].sets[set].done)
    }

    func editSet(entry: Int, set: Int, field: String, side: String?, value: Double) {
        guard ["w", "r", "sec"].contains(field), value.isFinite, value >= 0 else { return }
        let edited: Any = field == "w" ? (round(value * 4) / 4) as Any : Int(value.rounded()) as Any
        changeSet(entry: entry, set: set, field: field, value: edited, side: side)
    }

    private func changeSet(entry: Int, set: Int, field: String, value: Any, side: String? = nil) {
        guard var current = localSession, !finished,
              var rows = current["entries"] as? [[String: Any]], rows.indices.contains(entry),
              var sets = rows[entry]["sets"] as? [[String: Any]], sets.indices.contains(set) else { return }
        let done = field == "done" ? value as? Bool : nil
        if var sides = sets[set]["sides"] as? [String: [String: Any]] {
            for key in (side == nil ? ["L", "R"] : [side!]) { sides[key]?[field] = value }
            sets[set]["sides"] = sides
            sets[set]["done"] = (sides["L"]?["done"] as? Bool == true) && (sides["R"]?["done"] as? Bool == true)
            let left = sides["L"] ?? [:], right = sides["R"] ?? [:]
            sets[set]["w"] = max((left["w"] as? NSNumber)?.doubleValue ?? 0, (right["w"] as? NSNumber)?.doubleValue ?? 0)
            sets[set]["r"] = ((left["r"] as? NSNumber)?.intValue ?? 0) + ((right["r"] as? NSNumber)?.intValue ?? 0)
        } else {
            sets[set][field] = value
        }
        rows[entry]["sets"] = sets
        current["entries"] = rows
        let seq = (current["seq"] as? Int ?? 0) + 1
        current["seq"] = seq
        var change: [String: Any] = ["seq": seq, "entry": entry, "set": set, "field": field, "value": value]
        if let side { change["side"] = side }
        var changes = current["changes"] as? [[String: Any]] ?? []
        changes.append(change)
        current["changes"] = changes
        if done == true { current["lastSetAt"] = Date().timeIntervalSince1970 * 1000 }
        localSession = current
        watchOwned = true
        if done == true, rows.contains(where: { row in
            ((row["sets"] as? [[String: Any]]) ?? []).contains { $0["done"] as? Bool != true }
        }) {
            let rest = rows[entry]["restSec"] as? Int ?? 90
            restEndsAt = Date().timeIntervalSince1970 * 1000 + Double(rest * 1000)
            restLeft = rest
            restPaused = false
            restReady = false
            if rest > 0 { restPresentationId = UUID() }
        } else if done == false {
            restEndsAt = 0
            restLeft = 0
            restPaused = false
            restReady = false
        } else if done == true {
            clearRest()
        }
        updateRestAlert()
        saveLocal()
        sendLocal()
    }

    func finish() {
        guard var current = localSession, !finished else { return }
        current["finished"] = true
        current["end"] = Date().timeIntervalSince1970 * 1000
        current["seq"] = (current["seq"] as? Int ?? 0) + 1
        clearRest()
        localSession = current
        watchOwned = true
        if let id = current["id"] as? String {
            pendingFinished.insert(id)
            UserDefaults.standard.set(Array(pendingFinished), forKey: pendingFinishedKey)
        }
        finishedQueue = WatchOutbox.adding(current, to: finishedQueue)
        UserDefaults.standard.set(finishedQueue, forKey: finishedQueueKey)
        saveLocal()
        sendLocal()
    }

    func discard() {
        guard var current = localSession, !finished else { return }
        current["discarded"] = true
        current["seq"] = (current["seq"] as? Int ?? 0) + 1
        // Retain only a cancellation marker: no sets or workout data are saved.
        let marker: [String: Any] = ["id": current["id"] ?? sessionId, "profile": current["profile"] ?? profile, "seq": current["seq"] ?? 1,
                                    "discarded": true]
        pendingDiscarded.append(marker)
        UserDefaults.standard.set(pendingDiscarded, forKey: pendingDiscardedKey)
        localSession = nil
        watchOwned = false
        conflict = false
        saveLocal()
        sendDiscards()
    }

    private func sendDiscards() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        for current in finishedQueue {
            if !WCSession.default.outstandingUserInfoTransfers.contains(where: {
                ($0.userInfo["watchSession"] as? [String: Any])?["id"] as? String == current["id"] as? String
            }) { WCSession.default.transferUserInfo(["watchSession": current]) }
        }
        guard WCSession.isSupported() else { return }
        for marker in pendingDiscarded {
            let packet: [String: Any] = ["watchSession": marker]
            if WCSession.default.activationState == .activated {
                WCSession.default.sendMessage(packet, replyHandler: nil, errorHandler: nil)
            }
            if !WCSession.default.outstandingUserInfoTransfers.contains(where: {
                ($0.userInfo["watchSession"] as? [String: Any])?["id"] as? String == marker["id"] as? String
            }) { WCSession.default.transferUserInfo(packet) }
        }
    }

    func startAnother() {
        guard finished else { return }
        localSession = nil
        watchOwned = false
        restEndsAt = 0
        restLeft = 0
        restPaused = false
        restReady = false
        saveLocal()
    }

    private func sendLocal() {
        sendDiscards()
        guard WCSession.isSupported(), let current = localSession else { return }
        let packet: [String: Any] = ["watchSession": current]
        try? WCSession.default.updateApplicationContext(packet)
        if WCSession.default.activationState == .activated {
            WCSession.default.sendMessage(packet, replyHandler: nil, errorHandler: nil)
        }
    }

    func rest(_ action: String) {
        guard restActive else { return }
        let now = Date().timeIntervalSince1970 * 1000
        switch action {
        case "skipRest": restEndsAt = 0; restLeft = 0; restPaused = false; restReady = false
        case "pauseRest": restLeft = max(0, Int(ceil((restEndsAt - now) / 1000))); restPaused = true
        case "resumeRest": restEndsAt = now + Double(restLeft * 1000); restPaused = false; restReady = false
        case "addRest":
            if restPaused { restLeft += 15 }
            else { restEndsAt = max(restEndsAt, now) + 15000; restLeft = max(0, Int(ceil((restEndsAt - now) / 1000))) }
            restReady = false
        default: break
        }
        updateRestAlert()
        guard var current = localSession, !finished else { return }
        let seq = (current["seq"] as? Int ?? 0) + 1
        current["seq"] = seq
        var changes = current["changes"] as? [[String: Any]] ?? []
        changes.append(["seq": seq, "field": "rest", "value": action, "at": now])
        current["changes"] = changes
        localSession = current
        watchOwned = true
        saveLocal()
        sendLocal()
    }

    func tick(_ now: Date) {
        if restEndsAt > 0 && !restPaused && !restReady && now.timeIntervalSince1970 * 1000 >= restEndsAt {
            restAlert.complete(endsAt: restEndsAt, now: now)
            restEndsAt = 0
            restLeft = 0
            restReady = true
            saveLocal()
        }
    }

    private func clearRest() {
        restEndsAt = 0
        restLeft = 0
        restPaused = false
        restReady = false
        updateRestAlert()
    }

    private func updateRestAlert() {
        restAlert.schedule(endsAt: restActive && !restPaused ? restEndsAt : 0)
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.connected = activationState == .activated
            self.apply(session.receivedApplicationContext)
            if self.watchOwned { self.sendLocal() }
            else { self.sendDiscards() }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            if self.watchOwned { self.sendLocal() }
            else { self.sendDiscards() }
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async { self.apply(applicationContext) }
    }

    private func thumbnailURL(_ key: String) -> URL {
        let name = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WatchThumbnails").appendingPathComponent(name + ".jpg")
    }

    func thumbnail(for key: String?) -> UIImage? {
        guard let key else { return nil }
        if let cached = thumbnailCache.object(forKey: key as NSString) { return cached }
        guard let image = UIImage(contentsOfFile: thumbnailURL(key).path) else { return nil }
        thumbnailCache.setObject(image, forKey: key as NSString)
        return image
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let key = file.metadata?["thumbnailKey"] as? String, key.count <= 2048,
              let data = try? Data(contentsOf: file.fileURL), data.count <= 65536,
              let image = UIImage(data: data) else { return }
        let destination = thumbnailURL(key)
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            // WCSession deletes its temporary file after this delegate returns.
            try data.write(to: destination, options: .atomic)
            DispatchQueue.main.async {
                self.thumbnailCache.setObject(image, forKey: key as NSString)
                self.thumbnailRevision += 1
                let receipt: [String: Any] = ["thumbnailReceived": key]
                if session.isReachable { session.sendMessage(receipt, replyHandler: nil, errorHandler: nil) }
                session.transferUserInfo(receipt)
            }
        } catch { /* The sender can retry a thumbnail that was not acknowledged. */ }
    }

    private func applyDisplay(_ display: [String: Any]) {
        let font = display["timerFont"] as? String ?? "segments"
        timerFont = ["segments", "rounded", "mono"].contains(font) ? font : "segments"
        let color = display["timerColor"] as? String ?? "#a3e635"
        timerColor = color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? color : "#a3e635"
        UserDefaults.standard.set(["timerFont": timerFont, "timerColor": timerColor], forKey: displayKey)
    }

    private func apply(_ state: [String: Any]) {
        guard let incomingProfile = state["profile"] as? String, !incomingProfile.isEmpty else { return }
        if incomingProfile != profile {
            profile = incomingProfile
            UserDefaults.standard.set(profile, forKey: "openGym.watch.profile")
            localSession = nil
            watchOwned = false
            conflict = false
            clearRest()
            setRoutines([])
            saveLocal()
        }
        if let display = state["watchDisplay"] as? [String: Any] { applyDisplay(display) }
        unit = state["unit"] as? String ?? unit
        if let rows = state["routines"] as? [[String: Any]] { setRoutines(rows) }
        let discarded = state["discardedIds"] as? [String] ?? []
        pendingDiscarded.removeAll { discarded.contains($0["id"] as? String ?? "") }
        UserDefaults.standard.set(pendingDiscarded, forKey: pendingDiscardedKey)
        let completed = state["completedIds"] as? [String] ?? []
        finishedQueue = WatchOutbox.acknowledging(completed, profile: profile, in: finishedQueue)
        UserDefaults.standard.set(finishedQueue, forKey: finishedQueueKey)
        pendingFinished.subtract(completed)
        UserDefaults.standard.set(Array(pendingFinished), forKey: pendingFinishedKey)
        if let id = localSession?["id"] as? String, completed.contains(id) {
            localSession = nil
            watchOwned = false
            conflict = false
            saveLocal()
        }
        let phone = state["session"] as? [String: Any] ?? [:]
        guard let phoneId = phone["id"] as? String, !phoneId.isEmpty else {
            conflict = false
            if !watchOwned { localSession = nil; saveLocal() }
            return
        }
        if discarded.contains(phoneId) || pendingDiscarded.contains(where: { $0["id"] as? String == phoneId }) { return }
        if pendingFinished.contains(phoneId) && localSession?["id"] as? String != phoneId { return }
        let localId = localSession?["id"] as? String
        if localId != nil && localId != phoneId && watchOwned {
            conflict = true
            return
        }
        conflict = false
        let phoneSeq = phone["_watchSeq"] as? Int ?? 0
        let localSeq = localSession?["seq"] as? Int ?? 0
        if localId == phoneId && watchOwned && phoneSeq < localSeq { return }
        var adopted = phone
        adopted["seq"] = max(phoneSeq, localSeq)
        localSession = adopted
        watchOwned = false
        let wasActive = restActive
        let previousEnd = restEndsAt
        let previousFocus = focusRevision
        tick(Date())
        let rest = state["rest"] as? [String: Any] ?? [:]
        restEndsAt = rest["endsAt"] as? Double ?? 0
        restLeft = rest["left"] as? Int ?? 0
        restPaused = rest["paused"] as? Bool ?? false
        restReady = rest["ready"] as? Bool ?? false
        show(adopted)
        if restActive && (!wasActive || (focusRevision != previousFocus && restEndsAt != previousEnd)) {
            restPresentationId = UUID()
        }
        updateRestAlert()
        saveLocal()
    }
}

// The notification owns the background alert; a foreground completion plays the
// system notification haptic (including its sound when the Watch is not muted).
final class WatchRestAlert: NSObject, UNUserNotificationCenterDelegate {
    private let center = UNUserNotificationCenter.current()
    private let identifier = "openGym.watch.rest"
    private var endsAt = 0.0
    private var announcedEnd = 0.0

    override init() {
        super.init()
        center.delegate = self
    }

    func schedule(endsAt: Double) {
        guard self.endsAt != endsAt else { return }
        self.endsAt = endsAt
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
        guard endsAt > Date().timeIntervalSince1970 * 1000 else { return }
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                guard let self, granted, self.endsAt == endsAt else { return }
                let remaining = endsAt / 1000 - Date().timeIntervalSince1970
                guard remaining > 0 else { return }
                let content = UNMutableNotificationContent()
                content.title = watchText("Rest over")
                content.body = watchText("You can start your next set.")
                content.sound = .default
                content.userInfo = ["endsAt": endsAt]
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, remaining), repeats: false)
                self.center.add(UNNotificationRequest(identifier: self.identifier, content: content, trigger: trigger))
            }
        }
    }

    func complete(endsAt: Double, now: Date) {
        guard endsAt > 0, announcedEnd != endsAt,
              now.timeIntervalSince1970 * 1000 - endsAt < 5000,
              WKApplication.shared().applicationState == .active else { return }
        announcedEnd = endsAt
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        WKInterfaceDevice.current().play(.notification)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let end = (notification.request.content.userInfo["endsAt"] as? NSNumber)?.doubleValue ?? 0
        DispatchQueue.main.async {
            if self.endsAt == end { self.complete(endsAt: end, now: Date()) }
            completionHandler([])
        }
    }
}

private enum WatchRoutineConfirmation { case finish, discard }

struct WatchHome: View {
    @EnvironmentObject var model: WatchModel
    @State private var now = Date()
    @State private var edit: WatchEdit?
    @State private var showingRest = false
    @State private var confirmation: WatchRoutineConfirmation?
    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var remaining: Int {
        if model.restPaused { return model.restLeft }
        return max(0, Int(ceil(model.restEndsAt / 1000 - now.timeIntervalSince1970)))
    }

    private var timeLabel: String { String(format: "%02d:%02d", remaining / 60, remaining % 60) }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                // Keep the list mounted behind the timer so Back retains its position.
                exerciseList
                    .opacity(showingRest && model.restActive ? 0 : 1)
                    .allowsHitTesting(!showingRest || !model.restActive)
                    .accessibilityHidden(showingRest && model.restActive)
                if model.restActive {
                    if showingRest { restScreen.ignoresSafeArea(.container, edges: .bottom) }
                    else {
                        VStack {
                            HStack {
                                Spacer()
                                Button { showingRest = true } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: model.restPaused ? "pause.fill" : "timer")
                                        Text(timeLabel).monospacedDigit().foregroundStyle(watchTimerColor(model.timerColor))
                                    }.font(.caption.bold()).padding(.horizontal, 8).padding(.vertical, 5)
                                }
                                .buttonStyle(.plain)
                                .background(.black, in: Capsule())
                                .overlay(Capsule().stroke(.secondary.opacity(0.5)))
                                .accessibilityLabel("Abrir descanso, \(timeLabel)")
                            }
                            Spacer()
                        }
                    }
                }
                if !model.sessionId.isEmpty {
                    WatchVitalsHeader(vitals: model.vitals)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 18)
                        .padding(.leading, 20)
                        .padding(.trailing, 72)
                        .frame(height: 56, alignment: .top)
                        .background {
                            Rectangle().fill(.ultraThinMaterial)
                                .overlay(Color.black.opacity(0.94))
                                .mask {
                                    LinearGradient(stops: [.init(color: .black, location: 0),
                                                           .init(color: .black, location: 0.68),
                                                           .init(color: .clear, location: 1)],
                                                   startPoint: .top, endPoint: .bottom)
                                }
                        }
                        .offset(y: -geometry.safeAreaInsets.top)
                        .allowsHitTesting(false)
                }
                // Above the fade so the Back control remains visible and tappable.
                if showingRest && model.restActive {
                    Button { showingRest = false } label: {
                        Image(systemName: "chevron.left").font(.headline).foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(watchText("Back to exercises"))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
                    .offset(y: -geometry.safeAreaInsets.top + 25)
                }
            }
        }
        .onReceive(clock) { now = $0; model.tick($0) }
        .onChange(of: model.restPresentationId) { _, _ in if model.restActive { showingRest = true } }
        .onChange(of: model.restActive) { _, active in if !active { showingRest = false } }
        .onAppear { showingRest = model.restActive }
        .sheet(item: $edit) { selected in
            WatchNumberEditor(edit: selected) { value in
                model.editSet(entry: selected.entry, set: selected.set, field: selected.field,
                              side: selected.side, value: value)
            }
        }
        .alert(confirmation == .finish ? watchText("Finish workout?") : watchText("Discard workout?"),
               isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })) {
            if confirmation == .finish {
                Button(watchText("Finish")) { model.finish() }
            } else {
                Button(watchText("Discard"), role: .destructive) { model.discard() }
            }
            Button(watchText("Resume"), role: .cancel) {}
        } message: {
            Text(confirmation == .finish ? watchText("Your workout will be saved.") : watchText("Your workout will not be saved."))
        }
    }

    private var restScreen: some View {
        VStack(spacing: 4) {
            WatchCountdown(label: timeLabel, font: model.timerFont, hexColor: model.timerColor)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("Rest, \(timeLabel)")
            if model.restPaused { Text(watchText("Paused")).font(.caption2).foregroundStyle(.secondary) }
            HStack(spacing: 6) {
                restControl(model.restPaused ? "play.fill" : "pause.fill",
                            label: model.restPaused ? watchText("Resume rest") : watchText("Pause rest")) {
                    model.rest(model.restPaused ? "resumeRest" : "pauseRest")
                }
                Button { model.rest("addRest") } label: {
                    Text("+15").font(.body.bold()).frame(maxWidth: .infinity).frame(height: 44)
                }
                .buttonStyle(.plain)
                .background(Color.white.opacity(0.19), in: RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel(watchText("Add fifteen seconds"))
                restControl("forward.end.fill", label: watchText("Skip rest")) { model.rest("skipRest") }
            }.padding(.horizontal, 4).padding(.top, 12)
        }
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
        .contentShape(Rectangle())
        .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { value in
            let dx = value.translation.width
            let dy = value.translation.height
            guard abs(dx) >= 32, abs(dx) > abs(dy) * 1.5 else { return }
            let rightWrist = WKInterfaceDevice.current().wristLocation == .right
            if rightWrist ? dx < 0 : dx > 0 { showingRest = false }
        })
    }

    private func restControl(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.body.bold()).frame(maxWidth: .infinity).frame(height: 44)
        }
        .buttonStyle(.plain)
        .background(Color.white.opacity(0.19), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityLabel(label)
    }

    private var exerciseList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if model.sessionId.isEmpty {
                        Text("openGym").font(.headline)
                        if model.routines.isEmpty {
                            Text(watchText("Open openGym on your iPhone to sync routines.")).foregroundStyle(.secondary)
                        } else {
                            Text(watchText("Routines")).foregroundStyle(.secondary)
                            ForEach(model.routines) { routine in
                                Button(routine.name) { model.start(routine) }
                            }
                        }
                    } else {
                        Text(model.title).font(.headline)
                        WatchVitalsMessage(vitals: model.vitals)
                        if model.conflict {
                            Text(watchText("Another workout is active on your iPhone. Finish it there to sync this one.")).foregroundStyle(.orange)
                        }
                        if model.finished {
                            Text(watchText("Saved on your watch. It will sync when your iPhone connects.")).foregroundStyle(.secondary)
                            Button(watchText("Another routine")) { model.startAnother() }
                        } else {
                            ForEach(model.entries) { entry in
                                WatchExerciseCard(entry: entry) { edit = $0 }
                                    .padding(.top, 14).id(entry.index)
                            }
                            Button(watchText("Discard workout"), role: .destructive) { confirmation = .discard }
                            Button(watchText("Finish workout")) { confirmation = .finish }
                        }
                    }
                }.padding(.horizontal, 4)
                    .padding(.top, model.restActive ? 32 : 0)
            }
            .onChange(of: model.focusRevision) { _, _ in
                guard !model.finished, !model.sessionId.isEmpty, let index = model.focusEntry else { return }
                let session = model.sessionId
                // Only a newly completed set moves the list; manual scrolling is retained.
                DispatchQueue.main.async {
                    guard model.sessionId == session, !model.finished else { return }
                    withAnimation { proxy.scrollTo(index, anchor: .top) }
                }
            }
            .onAppear {
                guard !model.finished, !model.sessionId.isEmpty, let index = model.focusEntry else { return }
                let session = model.sessionId
                DispatchQueue.main.async {
                    guard model.sessionId == session, !model.finished else { return }
                    proxy.scrollTo(index, anchor: .top)
                }
            }
        }
        // A session, its completion summary and the routine catalog each get a fresh
        // scroll container. Keep its identity stable while editing sets or using Rest.
        .id("\(model.sessionId):\(model.finished)")
    }
}

private func watchTimerColor(_ hex: String) -> Color {
    let value = UInt32(hex.dropFirst(), radix: 16) ?? 0xa3e635
    return Color(.sRGB, red: Double((value >> 16) & 255) / 255,
                 green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255, opacity: 1)
}

struct WatchCountdown: View {
    let label: String
    let font: String
    let hexColor: String

    var body: some View {
        GeometryReader { geometry in
            if font == "segments" {
                let characters = Array(label)
                let widthUnits = characters.reduce(0.0) { $0 + ($1 == ":" ? 0.13 : 0.42) } + Double(max(0, characters.count - 1)) * 0.04
                let height = min(geometry.size.height, geometry.size.width / widthUnits)
                HStack(spacing: height * 0.04) {
                    ForEach(Array(characters.enumerated()), id: \.offset) { _, character in
                        if character == ":" {
                            VStack(spacing: height * 0.28) {
                                Circle().frame(width: height * 0.08, height: height * 0.08)
                                Circle().frame(width: height * 0.08, height: height * 0.08)
                            }.frame(width: height * 0.13, height: height)
                        } else {
                            WatchSegmentDigit(number: character.wholeNumberValue ?? 0)
                                .frame(width: height * 0.42, height: height)
                        }
                    }
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
            } else {
                Text(label)
                    .font(.system(size: geometry.size.height * 1.3, weight: .bold,
                                  design: font == "mono" ? .monospaced : .rounded).monospacedDigit())
                    .lineLimit(1).minimumScaleFactor(0.1)
                    .frame(width: geometry.size.width, height: geometry.size.height)
            }
        }
        .foregroundStyle(watchTimerColor(hexColor))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}

struct WatchSegmentDigit: Shape {
    let number: Int
    private static let digits = ["012345", "12", "01463", "01263", "1256", "02563", "025634", "012", "0123456", "012356"]
    private static let segments: [[CGPoint]] = [
        [CGPoint(x: 12, y: 0), CGPoint(x: 88, y: 0), CGPoint(x: 78, y: 10), CGPoint(x: 22, y: 10)],
        [CGPoint(x: 90, y: 2), CGPoint(x: 100, y: 12), CGPoint(x: 100, y: 43), CGPoint(x: 90, y: 49), CGPoint(x: 80, y: 43), CGPoint(x: 80, y: 12)],
        [CGPoint(x: 90, y: 51), CGPoint(x: 100, y: 57), CGPoint(x: 100, y: 88), CGPoint(x: 90, y: 98), CGPoint(x: 80, y: 88), CGPoint(x: 80, y: 57)],
        [CGPoint(x: 12, y: 100), CGPoint(x: 88, y: 100), CGPoint(x: 78, y: 90), CGPoint(x: 22, y: 90)],
        [CGPoint(x: 10, y: 51), CGPoint(x: 20, y: 57), CGPoint(x: 20, y: 88), CGPoint(x: 10, y: 98), CGPoint(x: 0, y: 88), CGPoint(x: 0, y: 57)],
        [CGPoint(x: 10, y: 2), CGPoint(x: 20, y: 12), CGPoint(x: 20, y: 43), CGPoint(x: 10, y: 49), CGPoint(x: 0, y: 43), CGPoint(x: 0, y: 12)],
        [CGPoint(x: 12, y: 50), CGPoint(x: 22, y: 44), CGPoint(x: 78, y: 44), CGPoint(x: 88, y: 50), CGPoint(x: 78, y: 56), CGPoint(x: 22, y: 56)],
    ]

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for character in Self.digits[max(0, min(9, number))] {
            let points = Self.segments[character.wholeNumberValue!].map {
                CGPoint(x: rect.minX + $0.x / 100 * rect.width, y: rect.minY + $0.y / 100 * rect.height)
            }
            path.addLines(points)
            path.closeSubpath()
        }
        return path
    }
}

struct WatchExerciseCard: View {
    @EnvironmentObject var model: WatchModel
    let entry: WatchEntry
    let onEdit: (WatchEdit) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Group {
                    if let image = model.thumbnail(for: entry.thumbnailKey) {
                        Image(uiImage: image).resizable().scaledToFit()
                    } else {
                        Image(systemName: "dumbbell.fill").font(.title3).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 38, height: 38)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
                Text(entry.name).font(.system(size: 15, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(entry.sets) { set in
                HStack(spacing: 4) {
                    Button { model.toggleSet(entry: entry.index, set: set.number) } label: {
                        HStack(spacing: 3) {
                            Image(systemName: set.done ? "checkmark.circle.fill" : "circle").font(.system(size: 20))
                            Text("\(set.number + 1)").font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundStyle(set.done ? .green : .secondary)
                        .frame(width: 38, height: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(set.done ? watchText("Uncheck") : watchText("Complete")) set \(set.number + 1)")
                    if let sides = set.sides {
                        VStack(spacing: 4) {
                            ForEach(["L", "R"], id: \.self) { side in
                                HStack(spacing: 3) {
                                    Text(side == "L" ? "L" : "R").font(.caption2).foregroundStyle(.secondary)
                                    valueButton(set: set, field: "w", side: side, value: (sides[side]?["w"] as? NSNumber)?.doubleValue ?? 0)
                                    valueButton(set: set, field: "r", side: side, value: (sides[side]?["r"] as? NSNumber)?.doubleValue ?? 0)
                                }
                            }
                        }
                    } else {
                        valueButton(set: set, field: "w", side: nil, value: set.weight)
                        valueButton(set: set, field: set.seconds == nil ? "r" : "sec", side: nil, value: Double(set.seconds ?? set.reps))
                    }
                }
                .padding(.horizontal, 2)
                .background(set.done ? Color.green.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 9))
            }
        }
        .padding(8)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.11)))
    }

    private func valueButton(set: WatchSet, field: String, side: String?, value: Double) -> some View {
        let formatted = field == "w" ? value.formatted(.number.precision(.fractionLength(0...2))) : "\(Int(value))"
        let unit = field == "w" ? model.unit : field == "sec" ? "s" : "rep"
        return Button {
            onEdit(WatchEdit(entry: entry.index, set: set.number, field: field, side: side, value: value))
        } label: {
            HStack(spacing: 2) {
                Text(formatted).font(.system(size: 18, weight: .semibold, design: .rounded).monospacedDigit())
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(unit).font(.system(size: 10)).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityLabel("Edit \(field == "w" ? watchText("weight") : field == "sec" ? watchText("seconds") : watchText("repetitions")), set \(set.number + 1)\(side == "L" ? watchText(", left") : side == "R" ? watchText(", right") : ""), \(formatted) \(unit)")
    }
}

struct WatchNumberEditor: View {
    @Environment(\.dismiss) private var dismiss
    let edit: WatchEdit
    let onSave: (Double) -> Void
    @State private var value: Double

    init(edit: WatchEdit, onSave: @escaping (Double) -> Void) {
        self.edit = edit
        self.onSave = onSave
        _value = State(initialValue: edit.value)
    }

    var body: some View {
        VStack(spacing: 12) {
            Text(edit.field == "w" ? watchText("Weight") : edit.field == "sec" ? watchText("Seconds") : watchText("Repetitions"))
                .font(.headline)
            Stepper(value: $value, in: 0...500, step: edit.field == "w" ? 0.25 : 1) {
                Text(edit.field == "w" ? String(format: "%.2f", value) : "\(Int(value))")
                    .font(.title2.monospacedDigit())
            }
            Button(watchText("Save")) { onSave(value); dismiss() }
        }.padding(.horizontal, 4)
    }
}

struct WatchVitalsMessage: View {
    @ObservedObject var vitals: WatchVitals
    var body: some View {
        if let message = vitals.message {
            Text(message).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

struct WatchVitalsHeader: View {
    @ObservedObject var vitals: WatchVitals

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 3) {
                Image(systemName: "heart.fill").font(.system(size: 13)).foregroundStyle(.red)
                Text(vitals.pulse.map(String.init) ?? "--")
            }
            HStack(spacing: 3) {
                Image(systemName: "flame.fill").font(.system(size: 13)).foregroundStyle(.orange)
                Text("\(vitals.calories)")
            }
        }
        .font(.system(size: 16, weight: .semibold, design: .rounded).monospacedDigit())
        .lineLimit(1).minimumScaleFactor(0.8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Heart rate \(vitals.pulse.map(String.init) ?? watchText("no data")) beats per minute, \(vitals.calories) kilocalories")
    }
}

final class WatchVitals: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    @Published var pulse: Int?
    @Published var calories = 0
    @Published var message: String?

    private let health = HKHealthStore()
    private let heartType = HKObjectType.quantityType(forIdentifier: .heartRate)!
    private let energyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var currentId: String?

    func start(id: String) {
        guard currentId != id else { return }
        stop()
        guard HKHealthStore.isHealthDataAvailable() else {
            message = watchText("Health is unavailable")
            return
        }
        currentId = id
        message = nil
        health.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartType, energyType]) { [weak self] _, error in
            DispatchQueue.main.async {
                guard let self, self.currentId == id else { return }
                if let error {
                    self.message = "Allow Health access on your watch: \(error.localizedDescription)"
                    return
                }
                self.beginWorkout(id: id)
            }
        }
    }

    private func beginWorkout(id: String) {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: health, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: health, workoutConfiguration: configuration)
            builder.delegate = self
            session.delegate = self
            self.session = session
            self.builder = builder
            let now = Date()
            session.startActivity(with: now)
            builder.beginCollection(withStart: now) { [weak self] success, error in
                DispatchQueue.main.async {
                    guard let self, self.currentId == id else { return }
                    if !success { self.message = error?.localizedDescription ?? watchText("Could not read workout data") }
                }
            }
        } catch {
            message = error.localizedDescription
        }
    }

    func stop(resetMetrics: Bool = true) {
        if currentId != nil {
            currentId = nil
            session?.end()
            builder?.discardWorkout()
            session = nil
            builder = nil
        }
        if resetMetrics { pulse = nil; calories = 0 }
        message = nil
    }

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let pulse = collectedTypes.contains(heartType)
            ? workoutBuilder.statistics(for: heartType)?.mostRecentQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            : nil
        let energy = collectedTypes.contains(energyType)
            ? workoutBuilder.statistics(for: energyType)?.sumQuantity()?.doubleValue(for: .kilocalorie())
            : nil
        DispatchQueue.main.async {
            guard self.builder === workoutBuilder else { return }
            if let pulse, pulse.isFinite { self.pulse = Int(pulse.rounded()) }
            if let energy, energy.isFinite { self.calories = max(0, Int(energy.rounded())) }
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
                        from fromState: HKWorkoutSessionState, date: Date) {}
    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            guard self.session === workoutSession else { return }
            self.message = error.localizedDescription
        }
    }
}
