import ActivityKit
import AppIntents
import Foundation
import UserNotifications
import WidgetKit

/*
 * The running workout's Live Activity: what it carries, and its buttons (Log set, and Next exercise
 * or Skip rest beside it). Compiled into both
 * the app and the widget extension (ios/ci/add-widgets.rb): the extension draws it
 * (OpenGymWidgets/LiveActivityWidget.swift), the app starts and updates it for the page
 * (LiveActivityPlugin.swift, lib/live-activity.js) and runs the buttons' intents.
 *
 * The page sends both halves as JSON; the field names are lib/live-activity.js buildLiveActivity's.
 * Text only: no exercise animations or pictures (Gym visual licence).
 */

/// The App Group the app, the widget extension and the asset pack downloader share.
enum OpenGymGroup {
    static let id = "group.ch.opengym.app"
    static var defaults: UserDefaults { UserDefaults(suiteName: id) ?? .standard }
    static var container: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: id) }
}

@available(iOS 16.1, *)
struct WorkoutActivityAttributes: ActivityAttributes {
    struct Labels: Codable, Hashable {
        var done: String
        var rest: String
        var next: String
        var allDone: String
        var restOver: String
        // From LIVE_VERSION 2. Optional: an activity a build before that started keeps its old
        // labels (they are fixed for the activity's life) and still has to decode.
        var nextExercise: String?
        var skipRest: String?
        var openApp: String?
        // Timed holds that run themselves (lib/auto-holds.js). Optional like the ones above.
        var hold: String?
        var getReady: String?
        var stopAuto: String?
    }

    /// One set as the activity shows it, with the rest that follows it.
    struct SetInfo: Codable, Hashable {
        var exId: String
        var entryIdx: Int
        var setIdx: Int
        var exName: String
        var setLine: String
        var target: String
        var restAfter: Int
        /// The first entry of its superset unit (LIVE_VERSION 2): Next exercise leaves this unit.
        var unit: Int?

        var unitKey: Int { unit ?? entryIdx }
    }

    struct ContentState: Codable, Hashable {
        var name: String
        /// The set to do now; nil once every set is ticked.
        var cur: SetInfo?
        /// The few sets after it, so Done can move on while the page sleeps.
        var ahead: [SetInfo]
        /// A running rest's end, in milliseconds since 1970.
        var restEndsAt: Double?
        /// A paused rest's seconds left.
        var restLeft: Double?
        var restTotal: Double?
        var done: Int
        var total: Int
        /// The first open set of the next few exercises, in order (LIVE_VERSION 2), so Next exercise
        /// works while the page sleeps. Always the units after `cur`'s: moving on trims it.
        var unitStarts: [SetInfo]?
        /// A hold counting down, or the 3-2-1 before one that starts by itself (`holdKind`
        /// "countin" or "hold"): its end in ms since 1970, or its seconds left while paused.
        var holdEndsAt: Double?
        var holdLeft: Double?
        var holdTotal: Double?
        var holdKind: String?
        /// The holds run themselves now: the Lock Screen offers Stop auto beside Log set.
        var auto: Bool?

        /// A rest is counting down or held.
        var resting: Bool { restEndsAt != nil || restLeft != nil }
        /// A hold or its count-in is counting down or held.
        var holding: Bool { holdEndsAt != nil || holdLeft != nil }

        /// The running hold (or count-in) as a range Text(timerInterval:) can count down, or nil.
        var holdRange: ClosedRange<Date>? {
            // Finite only: a NaN or infinite end (or total) would make the range trap.
            guard let end = holdEndsAt, end.isFinite, (holdTotal ?? 1).isFinite else { return nil }
            let until = Date(timeIntervalSince1970: end / 1000)
            let from = until.addingTimeInterval(-max(1, holdTotal ?? 1))
            return from...until
        }

        /// Where Next exercise goes: the first open set of the next exercise, or nil when no other
        /// exercise the activity knows of has sets open.
        var nextUnitStart: SetInfo? {
            guard let cur = cur else { return nil }
            return (unitStarts ?? []).first { $0.unitKey != cur.unitKey }
        }

