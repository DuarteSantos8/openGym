import Foundation
import UIKit
import UserNotifications
import WatchConnectivity
import WatchKit

/*
 * The watch's side of a workout, around WatchCore's SessionCore (the session as plain data and
 * every change to it as a pure, tested function; its header lists the sync cases). This class
 * only feeds it what arrives (snapshots from the phone, taps), saves the result after every change
 * so a relaunch mid-workout loses nothing, and sends the events it returns with transferUserInfo,
 * which the system queues and delivers even when the phone app is not running.
 *
 * Exercise animations: never part of the watch app. The phone sends the running workout's own,
 * as small GIF files (WatchBridgePlugin.sendClips); they are kept only while that workout runs and
 * deleted when it ends. Without them the page shows the exercise by name.
 */

/// One animation, as frames to cycle through.
struct ClipFrames {
    let images: [UIImage]
    let duration: Double
}

final class SessionStore: NSObject, ObservableObject, WCSessionDelegate, UNUserNotificationCenterDelegate {
    /// Everything the watch knows about the session, saved after every change.
    @Published private(set) var state = SessionState() {
        didSet { if !isDemo, state != oldValue { save() } }
    }

    var workout: ActiveWorkout? { state.workout }
    var ready: Ready? { state.ready }
    var entryIndex: Int { state.entryIndex }
    var unit: String { workout?.unit ?? state.unit }
    var weightStep: Double { unit == "lb" ? 5 : 2.5 }
    var restHaptics: Bool { state.settings.restHaptics ?? true }
    /// What a workout screen shows (the phone's Settings → Apple Watch).
    var show: WatchShow { state.settings.show ?? WatchShow() }

    /* ---------- the app's language, not the watch's ---------- */

    /// The .lproj the watch has for the app's language ("pt" is pt-PT here, "zh" Simplified), or
    /// nil for English and for a language the watch has no words for.
    static func lproj(for lang: String?) -> String? {
        guard let l = lang, !l.isEmpty, l != "en" else { return nil }
        let map = ["pt": "pt-PT", "zh": "zh-Hans", "zh-TW": "zh-Hant"]
        let name = map[l] ?? l
        return Bundle.main.path(forResource: name, ofType: "lproj") != nil ? name : nil
    }

    /// The locale the views use (SwiftUI looks its strings up by it): the app's language from the
    /// phone; until the phone has said, the watch's own.
    var locale: Locale {
        guard let lang = state.settings.lang else { return .current }
        return Locale(identifier: SessionStore.lproj(for: lang) ?? "en")
    }

    /// A string in the app's language, for what is not a view (the rest notification).
    func L(_ key: String) -> String {
        guard let name = SessionStore.lproj(for: state.settings.lang),
              let path = Bundle.main.path(forResource: name, ofType: "lproj"),
              let bundle = Bundle(path: path) else {
            return state.settings.lang == nil ? NSLocalizedString(key, comment: "") : key
        }
        return bundle.localizedString(forKey: key, value: key, table: nil)
    }
    var crownStartsOnWeight: Bool { state.settings.crown == "weight" }

    /// Apple Health: the workout session, its heart rate, and the switch (WorkoutManager).
    let health = WorkoutManager()
    /// The running workout's animations, by exercise id, from the phone.
    @Published private(set) var clips: [String: ClipFrames] = [:]
    /// What happened to the animations, newest last (the hidden debug screen).
    @Published private(set) var clipLog: [String] = []
    @Published var weight: Double = 0 { didSet { if weight != oldValue { ackRestOver() } } }
    @Published var reps: Double = 0 { didSet { if reps != oldValue { ackRestOver() } } }
    /// A hold's seconds, for the set up next (the crown turns it).
    @Published var seconds: Double = 0 { didSet { if seconds != oldValue { ackRestOver() } } }
    /// A hold running: when it ends, and when it started.
    @Published private(set) var holdEndsAt: Date?
    @Published private(set) var holdStartedAt: Date?
    /// The end of the last workout, on one screen, until the lifter is done looking at it.
    @Published private(set) var summary: WorkoutSummary?
    /// Whether the phone is in reach now, and how many of this watch's events still wait for it.
    @Published private(set) var reachable = true
    @Published private(set) var queued = 0
    @Published private(set) var restEndsAt: Date?
    @Published private(set) var restStartedAt: Date?
    /// A set picked by hand in an exercise (entry index → set index); otherwise the first not done.
    @Published private var picked: [Int: Int] = [:]

