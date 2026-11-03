import ActivityKit
import AppIntents
import Foundation
import UserNotifications

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

        /// A rest is counting down or held.
        var resting: Bool { restEndsAt != nil || restLeft != nil }

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

        /// The running rest as a range Text(timerInterval:) can count down, or nil.
        var restRange: ClosedRange<Date>? {
            guard let end = restEndsAt else { return nil }
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
        if let data = try? JSONSerialization.data(withJSONObject: list) {
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

@available(iOS 17.0, *)
enum LiveActivityTick {
    static let restRequestId = "opengym.rest"   // RestAlertPlugin.requestId: the page's own replaces it

    static func tick(wid: String, exId: String, entryIdx: Int, setIdx: Int, now: Date = Date()) async {
        guard let activity = Activity<WorkoutActivityAttributes>.activities.first(where: { $0.attributes.wid == wid }) else { return }
        let state = activity.content.state
        // A button from a state already moved on (two quick taps): that set is ticked already.
        guard let cur = state.cur, cur.exId == exId, cur.entryIdx == entryIdx, cur.setIdx == setIdx else { return }
        LiveActivityQueue.append([
            "id": UUID().uuidString, "type": "setDone", "wid": wid, "exId": exId,
            "entryIdx": entryIdx, "setIdx": setIdx, "at": (now.timeIntervalSince1970 * 1000).rounded(),
        ])
        var next = state
        next.cur = state.ahead.first
        next.ahead = Array(state.ahead.dropFirst())
        next.done = min(state.total, state.done + 1)
        next.unitStarts = state.startsAfter(next.cur)
        next.restLeft = nil
        if cur.restAfter > 0, next.cur != nil {
            let end = now.addingTimeInterval(TimeInterval(cur.restAfter))
            next.restEndsAt = end.timeIntervalSince1970 * 1000
            next.restTotal = Double(cur.restAfter)
            bookRestOver(at: end, title: activity.attributes.labels.restOver)
        } else {
            next.restEndsAt = nil
            next.restTotal = nil
        }
        await activity.update(ActivityContent(state: next, staleDate: nil))
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
        await activity.update(ActivityContent(state: next, staleDate: nil))
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
        await activity.update(ActivityContent(state: next, staleDate: nil))
        NotificationCenter.default.post(name: LiveActivityQueue.didChange, object: nil)
    }

    private static func bookRestOver(at: Date, title: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.sound = .default
        content.interruptionLevel = .active
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, at.timeIntervalSinceNow), repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: restRequestId, content: content, trigger: trigger))
    }
}