        /// The starts after the unit `set` is in, once the activity moved into it.
        func startsAfter(_ set: SetInfo?) -> [SetInfo]? {
            guard let starts = unitStarts else { return nil }
            guard let set = set else { return [] }
            guard let i = starts.firstIndex(where: { $0.unitKey == set.unitKey }) else { return starts }
            return Array(starts[(i + 1)...])
        }

        /// When the system should call the activity stale: the rest's end, where the label turns to "Rest over".
        var staleDate: Date? { restRange?.upperBound }
        /// The running rest as a range Text(timerInterval:) can count down, or nil.
        var restRange: ClosedRange<Date>? {
            guard let end = restEndsAt, end.isFinite, (restTotal ?? 1).isFinite else { return nil }
            let until = Date(timeIntervalSince1970: end / 1000)
            let from = until.addingTimeInterval(-max(1, restTotal ?? 1))
            return from...until
        }
    }

    var v: Int
    var wid: String
    var start: Double?
    var accent: String
    var ink: String
    var labels: Labels
}

/**
 * The taps (Log set, Next exercise, Skip rest) the page has not applied yet, oldest first, in the
 * App Group. The intents add to it, LiveActivityPlugin hands it to the page and takes out what the
 * page acknowledged.
 */
enum LiveActivityQueue {
    static let key = "liveActivityEvents"
    static let didChange = Notification.Name("OpenGymLiveActivityEvent")
    /// Skip rest was tapped: RestAlertPlugin forgets the alert it would post on leaving the front.
    static let restSkipped = Notification.Name("OpenGymLiveActivityRestSkipped")
    /// Stop auto was tapped, or a set logged that changes the chain's timing: RestAlertPlugin drops
    /// the alerts of the chain of holds after the one booked now (the page books again when it wakes).
    static let autoStopped = Notification.Name("OpenGymLiveActivityAutoStopped")
    private static let lock = NSLock()

    static func all() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return read()
    }

    static func append(_ event: [String: Any]) {
        lock.lock(); defer { lock.unlock() }
        var list = read()
        list.append(event)
        // A queue nobody drained for a long time keeps its newest taps, not every one ever made.
        if list.count > 200 { list.removeFirst(list.count - 200) }
        write(list)
    }

    static func remove(ids: Set<String>) {
        lock.lock(); defer { lock.unlock() }
        write(read().filter { !ids.contains(($0["id"] as? String) ?? "") })
    }

    private static func read() -> [[String: Any]] {
        guard let data = OpenGymGroup.defaults.data(forKey: key),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list
    }

    private static func write(_ list: [[String: Any]]) {
        if JSONSerialization.isValidJSONObject(list), let data = try? JSONSerialization.data(withJSONObject: list) {
            OpenGymGroup.defaults.set(data, forKey: key)
        }
    }
}

/**
 * The Live Activity's Done. iOS runs it in the app, whether the page is awake or not: the tap is
 * queued for the page (which ticks the set through the workout screen's own tick, once), and the
 * activity moves on to the next set and its rest right away, with the rest-over notification the
 * page would have booked. When the page applies the tap it sends its own state, which wins.
 */
@available(iOS 17.0, *)
struct DoneSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Done"
    static let isDiscoverable = false

    @Parameter(title: "Workout") var wid: String
    @Parameter(title: "Exercise") var exId: String
    @Parameter(title: "Entry") var entryIdx: Int
    @Parameter(title: "Set") var setIdx: Int

    init() {}

    init(wid: String, exId: String, entryIdx: Int, setIdx: Int) {
        self.wid = wid
        self.exId = exId
        self.entryIdx = entryIdx
        self.setIdx = setIdx
    }

    func perform() async throws -> some IntentResult {
        await LiveActivityTick.tick(wid: wid, exId: exId, entryIdx: entryIdx, setIdx: setIdx)
        return .result()
    }
}

/// The Live Activity's Next exercise: on to the next exercise without logging anything (Discord).
@available(iOS 17.0, *)
struct NextExerciseIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Next exercise"
    static let isDiscoverable = false

    @Parameter(title: "Workout") var wid: String
    @Parameter(title: "Entry") var entryIdx: Int

    init() {}

    init(wid: String, entryIdx: Int) {
        self.wid = wid
        self.entryIdx = entryIdx
    }

    func perform() async throws -> some IntentResult {
        await LiveActivityTick.nextExercise(wid: wid, entryIdx: entryIdx)
        return .result()
    }
}