    /// When the set now up began: the end of the rest before it, or the start of the session.
    private var setStartedAt = Date()
    /// The last Done, against a double tap.
    private var lastTick: Date?
    /// When this watch first had the running workout (its start, for a phone that sends none).
    private var workoutSeenAt: Date?
    /// The rest running after a set, for that rest's heart rate once it is over.
    private var restAfter: (exId: String, entryIdx: Int, setIdx: Int, wid: String, from: Date)?
    private var restTimer: Timer?
    private var holdTimer: Timer?
    /// The rest-over taps again once if nobody reacts to the first ones within a few seconds.
    private var restOverRepeat: DispatchWorkItem?
    private static let stateKey = "sessionState"
    private static let restNotificationId = "opengym.rest"
    private static var clipDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("clips")
    }

    static let demoArgument = "-OpenGymWatchDemo"
    /// CI screenshots: "-OpenGymWatchScreen rest" opens the demo on that screen.
    static var demoScreen: String? { argument("-OpenGymWatchScreen") }
    /// CI: a synthetic clip (not exercise media) shown on the demo's first exercise.
    static var demoClip: String? { argument("-OpenGymWatchDemoClip") }
    static func argument(_ name: String) -> String? {
        let a = ProcessInfo.processInfo.arguments
        guard let i = a.firstIndex(of: name), i + 1 < a.count else { return nil }
        return a[i + 1]
    }
    var isDemo: Bool { ProcessInfo.processInfo.arguments.contains(SessionStore.demoArgument) }

    override init() {
        super.init()
        if isDemo {
            startDemo()
        } else if let data = UserDefaults.standard.data(forKey: SessionStore.stateKey),
                  let saved = try? JSONDecoder().decode(SessionState.self, from: data) {
            // Relaunched (mid-workout or not): the session as it was, then the latest from the phone.
            state = saved
            loadTargets()
            // The Apple Health session of a workout that was running when the app was killed is
            // recovered (WatchAppDelegate.handleActiveWorkoutRecovery); a new one starts only if
            // none came back by then, so one workout never becomes two.
            if let w = saved.workout {
                workoutSeenAt = w.start.map { Date(timeIntervalSince1970: $0 / 1000) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                    guard let self = self, self.state.workout?.id == w.id else { return }
                    self.health.start(workoutId: w.id)
                }
            }
        }
        health.onStatus = { [weak self] in self?.sendStatus() }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        if !isDemo { center.requestAuthorization(options: [.alert, .sound]) { _, _ in } }
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(state) { UserDefaults.standard.set(data, forKey: SessionStore.stateKey) }
    }

    /* ---------- what the views read ---------- */

    var entry: Entry? {
        guard let w = workout, w.entries.indices.contains(entryIndex) else { return nil }
        return w.entries[entryIndex]
    }

    var setIndex: Int? { setIndex(in: entryIndex) }
    func setIndex(in ei: Int) -> Int? { SessionCore.setIndex(state, entry: ei, picked: picked[ei]) }

    var progress: (done: Int, total: Int) { SessionCore.progress(state) }

    /// When the running workout started: the phone's start, else when this watch first had it.
    var workoutStart: Date? {
        if let ms = workout?.start, ms > 0 { return Date(timeIntervalSince1970: ms / 1000) }
        return workout == nil ? nil : workoutSeenAt
    }

    /// Events wait on the watch for a phone out of reach: "Saved on the watch, syncs later".
    var offline: Bool { queued > 0 && !reachable }

    func isSkipped(_ exId: String, _ si: Int) -> Bool { SessionCore.isSkipped(state, exId, si) }

    /// The side of a per-side set that is up ("L" or "R"), or nil.
    var sideUp: String? {
        guard let e = entry, let si = setIndex else { return nil }
        return e.sets[si].sideUp
    }

    func pick(set si: Int, in ei: Int) {
        ackRestOver()
        picked[ei] = si
        if ei == entryIndex { loadTargets() }
    }

    /// Paging to another exercise (a vertical swipe).
    func show(entry ei: Int) {
        guard ei != state.entryIndex else { return }
        ackRestOver()
        state.entryIndex = ei
        loadTargets()
    }

    /// What the complications and the Smart Stack widget show (WidgetState), in the app's language.
    var widgetState: WidgetState {
        var w = widgetStateWithoutLang
        w.lang = state.settings.lang
        return w
    }

    private var widgetStateWithoutLang: WidgetState {
        if let w = workout {
            let p = progress
            if let end = restEndsAt, end > Date() {
                return WidgetState(mode: "rest", title: entry?.name ?? w.name, detail: "", restEndsAt: end, done: p.done, total: p.total)
            }
            if let e = entry, let si = setIndex {
                let s = e.sets[si]
                let added = s.w ?? 0
                let numbers: String = e.isTimed ? "\(formatNumber(s.sec ?? 0)) s"
                    : e.isCardio ? ""
                    : e.isBodyweight ? (added > 0 ? "+\(formatNumber(added)) \(w.unit) × \(formatNumber(s.r ?? 0))" : "× \(formatNumber(s.r ?? 0))")
                    : "\(formatNumber(s.w ?? 0)) \(w.unit) × \(formatNumber(s.r ?? 0))"
                let work = e.sets.filter { !$0.warmup }.count
                return WidgetState(mode: "set", title: e.name, detail: numbers, restEndsAt: nil, done: p.done, total: p.total,
                                   setLabel: "\(min(si + 1, max(1, work)))/\(max(1, work))")
            }
            return WidgetState(mode: "set", title: w.name, detail: "", restEndsAt: nil, done: p.done, total: p.total)
        }
        if let today = ready?.today {
            let total = today.entries.flatMap { $0.sets }.filter { !$0.warmup }.count
            return WidgetState(mode: "today", title: today.name, detail: "", restEndsAt: nil, done: 0, total: total)
        }
        return .idle
    }

    /// HealthKit opened the app for a workout started on the iPhone: the workout session starts
    /// now (Apple expects one right away), for the workout the phone sent or is about to send.
    func openedForWorkout() {
        DispatchQueue.main.async {
            self.log("opened by the phone for a workout")
            if WCSession.isSupported(), let json = WCSession.default.receivedApplicationContext["snapshot"] as? String {
                self.apply(json: json)
            }
            self.health.start(workoutId: self.state.workout?.id)
            // Nothing came after all (the phone's workout was discarded at once): no session left running.
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
                if self.state.workout == nil { self.health.end(save: false) }
            }
        }
    }

    /* ---------- snapshots from the phone ---------- */

    func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            let before = self.state
            let next = SessionCore.applySnapshot(before, snap)
            self.state = next
            if let ended = before.workout, next.workout == nil {
                // Ended on the phone (finished or discarded there): the session here ends too, and the
                // watch says so instead of quietly going back to the start screen.
                if !self.isDemo {
                    self.summary = SessionCore.summary(ended, end: Date().timeIntervalSince1970 * 1000,
                                                       startedAt: self.workoutSeenAt.map { $0.timeIntervalSince1970 * 1000 }, endedOnPhone: true)
                }
                self.ran(ended.id)
                self.health.end(save: true) { totals in self.addTotals(totals) }
                self.dropClips()
                self.stopHold()
                self.skipRest()
            } else if next.workout != nil && next.workout?.id != before.workout?.id {
                // A workout this watch picks up (the app opened mid-workout, or the phone started one).
                self.setStartedAt = Date()
                self.workoutSeenAt = Date()
                self.picked = [:]
                self.summary = nil
                self.health.start(workoutId: next.workout?.id)
            }
            if let rest = snap.active?.rest, next.workout?.id == snap.active?.id {
                let end = Date(timeIntervalSince1970: rest.endsAt / 1000)
                if end != self.restEndsAt { self.startRest(until: end, notify: true) }
            }
            self.health.syncSetting(next.settings.health)
            self.removeDeletedFromHealth(snap.healthGone)
            self.loadTargets()
        }
    }

    /// The weight and reps the crown starts from: the set's own target.
    func loadTargets() {
        guard let e = entry else { return }
        let s = setIndex.map { e.sets[$0] } ?? e.sets.last
        if let row = s, let side = row.sideUp, let one = row.sides?[side] {
            weight = one.w ?? row.w ?? 0
            reps = one.r ?? 0
        } else {
            weight = s?.w ?? 0
            reps = s?.r ?? 0
        }
        seconds = s?.sec ?? 30
    }

    /* ---------- what the lifter does here ---------- */

    /// The set up next, done: the numbers on the screen (a hold's seconds as it lasted, one side of
    /// a per-side set, nothing for cardio), then where SessionCore.next says, with a rest when due.
    func completeSet(sec heldFor: Double? = nil) {
        guard let w = workout, let e = entry, let si = setIndex else { return }
        // A double tap on Done (a sweaty finger) is one set, not this one and the next.
        if heldFor == nil, let last = lastTick, Date().timeIntervalSince(last) < 0.7 { return }
        lastTick = Date()
        ackRestOver()
        let ei = entryIndex
        let now = Date()
        let setFrom = setStartedAt
        closeRest(at: now)
        let hr = health.stats(from: setFrom, to: now)
        let side = e.sets[si].sideUp
        var tw: Double? = nil, tr: Double? = nil, tsec: Double? = nil
        if e.isTimed {
            tsec = heldFor ?? seconds
            if (e.sets[si].w ?? 0) > 0 { tw = weight }       // a weighted hold keeps its weight
        } else if !e.isCardio {
            tw = weight
            tr = reps
        }
        let (next, event) = SessionCore.tick(state, entry: ei, set: si, side: side, w: tw, r: tr, sec: tsec,
                                             at: now.timeIntervalSince1970 * 1000, id: UUID().uuidString, hr: hr)
        // Sent first, saved second: killed in between, the phone still has the tick (and the next
        // snapshot brings it back here); the other way round the tick would be lost on the phone.
        if let event = event { send(event: event) }
        state = next
        setStartedAt = now
        picked[ei] = nil
        let (to, rest) = SessionCore.next(after: state, entry: ei, set: si)
        if side != nil && !rest {
            Haptics.side()          // the other side now
        } else {
            Haptics.done()
        }
        let restFor = e.restSec ?? w.restSec
        if rest && restFor > 0 && to < (workout?.entries.count ?? 0) {
            startRest(until: now.addingTimeInterval(restFor), notify: true)
            restAfter = (e.id, ei, si, w.id ?? "", now)
        }
        if to != ei { state.entryIndex = to }
        loadTargets()
    }

    /// A set passed over (a long press on Done): not done, the next one comes up.
    func skipSet() {
        guard let si = setIndex else { return }
        ackRestOver()
        let ei = entryIndex
        state = SessionCore.skip(state, entry: ei, set: si)
        picked[ei] = nil
        if setIndex == nil {
            let (to, _) = SessionCore.next(after: state, entry: ei, set: si)
            state.entryIndex = to
        }
        loadTargets()
        Haptics.skip()
    }

    /* ---------- holds (timed sets) ---------- */

    /// The hold starts: a countdown from the seconds on the screen; at zero it is done by itself.
    func startHold() {
        guard entry?.isTimed == true, setIndex != nil, seconds > 0 else { return }
        ackRestOver()
        skipRest()
        let now = Date()
        let end = now.addingTimeInterval(seconds)
        holdStartedAt = now
        holdEndsAt = end
        Haptics.start()
        holdTimer?.invalidate()
        holdTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { self?.endHold(early: false) }
        }
    }

    /// Stopped by hand: done with the seconds it lasted (a hold under a second is not one).
    func endHold(early: Bool) {
        guard let from = holdStartedAt, let end = holdEndsAt else { return }
        let lasted = early ? Date().timeIntervalSince(from).rounded() : end.timeIntervalSince(from).rounded()
        stopHold()
        if lasted >= 1 { completeSet(sec: lasted) }
    }

    /// The hold ends without a set (the workout ended meanwhile).
    func stopHold() {
        holdTimer?.invalidate()
        holdTimer = nil
        holdEndsAt = nil
        holdStartedAt = nil
    }

    /* ---------- the summary ---------- */

    /// The heart rate and calories of the session that just ended, when Apple Health has them.
    private func addTotals(_ t: WorkoutManager.Totals) {
        guard var s = summary else { return }
        s.hrAvg = t.hrAvg
        s.hrMax = t.hrMax
        s.calories = t.calories
        summary = s
    }

    func closeSummary() {
        summary = nil
    }

    /* ---------- workouts deleted in openGym, out of Apple Health ---------- */

    private static let healthDeletedKey = "healthDeleted"
    private var healthDeleting = false
    /// The last few workouts that ran here (their Apple Health copy may still be being saved).
    private var recentWorkouts: [String] = []
    private func ran(_ wid: String?) {
        guard let wid = wid else { return }
        recentWorkouts = Array((recentWorkouts.filter { $0 != wid } + [wid]).suffix(3))
    }

    /// The copies this watch saved of workouts deleted in openGym: taken out once (the ids settled
    /// are remembered), and the phone told, so it stops retrying what it could not delete itself.
    private func removeDeletedFromHealth(_ gone: [String]?) {
        guard !isDemo, !healthDeleting else { return }
        let done = UserDefaults.standard.stringArray(forKey: SessionStore.healthDeletedKey) ?? []
        let todo = SessionCore.healthToDelete(gone: gone, done: done)
        guard !todo.isEmpty else { return }
        healthDeleting = true
        let recent = Set(recentWorkouts.map { "opengym-w-\($0)" })
        health.deleteWorkouts(syncIds: todo, keepTrying: recent) { [weak self] settled in
            guard let self = self else { return }
            self.healthDeleting = false
            guard !settled.isEmpty else { return }
            let now = UserDefaults.standard.stringArray(forKey: SessionStore.healthDeletedKey) ?? []
            UserDefaults.standard.set(SessionCore.healthDeleted(now, adding: settled), forKey: SessionStore.healthDeletedKey)
            if let ev = SessionCore.healthDeletedEvent(settled, id: UUID().uuidString) { self.send(event: ev) }
            self.log("removed from Apple Health: \(settled.count)")
        }
    }

    /// The weigh-in before a workout started here (the phone's check-in), when the phone asks for one.
    @Published private(set) var weighInFor: ReadySession?
    /// The body weight on the weigh-in's crown.
    @Published var bodyWeight: Double = 70

    /// Starts a ready session here, the phone asleep or not: first the weigh-in, as on the phone,
    /// unless it is switched off there (Settings → During a workout).
    func start(_ session: ReadySession) {
        if state.settings.weighIn != false && !isDemo {
            bodyWeight = state.settings.lastBw ?? (unit == "lb" ? 160 : 70)
            weighInFor = session
            return
        }
        begin(session, bw: nil)
    }

    /// The weigh-in answered: saved (a weigh-in for the phone, and the session's body weight) or
    /// skipped; the workout starts either way. `nil` session: cancelled, nothing starts.
    func finishWeighIn(save: Bool) {
        guard let session = weighInFor else { return }
        weighInFor = nil
        var bw: Double? = nil
        if save, let ev = SessionCore.weighIn(bodyWeight, at: Date().timeIntervalSince1970 * 1000, id: UUID().uuidString) {
            send(event: ev)
            bw = bodyWeight
        }
        begin(session, bw: bw)
    }

    func cancelWeighIn() { weighInFor = nil }

    private func begin(_ session: ReadySession, bw: Double?) {
        let now = Date()
        let (next, event) = SessionCore.start(state, session, wid: "watch-" + UUID().uuidString,
                                              at: now.timeIntervalSince1970 * 1000, id: UUID().uuidString, bw: bw)
        send(event: event)
        state = next
        picked = [:]
        setStartedAt = now
        workoutSeenAt = now
        restAfter = nil
        loadTargets()
        health.start(workoutId: next.workout?.id)
        summary = nil
        Haptics.start()
    }

    /// Finishes the session: the phone saves it with its own Finish and save.
    func finish() {
        closeRest(at: Date())
        let now = Date().timeIntervalSince1970 * 1000
        let ended = workout
        let (next, event) = SessionCore.finish(state, at: now, id: UUID().uuidString)
        guard let ev = event else { return }
        if let w = ended { summary = SessionCore.summary(w, end: now, startedAt: workoutSeenAt.map { $0.timeIntervalSince1970 * 1000 }) }
        ran(ended?.id)
        health.end(save: true) { [weak self] totals in self?.addTotals(totals) }
        stopHold()
        skipRest()
        dropClips()
        send(event: ev)
        state = next
        Haptics.finished()
    }

    func skipRest() {
        ackRestOver()
        closeRest(at: Date())
        restTimer?.invalidate()
        restEndsAt = nil
        restStartedAt = nil
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [SessionStore.restNotificationId])
    }

    func addRest(_ seconds: TimeInterval) {
        guard let end = restEndsAt else { return }
        ackRestOver()
        let start = restStartedAt
        startRest(until: end.addingTimeInterval(seconds), notify: true)
        restStartedAt = start
    }

    /// The rest as a timer here (with the app in front: the haptic pattern) and as a notification
    /// for its end (with the app not in front: banner and haptic from the system). A new rest or a
    /// skip takes the old one back.
    private func startRest(until end: Date, notify: Bool) {
        restTimer?.invalidate()
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [SessionStore.restNotificationId])
        guard end > Date() else { restEndsAt = nil; restStartedAt = nil; return }
        restEndsAt = end
        restStartedAt = Date()
        restTimer = Timer.scheduledTimer(withTimeInterval: end.timeIntervalSinceNow, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { self?.restOver() }
            DispatchQueue.main.async {
                self?.closeRest(at: Date())
                self?.restEndsAt = nil
                self?.restStartedAt = nil
            }
        }
        guard notify, !isDemo else { return }
        let content = UNMutableNotificationContent()
        content.title = L("Rest’s over. Next set!")
        if let e = entry, let si = setIndex {
            content.body = String(format: L("%@, set %lld"), e.name, Int64(si + 1))
        }
        content.sound = restHaptics ? .default : nil
        content.interruptionLevel = .timeSensitive
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, end.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: SessionStore.restNotificationId, content: content, trigger: trigger))
    }

    /// The rest after a set is over (it ran out, was skipped, or the next set is done): its heart
    /// rate goes to that set, and the next set starts counting from here.
    private func closeRest(at end: Date) {
        guard let r = restAfter else { return }
        restAfter = nil
        setStartedAt = end
        guard let hr = health.stats(from: r.from, to: end) else { return }
        send(event: [
            "id": UUID().uuidString, "type": "setHr", "wid": r.wid, "exId": r.exId,
            "entryIdx": r.entryIdx, "setIdx": r.setIdx, "restHr": hr,
        ])
    }

    /// The rest ran out with the app in front: the alarm on the wrist (when the phone's "tap the
    /// wrist" is on), once more after a few seconds if nobody reacts (a tap, the crown, a set).
    private func restOver() {
        guard restHaptics, !isDemo else { return }
        Haptics.restOver()
        restOverRepeat?.cancel()
        let again = DispatchWorkItem { Haptics.restOver() }
        restOverRepeat = again
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: again)
    }

    /// Anything the lifter does: the rest-over alarm has been noticed.
    func ackRestOver() {
        restOverRepeat?.cancel()
        restOverRepeat = nil
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    private func send(event: [String: Any]) {
        guard !isDemo, WCSession.isSupported(),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        transfer(json)
    }

    /// Events made before the session was up (a tap right after launch) wait here, saved, and go out
    /// once it is: transferUserInfo before activation would lose them.
    private static let outboxKey = "outbox"
    private var outbox: [String] {
        get { UserDefaults.standard.stringArray(forKey: SessionStore.outboxKey) ?? [] }
        set { UserDefaults.standard.set(newValue, forKey: SessionStore.outboxKey) }
    }

    private func transfer(_ json: String, tries: Int = 0) {
        let session = WCSession.default
        guard session.activationState == .activated else {
            outbox = Array((outbox + [json]).suffix(500))
            return
        }
        // Queued by the system and delivered, in order, even when the phone app is not running.
        session.transferUserInfo(["event": json, "tries": tries])
        updateLink()
    }

    private func flushOutbox() {
        let waiting = outbox
        guard !waiting.isEmpty, WCSession.default.activationState == .activated else { return }
        outbox = []
        waiting.forEach { transfer($0) }
    }

    /// The phone in reach or not, and the events still on their way: the small "syncs later" sign.
    private func updateLink() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        let r = session.activationState == .activated && session.isReachable
        let q = session.outstandingUserInfoTransfers.count
        DispatchQueue.main.async {
            if self.reachable != r { self.reachable = r }
            if self.queued != q { self.queued = q }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) { updateLink() }

    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        // A transfer that failed is not tried again by the system: sent again from here, a few
        // times (the phone applies each event once, by its id, so a second copy does no harm).
        if error != nil, let json = userInfoTransfer.userInfo["event"] as? String {
            let tries = (userInfoTransfer.userInfo["tries"] as? Int) ?? 0
            if tries < 3 { DispatchQueue.main.asyncAfter(deadline: .now() + 5) { self.transfer(json, tries: tries + 1) } }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.updateLink() }
    }

    /* ---------- the animations ---------- */

    private func log(_ line: String) {
        let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        DispatchQueue.main.async { self.clipLog = Array((self.clipLog + ["\(stamp) \(line)"]).suffix(30)) }
    }

    /// The workout is over: its animations go, from memory and from the disk.
    func dropClips() {
        clips = [:]
        try? FileManager.default.removeItem(at: SessionStore.clipDir)
        log("clips deleted")
    }

    static func frames(of url: URL) -> ClipFrames? {
        guard let f = ClipCodec.decode(url) else { return nil }
        return ClipFrames(images: f.images.map { UIImage(cgImage: $0) }, duration: f.duration)
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // The file is gone once this returns: moved into the cache now.
        guard let exId = file.metadata?["exId"] as? String else { log("file without an exercise"); return }
        let dir = SessionStore.clipDir
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(exId.replacingOccurrences(of: "/", with: "_") + ".gif")
        try? FileManager.default.removeItem(at: dest)
        guard (try? FileManager.default.moveItem(at: file.fileURL, to: dest)) != nil else { log("\(exId): could not keep the file"); return }
        guard let frames = SessionStore.frames(of: dest) else { log("\(exId): could not decode"); return }
        let wid = file.metadata?["wid"] as? String
        log("\(exId): \(frames.images.count) frames, \(String(format: "%.1f", frames.duration)) s")
        DispatchQueue.main.async {
            // Only for the workout running here; a late file of an earlier one is dropped.
            guard self.workout != nil, wid == nil || wid == self.workout?.id else {
                try? FileManager.default.removeItem(at: dest)
                self.log("\(exId): not for this workout, dropped")
                return
            }
            self.clips[exId] = frames
        }
    }

    /* ---------- WCSessionDelegate ---------- */

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // The phone's latest snapshot: also what a watch app opened mid-workout picks the session up from.
        if let json = session.receivedApplicationContext["snapshot"] as? String { apply(json: json) }
        DispatchQueue.main.async { self.flushOutbox() }
        sendStatus()
        updateLink()
    }

    /// What the phone's Settings → Apple Watch shows about this watch.
    func sendStatus() {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        send(event: ["id": UUID().uuidString, "type": "watchStatus", "health": health.status, "version": version,
                     "at": Date().timeIntervalSince1970 * 1000])
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["snapshot"] as? String { apply(json: json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let json = message["snapshot"] as? String { apply(json: json) }
    }

    /* ---------- the demo the CI screenshots show (text only; a synthetic clip at most) ---------- */

    /// CI: the screens at an accessibility text size (OpenGymWatchApp reads it too).
    static var demoAX: Bool { ProcessInfo.processInfo.arguments.contains("-OpenGymWatchAX") }
    /// CI: as in Always On (wrist down), for what it costs to keep the screen up to date.
    static var demoAOD: Bool { ProcessInfo.processInfo.arguments.contains("-OpenGymWatchAOD") }

    /// One screen of the demo workout (demoJSON: every kind of set), as CI photographs it.
    private func startDemo() {
        let screen = SessionStore.demoScreen ?? "set"
        if screen != "empty" { apply(json: screen == "idle" ? SessionStore.demoReadyJSON : SessionStore.demoJSON) }
        DispatchQueue.main.async {
            switch screen {
            case "set", "weight", "rest", "offline", "edit-weight", "edit-reps": self.picked[0] = 2
            case "hold": self.state.entryIndex = 1
            case "bodyweight": self.state.entryIndex = 2
            case "side": self.state.entryIndex = 3
            case "superset": self.state.entryIndex = 4
            case "finish": self.state.entryIndex = self.workout?.entries.count ?? 0
            case "weighin":
                self.bodyWeight = 81.4
                self.weighInFor = ReadySession(routineIds: ["r1"], name: "Push day", entries: [])
            default: break
            }
            // CI: the watch in another language than its own (the app's, as the phone sends it).
            if let lang = SessionStore.argument("-OpenGymWatchLang") { self.state.settings.lang = lang }
            if let show = SessionStore.argument("-OpenGymWatchShow") {
                // "all": every optional thing on, for a look at the fullest screen.
                if show == "all" { self.state.settings.show = WatchShow(clip: true, hr: true, last: true, elapsed: true, kcal: true, next: true, rest: "ring") }
                if show == "plain" { self.state.settings.show = WatchShow(rest: "plain") }
                if show == "noclip" { self.state.settings.show = WatchShow(clip: false) }
            }
            self.loadTargets()
            if screen == "rest" { self.startRest(until: Date().addingTimeInterval(83), notify: false) }
            if screen == "hold" { self.startHold() }
            if screen == "offline" { self.reachable = false; self.queued = 3 }
            if screen == "summary" || screen == "summary-end" || screen == "ended" {
                self.summary = WorkoutSummary(name: "Push day", unit: "kg", duration: 52 * 60 + 13, sets: 17, volume: 4320,
                                              prs: ["Bench Press", "Plank"], hrAvg: 118, hrMax: 156, calories: 312,
                                              endedOnPhone: screen == "ended")
            }
            if let path = SessionStore.demoClip, let frames = SessionStore.frames(of: URL(fileURLWithPath: path)) {
                self.clips["0025"] = frames
                self.log("demo clip: \(frames.images.count) frames")
            }
        }
    }

    static let demoReadyJSON = """
    {"v":1,"unit":"kg","restSec":90,"active":null,"ready":{"today":{"routineIds":["r1"],"name":"Push day","entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":null,"sets":[{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]}]},
    "others":[{"routineIds":["r2"],"name":"Pull day","entries":[]},{"routineIds":["r3"],"name":"Legs","entries":[]}]}}
    """

    static let demoJSON = """
    {"v":1,"unit":"kg","restSec":90,"ready":null,"active":{"id":"demo","name":"Push day","unit":"kg","cur":0,"restSec":90,"rest":null,"start":0,"entries":[
    {"id":"0025","name":"Bench Press","mode":"reps","restSec":120,"last":"60 kg × 8, 60 kg × 8, 60 kg × 7","best":{"w":62.5,"r":8},"step":2.5,"sets":[
    {"w":40,"r":10,"sec":null,"done":false,"warmup":true},{"w":60,"r":8,"sec":null,"done":true,"warmup":false,"at":1},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false},{"w":62.5,"r":8,"sec":null,"done":false,"warmup":false}]},
    {"id":"plank","name":"Plank","mode":"time","restSec":60,"last":null,"best":{"sec":60},"sets":[
    {"w":null,"r":null,"sec":45,"done":false,"warmup":false},{"w":null,"r":null,"sec":45,"done":false,"warmup":false}]},
    {"id":"pullup","name":"Pull-up","mode":"reps","restSec":null,"last":null,"bodyweight":true,"sets":[
    {"w":0,"r":8,"sec":null,"done":false,"warmup":false},{"w":5,"r":6,"sec":null,"done":false,"warmup":false}]},
    {"id":"split","name":"Bulgarian Split Squat","mode":"reps","restSec":null,"last":null,"perSide":true,"sets":[
    {"w":20,"r":16,"sec":null,"done":false,"warmup":false,"sides":{"L":{"w":20,"r":8,"done":true},"R":{"w":20,"r":8,"done":false}}},
    {"w":20,"r":16,"sec":null,"done":false,"warmup":false,"sides":{"L":{"w":20,"r":8,"done":false},"R":{"w":20,"r":8,"done":false}}}]},
    {"id":"curl","name":"Biceps Curl","mode":"reps","restSec":null,"last":null,"group":"s1","sets":[
    {"w":12,"r":10,"sec":null,"done":false,"warmup":false},{"w":12,"r":10,"sec":null,"done":false,"warmup":false}]},
    {"id":"pushdown","name":"Triceps Pushdown","mode":"reps","restSec":null,"last":null,"group":"s1","sets":[
    {"w":25,"r":12,"sec":null,"done":false,"warmup":false},{"w":25,"r":12,"sec":null,"done":false,"warmup":false}]}]}}
    """
}

/*
 * The watch's taps, one pattern per meaning, so the wrist alone says what happened:
 *   done       one firm tap (a set logged)
 *   side       a light click (one side of a per-side set: the other one now)
 *   restOver   an alarm: two strong taps and a rising one (again after 5 s if not noticed)
 *   start      the system's start
 *   finished   stop, then two successes: the workout is saved
 *   skip       a soft one going down
 */
enum Haptics {
    private static var device: WKInterfaceDevice { WKInterfaceDevice.current() }
    private static func play(_ steps: [(Double, WKHapticType)]) {
        for (delay, type) in steps {
            if delay == 0 { device.play(type) } else { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { device.play(type) } }
        }
    }
    static func done() { play([(0, .success)]) }
    static func side() { play([(0, .click)]) }
    static func restOver() { play([(0, .notification), (0.45, .notification), (0.9, .directionUp)]) }
    static func start() { play([(0, .start)]) }
    static func finished() { play([(0, .stop), (0.5, .success), (0.9, .success)]) }
    static func skip() { play([(0, .directionDown)]) }
}