/// The Live Activity's Skip rest, the rest bar's Skip.
@available(iOS 17.0, *)
struct SkipRestIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Skip rest"
    static let isDiscoverable = false

    @Parameter(title: "Workout") var wid: String

    init() {}

    init(wid: String) {
        self.wid = wid
    }

    func perform() async throws -> some IntentResult {
        await LiveActivityTick.skipRest(wid: wid)
        return .result()
    }
}

/// The Live Activity's Stop auto: holds stop starting by themselves for this workout.
@available(iOS 17.0, *)
struct StopAutoIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop auto"
    static let isDiscoverable = false

    @Parameter(title: "Workout") var wid: String

    init() {}

    init(wid: String) {
        self.wid = wid
    }

    func perform() async throws -> some IntentResult {
        await LiveActivityTick.stopAuto(wid: wid)
        return .result()
    }
}

@available(iOS 17.0, *)
enum LiveActivityTick {
    static let restRequestId = "opengym.rest"   // RestAlertPlugin.requestId: the page's own replaces it

    /// `queue` false: the set was logged on the Home Screen widget, which queued it for the page
    /// itself (WidgetLogger); the activity only moves on with it.
    static func tick(wid: String, exId: String, entryIdx: Int, setIdx: Int, now: Date = Date(), queue: Bool = true) async {
        guard let activity = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.wid == wid }) else { return }
        let state = activity.content.state
        // A button from a state already moved on (two quick taps): that set is ticked already.
        guard let cur = state.cur, cur.exId == exId, cur.entryIdx == entryIdx, cur.setIdx == setIdx else { return }
        if queue { LiveActivityQueue.append([
            "id": UUID().uuidString, "type": "setDone", "wid": wid, "exId": exId,
            "entryIdx": entryIdx, "setIdx": setIdx, "at": (now.timeIntervalSince1970 * 1000).rounded(),
        ]) }
        var next = state
        next.cur = state.ahead.first
        next.ahead = Array(state.ahead.dropFirst())
        next.done = min(state.total, state.done + 1)
        next.unitStarts = state.startsAfter(next.cur)
        next.restLeft = nil
        // Logged during a hold or its count-in: that clock is over, and the chain's alerts booked
        // for the old timing go (the page books again when it applies this tap).
        if state.holding {
            next.holdEndsAt = nil
            next.holdLeft = nil
            next.holdTotal = nil
            next.holdKind = nil
            NotificationCenter.default.post(name: LiveActivityQueue.autoStopped, object: nil)
        }
        if cur.restAfter > 0, next.cur != nil {
            let end = now.addingTimeInterval(TimeInterval(cur.restAfter))
            next.restEndsAt = end.timeIntervalSince1970 * 1000
            next.restTotal = Double(cur.restAfter)
            bookRestOver(at: end, title: activity.attributes.labels.restOver)
        } else {
            next.restEndsAt = nil
            next.restTotal = nil
        }
        await activity.update(ActivityContent(state: next, staleDate: next.staleDate))
        NotificationCenter.default.post(name: LiveActivityQueue.didChange, object: nil)
    }

    /// Next exercise: the activity moves to the next exercise's first open set, nothing is ticked.
    static func nextExercise(wid: String, entryIdx: Int, now: Date = Date()) async {
        guard let activity = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.wid == wid }) else { return }
        let state = activity.content.state
        // A button from a state already moved on (two quick taps): the first one went.
        guard let cur = state.cur, cur.entryIdx == entryIdx, let target = state.nextUnitStart else { return }
        LiveActivityQueue.append([
            "id": UUID().uuidString, "type": "next", "wid": wid, "fromEntryIdx": entryIdx,
            "at": (now.timeIntervalSince1970 * 1000).rounded(),
        ])
        var next = state
        // The sets carried for the left exercise are dropped; the ones from the target on stay.
        if let i = state.ahead.firstIndex(where: { $0.unitKey == target.unitKey }) {
            next.cur = state.ahead[i]
            next.ahead = Array(state.ahead[(i + 1)...])
        } else {
            next.cur = target
            next.ahead = []
        }
        next.unitStarts = state.startsAfter(next.cur)
        await activity.update(ActivityContent(state: next, staleDate: next.staleDate))
        NotificationCenter.default.post(name: LiveActivityQueue.didChange, object: nil)
    }

    /// Skip rest: the rest ends now, and so does its rest-over notification.
    static func skipRest(wid: String, now: Date = Date()) async {
        guard let activity = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.wid == wid }) else { return }
        let state = activity.content.state
        guard state.resting else { return }
        LiveActivityQueue.append([
            "id": UUID().uuidString, "type": "restSkip", "wid": wid, "at": (now.timeIntervalSince1970 * 1000).rounded(),
        ])
        var next = state
        next.restEndsAt = nil
        next.restLeft = nil
        next.restTotal = nil
        // The page's own (RestAlertPlugin) uses the same id, so this takes that one down too.
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [restRequestId])
        center.removeDeliveredNotifications(withIdentifiers: [restRequestId])
        NotificationCenter.default.post(name: LiveActivityQueue.restSkipped, object: nil)
        await activity.update(ActivityContent(state: next, staleDate: next.staleDate))
        NotificationCenter.default.post(name: LiveActivityQueue.didChange, object: nil)
    }

    /// Stop auto: the chain ends; a count-in goes with it, a hold running finishes as one started by hand.
    static func stopAuto(wid: String, now: Date = Date()) async {
        guard let activity = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.wid == wid }) else { return }
        let state = activity.content.state
        guard state.auto == true else { return }
        LiveActivityQueue.append([
            "id": UUID().uuidString, "type": "autoStop", "wid": wid, "at": (now.timeIntervalSince1970 * 1000).rounded(),
        ])
        var next = state
        next.auto = false
        if state.holdKind == "countin" {
            next.holdEndsAt = nil
            next.holdLeft = nil
            next.holdTotal = nil
            next.holdKind = nil
        }
        NotificationCenter.default.post(name: LiveActivityQueue.autoStopped, object: nil)
        await activity.update(ActivityContent(state: next, staleDate: next.staleDate))
        NotificationCenter.default.post(name: LiveActivityQueue.didChange, object: nil)
    }

    private static func bookRestOver(at: Date, title: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.sound = .default
        content.interruptionLevel = .active
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: LiveNumbers.triggerSeconds(at.timeIntervalSinceNow), repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: restRequestId, content: content, trigger: trigger))
    }
}

// MARK: - logging a set from the Home Screen widget (v1.4.5)

/**
 * The Home Screen widget's set buttons while a workout runs (lib/widget-logger.js): the snapshot
 * carries the next sets, each with what − and + walk through (weights already on the exercise's
 * step or the bells you own, reps with their step, seconds), so nothing here knows about plates or
 * units. The widget's own copy, { base, pos, wi, r, sec }, lives in the App Group: `base` names the
 * snapshot it was made from (a new one starts over), `pos` the set shown, the rest the numbers
 * changed on it. Log set queues { id, type: "setDone", wid, exId, entryIdx, setIdx, w, r, sec, at }
 * for the page (WidgetBridgePlugin drain/ack) and moves on. Android does the same in WidgetLogger.java.
 */
enum WidgetLogger {
    static let stateKey = "widgetLoggerState"
    static let eventsKey = "widgetEvents"
    static let eventsMax = 200
    static let didChange = Notification.Name("OpenGymWidgetEvent")
    private static let lock = NSLock()

    /// What the widget shows for the set now.
    struct Shown: Hashable {
        var name = ""
        var line = ""
        var weight: String?
        var reps: Int?
        var seconds: Int?
        var wLabel = ""
        var rLabel = ""
        var secLabel = ""
        var allDone = false
        var allDoneText = ""
        var logSet = "Log set"
        var less = "Decrease"
        var more = "Increase"
    }

    static func logger() -> [String: Any]? {
        guard let url = OpenGymGroup.container?.appendingPathComponent("widget.json"),
              let data = try? Data(contentsOf: url),
              let snap = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lg = snap["logger"] as? [String: Any], lg["sets"] is [Any] else { return nil }
        return lg
    }

    private static func sets(_ lg: [String: Any]) -> [[String: Any]] { (lg["sets"] as? [[String: Any]]) ?? [] }

    private static func base(_ lg: [String: Any]) -> String {
        "\((lg["wid"] as? String) ?? "")|\((sets(lg).first?["k"] as? String) ?? "")"
    }

    static func state(for lg: [String: Any], stored: [String: Any]?) -> [String: Any] {
        let b = base(lg)
        if let st = stored, (st["base"] as? String) == b { return st }
        return ["base": b, "pos": 0]
    }

    private static func int(_ v: Any?) -> Int? { (v as? NSNumber)?.intValue }

    static func current(_ lg: [String: Any], _ st: [String: Any]) -> [String: Any]? {
        let all = sets(lg)
        let pos = int(st["pos"]) ?? 0
        return pos >= 0 && pos < all.count ? all[pos] : nil
    }

    static func weightIndex(_ set: [String: Any], _ st: [String: Any]) -> Int? {
        guard let w = set["w"] as? [String: Any], let v = w["v"] as? [Any], !v.isEmpty else { return nil }
        let i = int(st["wi"]) ?? int(w["i"]) ?? 0
        return max(0, min(v.count - 1, i))
    }

    static func reps(_ set: [String: Any], _ st: [String: Any]) -> Int? {
        guard let r = set["r"] as? [String: Any] else { return nil }
        return max(0, int(st["r"]) ?? int(r["v"]) ?? 0)
    }

    static func seconds(_ set: [String: Any], _ st: [String: Any]) -> Int? {
        guard let s = set["sec"] as? [String: Any] else { return nil }
        return max(0, int(st["sec"]) ?? int(s["v"]) ?? 0)
    }

    static func storedState() -> [String: Any]? {
        guard let data = OpenGymGroup.defaults.data(forKey: stateKey) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    /// The set the widget shows now, or nil with no workout running (or none for today).
    static func shown() -> Shown? {
        guard let lg = logger() else { return nil }
        let st = state(for: lg, stored: storedState())
        let labels = (lg["labels"] as? [String: Any]) ?? [:]
        var out = Shown()
        out.logSet = (labels["logSet"] as? String) ?? out.logSet
        out.less = (labels["less"] as? String) ?? out.less
        out.more = (labels["more"] as? String) ?? out.more
        guard let set = current(lg, st) else {
            out.allDone = true
            out.allDoneText = ((lg["more"] as? Bool) == true ? labels["openApp"] : labels["allDone"]) as? String ?? ""
            return out
        }
        out.name = (set["name"] as? String) ?? ""
        out.line = (set["line"] as? String) ?? ""
        if let i = weightIndex(set, st), let t = (set["w"] as? [String: Any])?["t"] as? [String], i < t.count { out.weight = t[i] }
        out.reps = reps(set, st)
        out.seconds = seconds(set, st)
        out.wLabel = (set["wLabel"] as? String) ?? ""
        out.rLabel = (set["rLabel"] as? String) ?? ""
        out.secLabel = (set["secLabel"] as? String) ?? ""
        return out
    }

    /// One button ("w-", "w+", "r-", "r+", "s-", "s+", "log"). Returns the queued event for Log set.
    @discardableResult
    static func press(_ op: String, now: Date = Date()) -> [String: Any]? {
        lock.lock(); defer { lock.unlock() }
        guard let lg = logger() else { return nil }
        var st = state(for: lg, stored: storedState())
        guard let set = current(lg, st) else { return nil }
        var event: [String: Any]?
        switch op {
        case "w-", "w+":
            if let i = weightIndex(set, st), let v = (set["w"] as? [String: Any])?["v"] as? [Any] {
                st["wi"] = max(0, min(v.count - 1, i + (op == "w+" ? 1 : -1)))
            }
        case "r-", "r+":
            if let r = reps(set, st) {
                let step = max(1, int((set["r"] as? [String: Any])?["step"]) ?? 1)
                st["r"] = max(0, r + (op == "r+" ? step : -step))
            }
        case "s-", "s+":
            if let s = seconds(set, st) {
                let step = max(1, int((set["sec"] as? [String: Any])?["step"]) ?? 5)
                st["sec"] = max(step, s + (op == "s+" ? step : -step))
            }
        case "log":
            var ev: [String: Any] = [
                "id": UUID().uuidString, "type": "setDone", "src": "widget", "wid": (lg["wid"] as? String) ?? "",
                "exId": (set["exId"] as? String) ?? "", "entryIdx": int(set["entryIdx"]) ?? 0, "setIdx": int(set["setIdx"]) ?? 0,
                "at": (now.timeIntervalSince1970 * 1000).rounded(),
            ]
            if let i = weightIndex(set, st), let v = (set["w"] as? [String: Any])?["v"] as? [NSNumber], i < v.count { ev["w"] = v[i] }
            if let r = reps(set, st) { ev["r"] = r }
            if let s = seconds(set, st) { ev["sec"] = s }
            var list = events()
            list.append(ev)
            if list.count > eventsMax { list.removeFirst(list.count - eventsMax) }
            writeEvents(list)
            st["pos"] = (int(st["pos"]) ?? 0) + 1
            st.removeValue(forKey: "wi")
            st.removeValue(forKey: "r")
            st.removeValue(forKey: "sec")
            event = ev
        default:
            break
        }
        if JSONSerialization.isValidJSONObject(st), let data = try? JSONSerialization.data(withJSONObject: st) { OpenGymGroup.defaults.set(data, forKey: stateKey) }
        return event
    }

    static func events() -> [[String: Any]] {
        guard let data = OpenGymGroup.defaults.data(forKey: eventsKey),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list
    }

    private static func writeEvents(_ list: [[String: Any]]) {
        if JSONSerialization.isValidJSONObject(list), let data = try? JSONSerialization.data(withJSONObject: list) { OpenGymGroup.defaults.set(data, forKey: eventsKey) }
    }

    static func remove(ids: Set<String>) {
        lock.lock(); defer { lock.unlock() }
        writeEvents(events().filter { !ids.contains(($0["id"] as? String) ?? "") })
    }
}

/// The widget's − and +: they change the widget's own copy of the set, in the widget extension.
@available(iOS 17.0, *)
struct WidgetStepIntent: AppIntent {
    static let title: LocalizedStringResource = "Change the set"
    static let isDiscoverable = false

    @Parameter(title: "Button") var op: String

    init() {}
    init(op: String) { self.op = op }

    func perform() async throws -> some IntentResult {
        WidgetLogger.press(op)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

/**
 * The widget's Log set. A LiveActivityIntent, so iOS runs it in the app (started in the background
 * if it has to be): the set is queued for the page, the Live Activity moves on with it, and a page
 * that is awake applies it at once (WidgetBridgePlugin hears didChange).
 */
@available(iOS 17.0, *)
struct WidgetLogSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Log set"
    static let isDiscoverable = false

    init() {}

    func perform() async throws -> some IntentResult {
        if let ev = WidgetLogger.press("log") {
            if let wid = ev["wid"] as? String, let exId = ev["exId"] as? String, let e = ev["entryIdx"] as? Int, let s = ev["setIdx"] as? Int {
                await LiveActivityTick.tick(wid: wid, exId: exId, entryIdx: e, setIdx: s, queue: false)
            }
            NotificationCenter.default.post(name: WidgetLogger.didChange, object: nil)
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: - number guards (v1.4.5)

/// Shared with the widget extension, which has no WatchCore: the same guards as SafeNum there.
/// A notification trigger raises an exception for an interval of 0 or less, and Int(Double) traps
/// on NaN and on anything past Int's range.
enum LiveNumbers {
    static func triggerSeconds(_ s: Double) -> TimeInterval {
        guard !s.isNaN else { return 1 }
        return min(max(1, s), 365 * 86_400)
    }

    /// "m:ss" for a paused rest or hold of `left` seconds; a NaN, negative or absurd one is 0:00.
    static func clock(_ left: Double) -> String {
        let s = left.isFinite ? Int(min(max(0, left), 360_000)) : 0
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
