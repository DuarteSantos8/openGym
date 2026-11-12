import Foundation
import HealthKit
import SwiftUI
import UIKit
import UserNotifications
import WatchConnectivity
import WatchKit

/*
 * The watch's side of a workout, around WatchCore's SessionCore (the session as plain data and
 * every change to it as a pure, tested function; its header lists the sync cases). This class
 * only feeds it what arrives (snapshots from the phone, taps), saves the result after every change
 * so a relaunch mid-workout loses nothing, and sends the events it returns through the outbox
 * (WatchCore Outbox.swift): saved first, then a message while the phone is in reach, else
 * transferUserInfo (queued by the system, delivered even when the phone app is not running), and
 * sent again until a snapshot says the phone applied it.
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
        didSet {
            if !isDemo, state != oldValue { save() }
            // The page changed without a swipe (Done moved on, a snapshot): a moment without taps.
            if state.entryIndex != oldValue.entryIndex { touchLock.lock(at: Date()) }
            if state.workout?.id != oldValue.workout?.id { watchIdle() }
            // The menu's set is gone (removed on the phone, the workout ended or changed): it closes,
            // or its black layer would stay up with nothing on it (review 2026-11-12).
            // Another set now at its index (the phone took out one before it) closes it too, so a tap cannot hit the wrong set.
            if let m = menuFor, state.workout?.id != oldValue.workout?.id || state.workout?.entries[safe: m.entry]?.sets[safe: m.set] == nil
                || state.workout?.entries[safe: m.entry]?.sets[safe: m.set] != oldValue.workout?.entries[safe: m.entry]?.sets[safe: m.set] {
                menuFor = nil
            }
        }
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

    /// The app's accent as the phone sends it (its dark shade), and the ink on it; green and black
    /// until the phone has said.
    var accent: Color { Color(hex: state.settings.accent) ?? Theme.green }
    var onAccent: Color { Color(hex: state.settings.onAccent) ?? Theme.onGreen }

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
    /// The scale the phone's profile logs, when it logs one ("rpe" / "rir"): the set page offers it.
    var effortKind: String? { Effort.notches(state.settings.effort) != nil ? state.settings.effort : nil }
    /// A hold running: when it ends, and when it started.
    @Published private(set) var holdEndsAt: Date?
    @Published private(set) var holdStartedAt: Date?
    /// The end of the last workout, on one screen, until the lifter is done looking at it.
    @Published private(set) var summary: WorkoutSummary?
    /// Whether the phone is in reach now, and how many of this watch's events still wait for it.
    @Published private(set) var reachable = true
    @Published private(set) var queued = 0
    /// Sets logged here that have not reached the phone yet (OutboxCore.waitingSets).
    @Published private(set) var unsentSets = 0
    /// Whether a snapshot from the phone ever arrived on this watch. The phone sends only while
    /// openGym runs there, so until then the start screen says to open it once.
    @Published private(set) var heardFromPhone = UserDefaults.standard.bool(forKey: SessionStore.heardKey)
    private static let heardKey = "heardFromPhone"
    @Published private(set) var restEndsAt: Date?
    @Published private(set) var restStartedAt: Date?
    /// The last rest end a snapshot carried (ms): followed once, not again.
    private var phoneRestEnd: Double?
    /// The id of the last set ticked here, until a snapshot names it applied: that snapshot's rest
    /// is the phone's copy of the watch's own (RestMath.phoneRest), only on main.
    private var echoOf: String?
    /// "Still training?": the workout has had no set logged for the phone's quiet spell (WatchCore's Idle).
    @Published var askDone = false
    /// The question is "Looks like you left the gym" (the phone walked out of the gym).
    @Published private(set) var idleLeft = false
    /// When the workout ends by itself if nobody answers, for the card's words.
    @Published private(set) var idleEndsAt: Date?
    /// How long nothing has happened in the workout, for the card's words.
    @Published private(set) var idleMinutes = 0
    /// A set picked by hand in an exercise (entry index → set index); otherwise the first not done.
    @Published private var picked: [Int: Int] = [:]

    /// When the set now up began: the end of the rest before it, or the start of the session.
    private var setStartedAt = Date()
    /// The last Done, against a double tap.
    private var lastTick: Date?
    /// Taps ignored for a second after the watch turns the page by itself (WatchCore's TouchLock).
    private var touchLock = TouchLock()
    var touchAllowed: Bool { touchLock.allows(at: Date()) }
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
            // A workout left open for hours (SensorPlan) starts no session until something happens in it.
            if let w = saved.workout {
                workoutSeenAt = w.start.map { Date(timeIntervalSince1970: $0 / 1000) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                    guard let self = self, self.state.workout?.id == w.id else { return }
                    if !SensorPlan.idle(w, seen: nil, now: Date().timeIntervalSince1970 * 1000, busy: false) {
                        self.health.start(workoutId: w.id, type: w.healthType)
                    }
                    self.armIdleCheck()
                    // `state = saved` above ran in init, where its didSet does not: the forgotten-
                    // workout check is armed here (a workout left running overnight ends now).
                    self.watchIdle()
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
        // A removal whose Undo time the app did not live through: it goes out now (review 2026-11-12).
        if !isDemo, let d = UserDefaults.standard.data(forKey: Self.heldKey) {
            UserDefaults.standard.removeObject(forKey: Self.heldKey)
            if let ev = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { send(event: ev) }
        }
    }

    /* ---------- the heart-rate sensor in a workout nobody finishes (SensorPlan) ---------- */

    /// The last thing that happened here or came from the phone in the running workout.
    private var activityAt: Date?
    private var idleCheck: DispatchWorkItem?

    /// Something happened in the workout: a paused session resumes (or one starts, for a restored
    /// workout that was idle at launch), and the idle check moves out.
    private func noteActivity() {
        guard !isDemo, let w = workout else { return }
        activityAt = Date()
        if health.paused { health.resume() } else { health.start(workoutId: w.id, type: w.healthType) }
        armIdleCheck()
    }

    /// One check, at the moment the workout would turn idle; nothing runs in between.
    private func armIdleCheck() {
        idleCheck?.cancel()
        idleCheck = nil
        guard !isDemo, let at = SensorPlan.checkAt(workout, seen: activityAt.map { $0.timeIntervalSince1970 * 1000 }) else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self = self, self.workout != nil else { return }
            let busy = self.restEndsAt != nil || self.holdEndsAt != nil
            if SensorPlan.idle(self.workout, seen: self.activityAt.map { $0.timeIntervalSince1970 * 1000 },
                               now: Date().timeIntervalSince1970 * 1000, busy: busy) {
                self.log("idle \(Int(SensorPlan.idleLimitMs / 60000)) min: workout session paused")
                self.health.pause()
            } else if busy {
                // A rest or hold runs on: look again once it is surely over.
                self.idleCheck = nil
                let again = DispatchWorkItem { [weak self] in self?.armIdleCheck() }
                self.idleCheck = again
                DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: again)
            } else {
                self.armIdleCheck()
            }
        }
        idleCheck = item
        let delay = max(0, at - Date().timeIntervalSince1970 * 1000) / 1000 + 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
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
        // SafeNum.date: a start of 1e20 ms (past distantFuture) would make the clock's range trap.
        if let d = SafeNum.date(ms: workout?.start), d.timeIntervalSince1970 > 0 { return d }
        return workout == nil ? nil : workoutSeenAt
    }

    /// The rest page is what the set page shows (one source for LivePage and the badges).
    var restPanel: Bool {
        holdCountFrom == nil && holdEndsAt == nil && viewing == nil && (restEndsAt ?? .distantPast) > Date()
    }

    /// When the phone paused the workout (#976), nil while it runs.
    var workoutPausedAt: Date? {
        guard let d = SafeNum.date(ms: workout?.pausedAt), d.timeIntervalSince1970 > 0 else { return nil }
        return d
    }

    /// Events wait on the watch for a phone out of reach: "Saved on the watch, syncs later".
    var offline: Bool { queued > 0 && !reachable }

    /// Whether the sets logged here have reached the iPhone (WatchCore SyncState).
    var sync: SyncState { SyncState.of(waiting: unsentSets, reachable: reachable) }

    func isSkipped(_ exId: String, _ si: Int) -> Bool { SessionCore.isSkipped(state, exId, si) }

    /// The side of a per-side set that is up ("L" or "R"), or nil.
    var sideUp: String? {
        guard let e = entry, let si = setIndex else { return nil }
        return e.sets[si].sideUp
    }

    /// The weight and reps of the set up next, for the rest screen's "Next" (#911): "60 kg × 8",
    /// "+10 kg × 8", "× 12" or "45 s", the side's own numbers on a per-side set. Nil for cardio,
    /// or when the set has nothing to say. Read from the snapshot's set rows, nothing new sent.
    var nextSetNumbers: String? {
        guard let w = workout, let e = entry, let si = setIndex, e.sets.indices.contains(si) else { return nil }
        let s = e.sets[si]
        var weight = s.w
        var reps = s.r
        if let side = s.sideUp, let sides = s.sides {
            weight = sides[side].w ?? weight
            reps = sides[side].r ?? reps
        }
        if e.isCardio { return nil }
        if e.isTimed {
            guard let sec = s.sec, sec > 0 else { return nil }
            return "\(formatNumber(sec)) s"
        }
        let unit = e.weightUnit(w.unit)
        let times: String? = (reps ?? 0) > 0 ? "× \(formatNumber(reps ?? 0))" : nil
        let load = weight ?? 0
        if load > 0 {
            let kg = e.isBodyweight ? "+\(formatNumber(load)) \(unit)" : "\(formatNumber(load)) \(unit)"
            return times.map { "\(kg) \($0)" } ?? kg
        }
        return times
    }

    func pick(set si: Int, in ei: Int) {
        ackRestOver()
        viewing = nil
        picked[ei] = si
        if ei == entryIndex { loadTargets() }
    }

    /// Another exercise on the set page, picked by hand (an Overview row).
    func show(entry ei: Int) {
        guard ei != state.entryIndex else { return }
        ackRestOver()
        state.entryIndex = ei
        touchLock.unlock()          // picked by hand: the page is the lifter's own choice
        loadTargets()
    }

    /// The page of the session screen on show (SessionView): the set, unless the lifter swiped.
    @Published var tab: SessionTab = .set

    /// A tap on an Overview row: that exercise, on the set page.
    func jump(to ei: Int) {
        closeFix()
        show(entry: ei)
        tab = .set
    }

    /// Every set done or passed over: the Overview, where Finish is.
    private func overviewIfDone() {
        if Overview.atEnd(state) { tab = .overview }
    }

    /* ---------- ‹ › and fixing a logged set (WatchCore SetNav, SetFix) ---------- */

    /// A done set open on the set page to be fixed; nil: the set up next is there.
    @Published private(set) var viewing: SetRef?
    /// The numbers of the set being fixed (the crown and the keypad turn these, not the next set's).
    @Published var fixW: Double = 0
    @Published var fixR: Double = 0
    @Published var fixSec: Double = 0
    /// The side of a per-side set being fixed.
    @Published private(set) var fixSide: String?
    /// What was logged, to tell whether anything changed.
    private var fixFrom: SetFix.Numbers?

    /// The set on the set page: the one being fixed, else the one up next.
    var shownRef: SetRef? {
        viewing ?? setIndex.map { SetRef(entry: entryIndex, set: $0) }
    }

    var shownEntry: Entry? {
        guard let w = workout, let ref = shownRef, w.entries.indices.contains(ref.entry) else { return entry }
        return w.entries[ref.entry]
    }

    private func fixRow(_ ref: SetRef) -> SetRow? {
        guard let w = workout, w.entries.indices.contains(ref.entry), w.entries[ref.entry].sets.indices.contains(ref.set) else { return nil }
        let row = w.entries[ref.entry].sets[ref.set]
        return row.done ? row : nil
    }

    /// Where ‹ (-1) or › (+1) goes from the set on the page; from an exercise with nothing left,
    /// ‹ is its last set.
    private func target(_ d: Int) -> SetRef? {
        if let ref = shownRef {
            guard let e = shownEntry, let to = SetNav.step(e, from: ref.set, by: d) else { return nil }
            return SetRef(entry: ref.entry, set: to)
        }
        guard let e = entry, !e.sets.isEmpty else { return nil }
        return d < 0 ? SetRef(entry: entryIndex, set: e.sets.count - 1) : nil
    }

    func canStep(_ d: Int) -> Bool { target(d) != nil }

    func step(_ d: Int) {
        guard let to = target(d) else { return }
        lastStep = d < 0 ? -1 : 1
        open(to)
    }

    /// A set on the set page: a done one opens to be fixed, one still to do becomes the set up next.
    func open(_ ref: SetRef) {
        ackRestOver()
        if let row = fixRow(ref) {
            viewing = ref
            fixSide = row.sides != nil ? "L" : nil
            loadFix()
        } else {
            viewing = nil
            if ref.entry != entryIndex { show(entry: ref.entry) }
            pick(set: ref.set, in: ref.entry)
        }
    }

    func setFixSide(_ side: String) {
        fixSide = side
        loadFix()
    }

    private func loadFix() {
        guard let ref = viewing, let row = fixRow(ref), let n = SetFix.logged(row, side: fixSide) else { viewing = nil; return }
        fixFrom = n
        fixW = n.w ?? 0
        fixR = n.r ?? 0
        fixSec = n.sec ?? 0
        fixEffort = nil
    }

    /// Whether the numbers on a set being fixed differ from what was logged.
    var fixChanged: Bool {
        guard let f = fixFrom, viewing != nil else { return false }
        return fixW != (f.w ?? 0) || fixR != (f.r ?? 0) || fixSec != (f.sec ?? 0) || fixEffort != nil
    }

    /// Save on a set being fixed: the phone gets it as the set done again (SetFix.correct).
    func saveFix() {
        guard let ref = viewing, fixChanged else { return }
        let rated = effortKind.flatMap { k in fixEffort.map { Effort.Rating(kind: k, value: $0) } }
        let (next, event) = SetFix.correct(state, entry: ref.entry, set: ref.set, side: fixSide,
                                           to: SetFix.Numbers(w: fixW, r: fixR, sec: fixSec), effort: rated,
                                           now: Date().timeIntervalSince1970 * 1000, id: UUID().uuidString)
        guard let ev = event else { return }
        send(event: ev)
        state = next
        if ref == lastLogged, let r = fixEffort { lastRated = r }
        viewing = nil
        fixFrom = nil
        noteActivity()
        Haptics.done()
        loadTargets()
    }

    /* ---------- the effort, rated during the rest ---------- */

    /// The set logged last here (its side, for a per-side set), and what the rest rated it.
    @Published private(set) var lastLogged: SetRef?
    private var lastSide: String?
    @Published private(set) var lastRated: Double?

    /// The rest offers the chips: the profile rates effort and the set just done is a work set.
    var canRateLast: Bool {
        guard effortKind != nil, let ref = lastLogged, let w = workout, w.entries.indices.contains(ref.entry),
              w.entries[ref.entry].sets.indices.contains(ref.set) else { return false }
        let e = w.entries[ref.entry]
        return !e.isCardio && !e.sets[ref.set].warmup
    }

    /// A chip: the set just done gets this effort (the setDone again, its numbers as logged).
    func rateLast(_ v: Double) {
        guard touchAllowed, let kind = effortKind, let ref = lastLogged, let w = workout,
              w.entries.indices.contains(ref.entry), w.entries[ref.entry].sets.indices.contains(ref.set),
              let n = SetFix.logged(w.entries[ref.entry].sets[ref.set], side: lastSide) else { return }
        ackRestOver()
        let (next, event) = SetFix.correct(state, entry: ref.entry, set: ref.set, side: lastSide, to: n,
                                           effort: Effort.Rating(kind: kind, value: v),
                                           now: Date().timeIntervalSince1970 * 1000, id: UUID().uuidString)
        guard let ev = event else { return }
        send(event: ev)
        state = next
        lastRated = v
        WKInterfaceDevice.current().play(.click)
    }

    /// ‹ on the rest: the set just done, open to be fixed while the rest runs on.
    func fixLast() {
        guard let ref = lastLogged else { return }
        open(ref)
        if let side = lastSide, viewing != nil { setFixSide(side) }
    }

    /// The effort picked on a set being fixed (nil: left as it was).
    @Published var fixEffort: Double?

    /// Back to the set up next without saving.
    func closeFix() {
        viewing = nil
        fixFrom = nil
    }

    /// What the complications and the Smart Stack widget show (WidgetState), in the app's language.
    var widgetState: WidgetState {
        var w = widgetStateWithoutLang
        w.lang = state.settings.lang
        w.unsent = unsentSets > 0 ? unsentSets : nil
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
                    : e.isBodyweight ? (added > 0 ? "+\(formatNumber(added)) \(e.weightUnit(w.unit)) × \(formatNumber(s.r ?? 0))" : "× \(formatNumber(s.r ?? 0))")
                    : "\(formatNumber(s.w ?? 0)) \(e.weightUnit(w.unit)) × \(formatNumber(s.r ?? 0))"
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
    func openedForWorkout(_ opened: HKWorkoutActivityType? = nil) {
        DispatchQueue.main.async {
            self.log("opened by the phone for a workout")
            if WCSession.isSupported() { self.receive(WCSession.default.receivedApplicationContext) }
            self.health.start(workoutId: self.state.workout?.id, type: self.state.workout?.healthType, opened: opened)
            // Nothing came after all (the phone's workout was discarded at once): no session left running.
            DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
                if self.state.workout == nil { self.health.end(save: false) }
            }
        }
    }

    /* ---------- snapshots from the phone ---------- */

    func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let snap = try? JSONDecoder().decode(Snapshot.self, from: data) else {
            // Shown on the hidden debug screen: a snapshot this build cannot read is otherwise silent.
            log("a snapshot from the phone could not be read")
            return
        }
        DispatchQueue.main.async {
            if !self.heardFromPhone {
                self.heardFromPhone = true
                if !self.isDemo { UserDefaults.standard.set(true, forKey: SessionStore.heardKey) }
            }
            // Undo would put back the state from before the removal and lose this snapshot (the phone
            // may even have ended the workout): the removal goes out now instead (review 2026-11-12).
            self.flushRemoval()
            let before = self.state
            let next = SessionCore.applySnapshot(before, snap)
            self.state = next
            // Discarded there (#776): nothing of it is saved, and there is nothing to sum up. Also
            // when the phone already runs the next workout (no snapshot without one in between):
            // the session ends unsaved instead of carrying on as the next one. Remembered as run
            // here, so its sync id stays on the list of copies to take out of Apple Health should
            // one turn up after all (the phone names discarded workouts in healthGone).
            let droppedThere = before.workout.map { $0.id != next.workout?.id && SessionCore.discarded($0.id, in: snap) } ?? false
            if droppedThere {
                self.health.end(save: false)
                self.ran(before.workout?.id)
            }
            if let ended = before.workout, next.workout == nil {
                // Ended on the phone: the session here ends too. Finished there, it is saved to Apple
                // Health and the watch says so instead of quietly going back to the start screen.
                if !droppedThere {
                    if !self.isDemo {
                        self.summary = SessionCore.summary(ended, end: Date().timeIntervalSince1970 * 1000,
                                                           startedAt: self.workoutSeenAt.map { $0.timeIntervalSince1970 * 1000 }, endedOnPhone: true)
                    }
                    self.ran(ended.id)
                    self.health.end(save: true) { totals in self.addTotals(totals) }
                }
                self.dropClips()
                self.stopHold()
                self.skipRest()
            } else if next.workout != nil && next.workout?.id != before.workout?.id {
                // A workout this watch picks up (the app opened mid-workout, or the phone started one).
                self.setStartedAt = Date()
                self.workoutSeenAt = Date()
                self.picked = [:]
                self.tab = .set
                self.viewing = nil
                self.summary = nil
                self.health.start(workoutId: next.workout?.id, type: next.workout?.healthType)
            }
            if next.workout != nil && next.workout != before.workout { self.noteActivity() }
            // Sets ticked on the phone: their heart rate from this watch's readings (Discord fuckdv).
            for tick in SessionCore.phoneTicks(before.workout, next.workout) {
                self.phoneTicked(tick, wid: next.workout?.id ?? "", resting: snap.active?.rest != nil)
            }
            // Only a rest end the phone has not sent before: the same one again (with some other
            // change) would undo a ±15 here, or bring back a rest skipped here.
            // The first snapshot that applied our latest tick carries the rest the phone started for
            // it, an echo of the watch's own: a +15 or Skip pressed since must stand (Wear, Garmin).
            let echo = self.echoOf.map { (snap.acked ?? []).contains($0) } ?? false
            if echo { self.echoOf = nil }
            let ours = next.workout?.id == snap.active?.id
            let step = RestMath.phoneRest(ours ? snap.active?.rest?.endsAt : nil, last: self.phoneRestEnd, echo: echo)
            self.phoneRestEnd = step.last
            if step.start, let endsAt = step.last {
                let end = Date(timeIntervalSince1970: endsAt / 1000)
                if end != self.restEndsAt { self.startRest(until: end, notify: true) }
            }
            self.health.syncSetting(next.settings.health)
            // What the phone has applied leaves the outbox; what it lacks goes again.
            if !self.isDemo { self.phoneApplied(snap.acked) }
            self.removeDeletedFromHealth(snap.healthGone)
            self.loadTargets()
        }
    }

    /// The weight and reps the crown starts from: the set's own target.
    func loadTargets() {
        // A set being fixed that is no longer done (unticked on the phone): nothing left to fix.
        if let v = viewing, fixRow(v) == nil { viewing = nil }
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
        // In a superset the page flips to the partner: a slower second tap would log its set.
        if heldFor == nil, !touchAllowed { return }
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
        noteActivity()
        if heldFor == nil { doneRipple += 1 }
        let (to, rest) = SessionCore.next(after: state, entry: ei, set: si)
        if side != nil && !rest {
            Haptics.side()          // the other side now
        } else {
            Haptics.done()
        }
        let restFor = e.restSec ?? w.restSec
        var rested = false
        if rest && restFor > 0 && to < (workout?.entries.count ?? 0) {
            startRest(until: now.addingTimeInterval(restFor), notify: true)
            restAfter = (e.id, ei, si, w.id ?? "", now)
            rested = true
            // The thumb that hit Done is still there: the rest's buttons wait a second for it.
            touchLock.lock(at: now)
        }
        lastLogged = SetRef(entry: ei, set: si)
        lastSide = side
        lastRated = nil
        lastStep = 1
        if to != ei { state.entryIndex = to }
        loadTargets()
        overviewIfDone()
        // A hold with no rest after it (the other side, or the rest timer off): the next one counts in.
        if heldFor != nil && !rested { autoHoldIfDue() }
    }

    /// A set ticked on the phone while this watch runs the session: the watch has the sensor, so
    /// the set's heart rate is worked out here as for a tick on the wrist (completeSet), from when
    /// the set started up to the phone's tick, and sent as a setHr. The rest before it closes at
    /// the tick, and the rest after it (when the phone started one) is measured for that set.
    private func phoneTicked(_ t: SessionCore.PhoneTick, wid: String, resting: Bool) {
        let at = Date(timeIntervalSince1970: t.at / 1000)
        // A tick from before this set started (one the phone made while the watch was away, already
        // past) or from the future (a clock off between the two): no window to measure.
        guard at > setStartedAt, at <= Date().addingTimeInterval(60) else { return }
        let setFrom = setStartedAt
        closeRest(at: at)
        if let hr = health.stats(from: setFrom, to: at) {
            send(event: [
                "id": UUID().uuidString, "type": "setHr", "wid": wid, "exId": t.exId,
                "entryIdx": t.entryIdx, "setIdx": t.setIdx, "hr": hr,
            ])
        }
        setStartedAt = at
        if resting { restAfter = (t.exId, t.entryIdx, t.setIdx, wid, at) }
    }

    /// A set passed over (a long press on Done): not done, the next one comes up.
    func skipSet() {
        guard touchAllowed, let si = setIndex else { return }
        ackRestOver()
        let ei = entryIndex
        state = SessionCore.skip(state, entry: ei, set: si)
        picked[ei] = nil
        noteActivity()
        if setIndex == nil {
            let (to, _) = SessionCore.next(after: state, entry: ei, set: si)
            state.entryIndex = to
        }
        loadTargets()
        overviewIfDone()
        Haptics.skip()
    }

    /* ---------- set menu: marks, add, remove (the phone's set menu, from the watch) ---------- */

    /// The phone understands the set events; otherwise the menu stays out of the page.
    var menuAvailable: Bool { SetMenu.available(state) }

    func offer(entry: Int, set: Int) -> MenuOffer {
        guard let w = workout, w.entries.indices.contains(entry) else { return SetMenu.offer(Entry(id: "", name: "", mode: "reps", restSec: nil, last: nil, sets: []), set: set) }
        return SetMenu.offer(w.entries[entry], set: set)
    }

    /// A set taken out, kept for Undo until `until`; the page already shows it gone.
    struct RemovedSet: Equatable { var setNumber: Int; var w: Double?; var r: Double?; var until: Date }
    @Published private(set) var removed: RemovedSet?
    @Published private(set) var toast: String?
    private var undoWindow = UndoWindow()
    /// The removal's event and the state before it, while Undo can still take it back.
    private var held: (event: Event, before: SessionState, refs: Refs)?
    private static let heldKey = "heldRemoval"

    /// The store's own pointers at sets, by row: a menu edit that moves or takes out rows moves them too.
    private struct Refs { var lastLogged: SetRef?; var lastRated: Double?; var restAfter: (exId: String, entryIdx: Int, setIdx: Int, wid: String, from: Date)?
        var picked: [Int: Int]; var viewing: SetRef?; var fixFrom: SetFix.Numbers?; var menuFor: SetRef? }
    private var refs: Refs {
        get { Refs(lastLogged: lastLogged, lastRated: lastRated, restAfter: restAfter, picked: picked, viewing: viewing, fixFrom: fixFrom, menuFor: menuFor) }
        set { lastLogged = newValue.lastLogged; lastRated = newValue.lastRated; restAfter = newValue.restAfter; picked = newValue.picked
              viewing = newValue.viewing; fixFrom = newValue.fixFrom; menuFor = newValue.menuFor }
    }

    /// After a menu edit on entry `ei` (the last of state.edits): the set the rest, the effort chips, the fix
    /// and the page point at is the same set, at its new row; a removed one is let go (review 2026-11-12).
    private func follow(from old: SessionState, entry ei: Int) {
        guard let pe = state.edits?.last, let w = old.workout, let moved = SetMenu.apply(pe, on: w, entry: ei)?.1 else { return }
        func to(_ si: Int) -> Int? { moved.indices.contains(si) ? moved[si] : si }
        if let r = lastLogged, r.entry == ei {
            lastLogged = to(r.set).map { SetRef(entry: ei, set: $0) }
            if lastLogged == nil { lastRated = nil }
        }
        if let r = restAfter, r.entryIdx == ei { if let n = to(r.setIdx) { restAfter?.setIdx = n } else { restAfter = nil } }
        if let p = picked[ei] { picked[ei] = to(p) }
        if let v = viewing, v.entry == ei {
            if let n = to(v.set) { viewing = SetRef(entry: ei, set: n) } else { viewing = nil; fixFrom = nil }
        }
        if let m = menuFor, m.entry == ei { menuFor = to(m.set).map { SetRef(entry: ei, set: $0) } }
    }
    private var undoTimer: Timer?

    /// A menu change goes out and shows at once; a refused one (the menu would not offer it) does nothing.
    @discardableResult
    private func applyEdit(_ r: (SessionState, Event?), entry ei: Int) -> Bool {
        guard let event = r.1 else { return false }
        flushRemoval()
        send(event: event)
        let old = state
        state = r.0
        follow(from: old, entry: ei)
        noteActivity()
        loadTargets()
        Haptics.mark()
        return true
    }

    /// True when the change went through (a locked or refused tap does nothing, and the menu stays).
    @discardableResult
    func mark(_ kind: MarkKind, on: Bool, entry: Int, set: Int) -> Bool {
        guard touchAllowed, menuAvailable else { return false }
        return applyEdit(SetMenu.mark(state, entry: entry, set: set, kind, on: on, at: Self.nowMs(), id: UUID().uuidString), entry: entry)
    }

    @discardableResult
    func addSet(entry: Int) -> Bool {
        guard touchAllowed, menuAvailable else { return false }
        guard applyEdit(SetMenu.addSet(state, entry: entry, at: Self.nowMs(), id: UUID().uuidString), entry: entry) else { return false }
        // The number the set page's pill shows for the new row (warm-ups are counted apart).
        if let e = workout?.entries[safe: entry] { say(String(format: L("Set %lld added"), Int64(SetNav.place(e, e.sets.count - 1).n))) }
        return true
    }

    /// Takes the set out at once and holds the event for 4 s, so Undo can still cancel it.
    func removeSet(entry: Int, set: Int) {
        guard touchAllowed, menuAvailable, let row = workout?.entries[safe: entry]?.sets[safe: set] else { return }
        let (next, event) = SetMenu.removeSet(state, entry: entry, set: set, at: Self.nowMs(), id: UUID().uuidString)
        guard let ev = event, let pe = next.edits?.last else { return }
        flushRemoval()
        let now = Date()
        let number = SetNav.place(workout!.entries[entry], set).n   // as the page's pill counts it, before the row is gone
        held = (ev, state, refs)
        // Kept on disk too: if the app dies before the Undo time is over, the removal still reaches the phone.
        if !isDemo, let d = try? JSONSerialization.data(withJSONObject: ev) { UserDefaults.standard.set(d, forKey: Self.heldKey) }
        undoWindow.begin(pe, at: now)
        let old = state
        state = next
        follow(from: old, entry: entry)
        removed = RemovedSet(setNumber: number, w: row.w, r: row.r, until: now.addingTimeInterval(UndoWindow.seconds))
        undoTimer?.invalidate()
        undoTimer = Timer.scheduledTimer(withTimeInterval: UndoWindow.seconds, repeats: false) { [weak self] _ in self?.sendDueRemoval() }
        noteActivity()
        loadTargets()
        Haptics.skip()
    }

    /// Undo: the state as it was (its edit list has no removal), nothing sent.
    func undoRemove() {
        guard let h = held else { return }
        undoWindow.undo()
        held = nil
        state = h.before
        refs = h.refs
        clearRemoval()
        loadTargets()
        Haptics.mark()
    }

    private func sendDueRemoval() { if undoWindow.due(at: Date()) != nil { sendHeld() } }

    /// The Undo time is over, or the app left the screen: the removal goes to the phone now.
    func flushRemoval() { if undoWindow.flush() != nil { sendHeld() } }

    private func sendHeld() {
        let h = held
        held = nil
        clearRemoval()
        if let h = h { send(event: h.event) }
    }

    private func clearRemoval() {
        undoTimer?.invalidate(); undoTimer = nil; removed = nil
        UserDefaults.standard.removeObject(forKey: Self.heldKey)
    }

    private func say(_ text: String) {
        toast = text
        if !isDemo { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in if self?.toast == text { self?.toast = nil } } }
    }

    /// The menu opened: taps are ignored for a second (TouchLock).
    func lockTouches() { touchLock.lock(at: Date()) }

    /// The set menu, open for this set (SessionView's MenuLayer shows it).
    @Published var menuFor: SetRef?
    /// Where the set pill is on screen, for the menu to grow out of. Not published: read once as the menu opens.
    var pillFrame: CGRect = .zero
    /// Done's place on screen, and a count of sets done with it: the ring that ripples out from it (Direction B, 2026-11-11).
    var doneFrame: CGRect = .zero
    /// The set pill's last "n of" shown, so a new pill rolls from it.
    var pillPlace: [Int]?
    @Published var doneRipple = 0

    /// The page's set has a menu: a set or a fix on show, not a hold, a rest or cardio.
    /// The set page (pill first) or the rest page draws the badges itself, so they move with the page.
    var ownTopRow: Bool {
        tab == .set && (restPanel || (holdCountFrom == nil && holdEndsAt == nil && shownRef != nil))
    }

    var menuShown: Bool {
        menuAvailable && holdCountFrom == nil && holdEndsAt == nil && (viewing != nil || !restPanel)
            && shownRef != nil && shownEntry?.isCardio == false
    }

    func openMenu() {
        guard menuShown, touchAllowed, let ref = shownRef else { return }
        lockTouches()
        Haptics.mark()
        menuFor = ref
    }

    /* ---------- holds (timed sets) ---------- */

    /* ---------- holds that start by themselves (the phone's setting) ---------- */

    /// The 3-2-1 before a hold that starts by itself: when it began (HoldCountView).
    @Published private(set) var holdCountFrom: Date?
    private var holdCountTimer: Timer?

    /// The rest is over (or a hold ended with none after it): with the phone's "Timed holds start
    /// by themselves" on and a timed set up next, a 3-2-1 with a tap each second, then the hold.
    func autoHoldIfDue() {
        guard state.settings.autoHolds == true, workout != nil, entry?.isTimed == true, setIndex != nil,
              holdEndsAt == nil, restEndsAt == nil, holdCountFrom == nil, seconds > 0 else { return }
        let from = Date()
        holdCountFrom = from
        Haptics.count()
        holdCountTimer?.invalidate()
        holdCountTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, self.holdCountFrom == from else { return }
                if Countdown.number(at: Date().timeIntervalSince(from) + 0.05) == 0 {
                    self.stopHoldCount()
                    self.startHold(auto: true)
                    if self.holdEndsAt != nil { self.showGo() }
                } else {
                    Haptics.count()
                }
            }
        }
    }

    /// Cancel on the count-in: no hold starts, the set waits for its Start as it always did.
    func stopHoldCount() {
        holdCountTimer?.invalidate()
        holdCountTimer = nil
        holdCountFrom = nil
    }

    /// Skip on the rest: the rest ends, and a hold that starts by itself counts in.
    func skipRestAndGo() {
        guard touchAllowed else { return }
        skipRest()
        // The set page comes back under the finger that hit Skip.
        touchLock.lock(at: Date())
        autoHoldIfDue()
    }

    /// −15 s on the rest; with 15 s or less left, a Skip (as on the phone).
    func minusRest() {
        guard touchAllowed, let end = restEndsAt else { return }
        ackRestOver()
        guard let to = RestMath.minus(end: end, now: Date()) else { skipRestAndGo(); return }
        let start = restStartedAt
        startRest(until: to, notify: true)
        restStartedAt = start
    }

    /// The hold starts: a countdown from the seconds on the screen; at zero it is done by itself.
    /// `auto`: the count-in started it, so the touch lock after a rest does not hold it back.
    func startHold(auto: Bool = false) {
        guard auto || touchAllowed, entry?.isTimed == true, setIndex != nil, seconds > 0 else { return }
        stopHoldCount()
        ackRestOver()
        skipRest()
        noteActivity()
        let now = Date()
        let end = now.addingTimeInterval(seconds)
        holdStartedAt = now
        holdEndsAt = end
        Haptics.start()
        holdTimer?.invalidate()
        holdTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            DispatchQueue.main.async { self?.endHold(early: false) }
        }
        // The last three seconds, one click each, so the wrist knows without a look.
        holdTicks.forEach { $0.cancel() }
        holdTicks = [3.0, 2.0, 1.0].filter { seconds > $0 + 1 }.map { (left: Double) -> DispatchWorkItem in
            let item = DispatchWorkItem { Haptics.count() }
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds - left, execute: item)
            return item
        }
    }

    private var holdTicks: [DispatchWorkItem] = []

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
        holdTicks.forEach { $0.cancel() }
        holdTicks = []
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
        homeLock.lock(at: Date())
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

    /// Taps on Start are held back for a second after the summary's Done: the thumb that closed it
    /// is still on the glass, right where Start comes up. The complication's Start is never held back.
    private var homeLock = TouchLock()

    /// Starts a ready session here, the phone asleep or not: first the weigh-in, as on the phone,
    /// unless it is switched off there (Settings → During a workout).
    func start(_ session: ReadySession, fromLink: Bool = false) {
        guard fromLink || homeLock.allows(at: Date()) else { return }
        if state.settings.weighIn != false && !isDemo {
            bodyWeight = state.settings.lastBw ?? (unit == "lb" ? 160 : 70)
            weighInFor = session
            return
        }
        countIn(session, bw: nil)
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
        countIn(session, bw: bw)
    }

    func cancelWeighIn() { weighInFor = nil }

    /// The 3-2-1 before the workout, while it runs: when it began (CountdownView).
    @Published private(set) var countdownFrom: Date?
    private var countdownFor: (session: ReadySession, bw: Double?)?
    private var countdownTimer: Timer?

    /// With Apple Health on, a 3-2-1 first: the workout session is prepared meanwhile, so the heart
    /// rate sensor is warm by set 1. Without it there is nothing to wait for.
    private func countIn(_ session: ReadySession, bw: Double?) {
        guard health.enabled, !isDemo else { begin(session, bw: bw); return }
        countdownFor = (session, bw)
        let from = Date()
        countdownFrom = from
        health.prepare(type: session.healthType)
        Haptics.count()
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            if Countdown.number(at: Date().timeIntervalSince(from) + 0.05) == 0 { self?.startNow() } else { Haptics.count() }
        }
    }

    /// The countdown ran out, or a tap on it: the workout starts.
    func startNow() {
        guard let c = countdownFor else { return }
        stopCountdown()
        // A workout came from the phone meanwhile: that one runs (its session took the prepared one).
        guard workout == nil else { return }
        begin(c.session, bw: c.bw)
        showGo()
    }

    /// GO! on top of what just started, for a moment (Motion's GoView).
    @Published private(set) var goAt: Date?

    private func showGo() {
        let at = Date()
        goAt = at
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            if self?.goAt == at { self?.goAt = nil }
        }
    }

    /// Which way the set page last moved (‹ -1, › and Done +1): the set's lines come in from there.
    @Published private(set) var lastStep = 1

    /// Cancel on the countdown: nothing starts, the prepared session is dropped.
    func cancelCountdown() {
        guard countdownFor != nil else { return }
        stopCountdown()
        if workout == nil { health.end(save: false) }
    }

    private func stopCountdown() {
        countdownTimer?.invalidate()
        countdownTimer = nil
        countdownFor = nil
        countdownFrom = nil
    }

    private func begin(_ session: ReadySession, bw: Double?) {
        let now = Date()
        let (next, event) = SessionCore.start(state, session, wid: "watch-" + UUID().uuidString,
                                              at: now.timeIntervalSince1970 * 1000, id: UUID().uuidString, bw: bw)
        send(event: event)
        state = next
        picked = [:]
        tab = .set
        viewing = nil
        setStartedAt = now
        workoutSeenAt = now
        restAfter = nil
        loadTargets()
        health.start(workoutId: next.workout?.id, type: next.workout?.healthType)
        activityAt = now
        armIdleCheck()
        summary = nil
        Haptics.start()
    }

    /* ---------- a workout left running ---------- */

    private var idleTimer: Timer?
    /// "Keep going" answered: idle time counts from then.
    private var idleSnooze: Date?

    /// A workout runs: checked every 30 s (the Apple Health session keeps the app running with the
    /// wrist down; without one, a suspended app checks when it wakes). No workout, no timer.
    private func watchIdle() {
        idleTimer?.invalidate()
        idleTimer = nil
        idleSnooze = nil
        askDone = false
        idleLeft = false
        guard workout != nil, !isDemo else { return }
        let t = Timer(timeInterval: 30, repeats: true) { [weak self] _ in self?.checkIdle() }
        t.tolerance = 10
        RunLoop.main.add(t, forMode: .common)
        idleTimer = t
        DispatchQueue.main.async { self.checkIdle() }     // relaunched hours later: ended at once
    }

    private func checkIdle() {
        // A rest or a hold running is a workout going on, however long it takes.
        guard let w = workout, holdEndsAt == nil, restEndsAt == nil else { return }
        let now = Date().timeIntervalSince1970 * 1000
        let ms = { (d: Date?) in d.map { $0.timeIntervalSince1970 * 1000 } }
        let seen = ms(workoutSeenAt)
        let last = Idle.lastSet(w) ?? seen ?? now
        // Picked up from the phone, changed there (a set edited, an exercise added) or answered
        // "keep going" since: counted from then, never ended earlier.
        let since = Idle.since(lastSet: last, seen: seen, activity: ms(activityAt), snooze: ms(idleSnooze))
        idleMinutes = max(0, SafeNum.int((now - since) / 60000))
        let rules = idleRules
        switch Idle.state(since: since, now: now, rules: rules, leftAt: w.leftGymAt) {
        case .active:
            // Something happened since (a set on the phone): the card goes away by itself.
            if askDone { askDone = false }
        case .ask:
            raiseIdle(left: false, endsAt: since + rules.askAfter + rules.grace)
        case .left:
            raiseIdle(left: true, endsAt: (w.leftGymAt ?? now) + rules.grace)
        case .end:
            confirmEnd(wid: w.id, since: since, last: last)
        }
    }

    /// The phone's Settings → Workout → Forgotten workouts (an older phone: 20 and 45 minutes).
    private var idleRules: Idle.Rules { Idle.Rules.from(state.settings.forgotten) }

    private func raiseIdle(left: Bool, endsAt: Double) {
        idleEndsAt = Date(timeIntervalSince1970: endsAt / 1000)
        if !askDone || idleLeft != left { idleLeft = left; askDone = true; Haptics.ask() }
    }

    /// The phone being asked whether the workout goes on there.
    private var askingPhone = false

    /// Before a workout ends as forgotten, the phone has its say (#904): the watch's copy can be
    /// stale (snapshots that never reached it), and it ended a workout being logged set by set on
    /// the phone. The phone's native side answers from its newest snapshot, also while its page
    /// sleeps. No answer: the watch only asks, never ends (Idle.verdict).
    private func confirmEnd(wid: String?, since: Double, last: Double) {
        guard !askingPhone else { return }
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isReachable else {
            settleIdle(wid: wid, since: since, last: last, reply: nil)
            return
        }
        askingPhone = true
        WCSession.default.sendMessage(["idleCheck": wid ?? ""], replyHandler: { [weak self] answer in
            let reply = Idle.PhoneReply(wid: answer["wid"] as? String, activeAt: (answer["activeAt"] as? NSNumber)?.doubleValue)
            DispatchQueue.main.async {
                self?.askingPhone = false
                self?.settleIdle(wid: wid, since: since, last: last, reply: reply)
            }
        }, errorHandler: { [weak self] _ in
            DispatchQueue.main.async {
                self?.askingPhone = false
                self?.settleIdle(wid: wid, since: since, last: last, reply: nil)
            }
        })
    }

    private func settleIdle(wid: String?, since: Double, last: Double, reply: Idle.PhoneReply?) {
        // Finished, discarded or replaced while the phone was being asked: nothing to settle.
        guard let w = workout, w.id == wid, holdEndsAt == nil, restEndsAt == nil else { return }
        // Used on the phone since: the idle clock counts from then, like a change from the phone.
        if let r = reply, r.wid == wid, let at = r.activeAt, at > since {
            let phoneAt = Date(timeIntervalSince1970: at / 1000)
            if activityAt.map({ $0 < phoneAt }) ?? true { activityAt = phoneAt }
        }
        let now = Date().timeIntervalSince1970 * 1000
        let rules = idleRules
        switch Idle.verdict(since: since, now: now, wid: wid, reply: reply, rules: rules, leftAt: w.leftGymAt) {
        case .active:
            askDone = false
        case .ask:
            raiseIdle(left: false, endsAt: since + rules.askAfter + rules.grace)
        case .left:
            raiseIdle(left: true, endsAt: (w.leftGymAt ?? now) + rules.grace)
        case .end:
            askDone = false
            // Its last set plus that set's rest, so the duration stays honest (never a later "now").
            let left = rules.leaveGym && (w.leftGymAt ?? 0) > since
            finish(at: Date(timeIntervalSince1970: Idle.endAt(w, now: now) / 1000), idle: true, left: left)
        }
    }

    /// "Keep going" on "Still training?" (or on "Looks like you left the gym"): idle counts from
    /// now, here and on the phone, which stops asking too.
    func keepGoing() {
        let at = Date()
        idleSnooze = at
        askDone = false
        idleLeft = false
        if let ev = SessionCore.stillHere(state, at: at.timeIntervalSince1970 * 1000, id: UUID().uuidString) { send(event: ev) }
    }

    /// Finishes the session: the phone saves it with its own Finish and save. `end`: when it really
    /// ended (a workout left running ends at its last set), else now.
    func finish(at end: Date = Date(), idle: Bool = false, left: Bool = false) {
        // Finished mid-hold: the seconds held so far are that set, not lost.
        if !idle, holdEndsAt != nil { endHold(early: true) }
        closeRest(at: end)
        let now = end.timeIntervalSince1970 * 1000
        let ended = workout
        let (next, event) = SessionCore.finish(state, at: now, id: UUID().uuidString, idle: idle, left: left)
        guard let ev = event else { return }
        if let w = ended { summary = SessionCore.summary(w, end: now, startedAt: workoutSeenAt.map { $0.timeIntervalSince1970 * 1000 }) }
        ran(ended?.id)
        health.end(save: true, at: end) { [weak self] totals in self?.addTotals(totals) }
        stopHoldCount()
        stopHold()
        skipRest()
        dropClips()
        closeFix()
        send(event: ev)
        state = next
        Haptics.finished()
    }

    /// Discards the session: nothing saved here or in Apple Health, and the phone drops it too.
    func discard() {
        closeRest(at: Date())
        let (next, event) = SessionCore.finish(state, at: Date().timeIntervalSince1970 * 1000, id: UUID().uuidString, discard: true)
        guard let ev = event else { return }
        health.end(save: false)
        stopHoldCount()
        stopHold()
        skipRest()
        dropClips()
        closeFix()
        send(event: ev)
        state = next
        summary = nil
        Haptics.discarded()
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
        guard touchAllowed, let end = restEndsAt else { return }
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
                // The set page comes back under the finger: a tap meant for the rest is not a Done.
                self?.touchLock.lock(at: Date())
                self?.closeRest(at: Date())
                self?.restEndsAt = nil
                self?.restStartedAt = nil
                self?.autoHoldIfDue()
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
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: SafeNum.interval(end.timeIntervalSinceNow), repeats: false)
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
        // With the app in front the rest's own alarm (restOver) is the alert: the system's banner on
        // top of it was dismissed to the watch face, after every rest (#936).
        completionHandler(notification.request.identifier == SessionStore.restNotificationId ? [] : [.banner, .sound])
    }

    /// One event for the phone: into the outbox first (saved, WatchCore's Outbox.swift), then out.
    /// It stays in the outbox until the phone has applied it (its id in a snapshot's `acked`).
    private func send(event: [String: Any]) {
        guard !isDemo, WCSession.isSupported() else { return }
        // Any other event carries a post-removal index: the held removal must reach the phone first,
        // and Undo is gone (it would otherwise restore a state that lost this event's change).
        // (Off the main thread nothing here carries a set index, and `held` is main-only.)
        if Thread.isMainThread, let h = held, (h.event["id"] as? String) != (event["id"] as? String) { flushRemoval() }
        let item: OutItem? = editBox { o in
            guard let added = OutboxCore.add(o, event) else { return nil }
            o = added.0
            return added.1
        }
        // A tick made here: the snapshot that applies it echoes its rest (RestMath.phoneRest).
        if (event["type"] as? String) == "setDone", let id = event["id"] as? String {
            if Thread.isMainThread { echoOf = id } else { DispatchQueue.main.async { self.echoOf = id } }
        }
        if let item = item { deliver([item]) }
    }

    /* ---------- the outbox (1.4.5) ---------- */

    /// The events not applied on the phone yet, saved: they outlive a killed app, a failed
    /// transfer and a phone that was off all day. ("outbox" held the old list of events waiting
    /// for the session to start; carried over once, in flushOutbox.)
    private static let outboxKey = "outbox2"
    private static let oldOutboxKey = "outbox"
    private let boxLock = NSLock()

    private var box: Outbox {
        guard let data = UserDefaults.standard.data(forKey: SessionStore.outboxKey),
              let o = try? JSONDecoder().decode(Outbox.self, from: data) else { return Outbox() }
        return o
    }

    /// The outbox changed under the lock (WatchConnectivity calls back on its own threads), saved.
    @discardableResult
    private func editBox<T>(_ change: (inout Outbox) -> T) -> T {
        boxLock.lock()
        var o = box
        let out = change(&o)
        if let data = try? JSONEncoder().encode(o) { UserDefaults.standard.set(data, forKey: SessionStore.outboxKey) }
        boxLock.unlock()
        updateLink()
        return out
    }

    private static func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

    /// The id inside an event's JSON (a transfer queued by an older build carries no "id" of its own).
    private static func eventId(_ json: String?) -> String? {
        guard let data = json?.data(using: .utf8),
              let ev = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        return ev["id"] as? String
    }

    /// Out to the phone, in order: as one message while it is in reach (there in a moment, #882;
    /// the phone answers with the ids it stored), else, or when that fails, with transferUserInfo,
    /// which the system keeps and delivers later, even to a phone app that is not running. An older
    /// phone app answers the message with nothing: the transfer carries it then.
    private func deliver(_ items: [OutItem]) {
        guard !items.isEmpty, !isDemo, WCSession.isSupported() else { return }
        let session = WCSession.default
        // Not before the session is up: activationDidComplete sends what waits.
        guard session.activationState == .activated else { return }
        let ids = items.map { $0.id }
        editBox { o in o = OutboxCore.sent(o, ids, now: SessionStore.nowMs()) }
        guard session.isReachable else { transferAll(items); return }
        // A message holds some 65 KB: a long backlog goes in batches.
        for start in stride(from: 0, to: items.count, by: 40) {
            let batch = Array(items[start..<min(start + 40, items.count)])
            session.sendMessage(["events": batch.map { $0.json }], replyHandler: { [weak self] reply in
                guard let self = self else { return }
                let got = Set((reply["got"] as? [String]) ?? [])
                if !got.isEmpty { self.editBox { o in o = OutboxCore.delivered(o, Array(got)) } }
                let missed = batch.filter { !got.contains($0.id) }
                if !missed.isEmpty { self.transferAll(missed) }
            }, errorHandler: { [weak self] _ in
                self?.transferAll(batch)
            })
        }
    }

    /// Queued with the system, each once: an event whose transfer is still outstanding is not
    /// queued a second time.
    private func transferAll(_ items: [OutItem]) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let outstanding = Set(session.outstandingUserInfoTransfers.compactMap { $0.userInfo["id"] as? String })
        for item in items where !outstanding.contains(item.id) {
            session.transferUserInfo(["event": item.json, "id": item.id])
        }
        updateLink()
    }

    /// What is due goes out: at launch, when the phone comes back in reach, when a snapshot shows
    /// the phone up. `reconnect`: everything not delivered yet, however recently it went out.
    private func flush(reconnect: Bool = false) {
        guard !isDemo, WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        migrateOldOutbox()
        let o = box
        deliver(reconnect ? OutboxCore.onReconnect(o, now: SessionStore.nowMs()) : OutboxCore.due(o, now: SessionStore.nowMs()))
    }

    private func flushOutbox() { flush(reconnect: true) }

    /// Events an older build left waiting for the session (plain JSON strings): into the outbox.
    private func migrateOldOutbox() {
        let old = UserDefaults.standard.stringArray(forKey: SessionStore.oldOutboxKey) ?? []
        guard !old.isEmpty else { return }
        UserDefaults.standard.removeObject(forKey: SessionStore.oldOutboxKey)
        editBox { o in
            for json in old {
                guard let data = json.data(using: .utf8),
                      let ev = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let added = OutboxCore.add(o, ev) else { continue }
                o = added.0
            }
        }
    }

    /// The phone applied these (a snapshot's `acked`): out of the outbox; then what it lacks goes again.
    private func phoneApplied(_ ids: [String]?) {
        if let ids = ids, !ids.isEmpty { editBox { o in o = OutboxCore.ack(o, ids) } }
        flush()
    }

    /// The phone in reach or not, and the events it has not stored yet: the small "syncs later" sign.
    private func updateLink() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        let r = session.activationState == .activated && session.isReachable
        let o = box
        let q = OutboxCore.waiting(o)
        let sets = OutboxCore.waitingSets(o)
        DispatchQueue.main.async {
            if self.reachable != r { self.reachable = r }
            if self.queued != q { self.queued = q }
            if self.unsentSets != sets { self.unsentSets = sets }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        updateLink()
        // Back in reach: what it may have missed goes now, quickly, as a message.
        if session.isReachable { DispatchQueue.main.async { self.flush(reconnect: true) } }
    }

    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        let id = (userInfoTransfer.userInfo["id"] as? String) ?? SessionStore.eventId(userInfoTransfer.userInfo["event"] as? String)
        if error == nil, let id = id {
            // On the phone now (its queue file): only rarely sent again, kept until applied.
            editBox { o in o = OutboxCore.delivered(o, [id]) }
        } else if error != nil {
            // Not tried again by the system: the outbox sends it again in a while.
            DispatchQueue.main.asyncAfter(deadline: .now() + OutboxCore.resendMs / 1000 + 1) { self.flush() }
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
        receive(session.receivedApplicationContext)
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
        receive(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    /// The phone's stamp on the newest snapshot applied (SnapshotOrder), only touched on main.
    private var snapshotAt: Double?

    /// A snapshot as the phone sent it, message or application context: applied unless older than
    /// the newest one already applied (the two travel apart, REDDIT-146). Checked on main, in the
    /// order they arrived, so two of them never overtake each other on the way to apply.
    func receive(_ payload: [String: Any]) {
        guard let json = payload["snapshot"] as? String else { return }
        let at = SnapshotOrder.stamp(payload)
        DispatchQueue.main.async {
            guard SnapshotOrder.accept(at, after: self.snapshotAt) else {
                self.log("an older snapshot from the phone was skipped")
                return
            }
            self.snapshotAt = SnapshotOrder.next(at, after: self.snapshotAt)
            self.apply(json: json)
        }
    }

    /* ---------- the demo the CI screenshots show (text only; a synthetic clip at most) ---------- */

    /// CI: the screens at an accessibility text size (OpenGymWatchApp reads it too).
    static var demoAX: Bool { ProcessInfo.processInfo.arguments.contains("-OpenGymWatchAX") }
    /// CI: as in Always On (wrist down), for what it costs to keep the screen up to date.
    static var demoAOD: Bool { ProcessInfo.processInfo.arguments.contains("-OpenGymWatchAOD") }

    /// CI: the part of the Metrics stack the demo opens on ("metrics-pulse", "metrics-effort").
    static var demoMetricsPart: MetricsStack.Part {
        switch demoScreen {
        case "metrics-pulse": return .pulse
        case "metrics-effort": return .effort
        case "metrics-zones": return .zones
        default: return .summary
        }
    }

    /// One screen of the demo workout (demoJSON: every kind of set), as CI photographs it.
    private func startDemo() {
        let screen = SessionStore.demoScreen ?? "set"
        if screen != "empty" { apply(json: screen == "idle" || screen == "countdown" ? SessionStore.demoReadyJSON : SessionStore.demoJSON) }
        // The 3-2-1 as it runs before a workout started here (without Apple Health, which the demo has not).
        if screen == "countdown" { countdownFrom = Date() }
        DispatchQueue.main.async {
            switch screen {
            case "set", "weight", "rest", "offline", "done", "spin", "rest-end", "rate", "plus15", "synced", "marked", "next", "edit-weight", "edit-reps", "keypad": self.picked[0] = 2
            case "set-failure", "set-both", "set-crowded":
                // Set types: the page with the "…" button and the Failure / Drop tags.
                self.picked[0] = 2
                self.state.settings.setMenu = true
                if var w = self.state.workout {
                    w.entries[0].sets[2].failure = true
                    if screen != "set-failure" { w.entries[0].sets[2].drop = 50 }
                    if screen == "set-crowded" { w.entries[0].sets[2].band = "Red + Blue" }
                    self.state.workout = w
                }
            case "menu", "menu-both", "menu-warmup", "menu-hint", "menu-hold", "removed", "toast":
                // Set types: the set menu (opened by SetPanel), the Removed screen, the toast.
                self.picked[0] = 2
                self.state.settings.setMenu = true
                if var w = self.state.workout {
                    if screen == "menu" || screen == "menu-both" || screen == "menu-hint" || screen == "menu-hold" { w.entries[0].sets[2].failure = true }
                    if screen == "menu-both" { w.entries[0].sets[2].drop = 50 }
                    if screen == "menu-warmup" { w.entries[0].sets[2].warmup = true }
                    self.state.workout = w
                }
                if screen == "removed" { self.removeSet(entry: 0, set: 2); self.undoTimer?.invalidate() }
                if screen == "toast" { self.addSet(entry: 0) }
            case "fix": self.picked[0] = 2; self.open(SetRef(entry: 0, set: 1)); self.fixR = 7
            case "metrics", "metrics-pulse", "metrics-effort", "metrics-zones":
                self.picked[0] = 2; self.tab = .metrics
                if screen != "metrics-effort" {
                    // 52 minutes of readings, a wave per set, so the sparkline has something to show.
                    let t0 = Date().addingTimeInterval(-3133)
                    let readings = stride(from: 0.0, to: 3133, by: 5).map { (t0.addingTimeInterval($0), 125 + 22 * sin($0 / 200) + 6 * sin($0 / 23)) }
                    self.health.demo(heartRate: 128, calories: 312, readings: readings, age: 38)
                }
                if screen == "metrics-effort", let w = self.state.workout {
                    self.state.settings.effort = "rir"
                    self.state.efforts = Dictionary(uniqueKeysWithValues: zip(w.entries, [2.0, 2.5, 1.0, 3.0]).map { (SessionCore.key($0.id, 0), $1) })
                }
            case "music": self.tab = .music
            case "prompt": self.idleMinutes = 47; self.idleEndsAt = Date().addingTimeInterval(180); self.askDone = true
            case "left": self.idleLeft = true; self.idleEndsAt = Date().addingTimeInterval(240); self.askDone = true
            case "go": self.goAt = .distantFuture
            case "hold": self.state.entryIndex = 1
            case "bodyweight": self.state.entryIndex = 2
            case "side": self.state.entryIndex = 3
            case "superset": self.state.entryIndex = 4
            case "finish", "overview": self.picked[0] = 2; self.tab = .overview
            case "weighin":
                self.bodyWeight = 81.4
                self.weighInFor = ReadySession(routineIds: ["r1"], name: "Push day", entries: [])
            default: break
            }
            // CI: the watch in another language than its own (the app's, as the phone sends it).
            if let lang = SessionStore.argument("-OpenGymWatchLang") { self.state.settings.lang = lang }
            if let show = SessionStore.argument("-OpenGymWatchShow") {
                // "all": every optional thing on, for a look at the fullest screen.
                if show == "all" { self.state.settings.show = WatchShow(clip: true, hr: true, last: true, kcal: true, next: true, rest: "ring") }
                if show == "plain" { self.state.settings.show = WatchShow(rest: "plain") }
                if show == "noclip" { self.state.settings.show = WatchShow(clip: false) }
            }
            self.loadTargets()
            if ["rest", "effort", "rate", "plus15"].contains(screen) { self.startRest(until: Date().addingTimeInterval(83), notify: false) }
            if screen == "effort" || screen == "rate" {
                self.state.settings.effort = "rir"
                self.lastLogged = SetRef(entry: 0, set: 1)
            }
            if ["rest", "effort", "rate", "plus15"].contains(screen) {
                self.health.setDemoHeartRate(128)
                self.workoutSeenAt = Date().addingTimeInterval(-(24 * 60 + 10))
                if let n = SessionStore.argument("-OpenGymWatchRated").flatMap(Double.init), screen == "effort" { self.lastRated = n }
                if let n = SessionStore.argument("-OpenGymWatchUnsynced").flatMap(Int.init) { self.unsentSets = n }
            }
            if screen == "hold" { self.startHold() }
            // CI clips of the motion: Done tapped, a fast Crown spin, a rest's last seconds.
            if screen == "done" { DispatchQueue.main.asyncAfter(deadline: .now() + 7) { self.completeSet() } }
            if screen == "spin" {
                for i in 0..<6 { DispatchQueue.main.asyncAfter(deadline: .now() + 7 + Double(i) * 0.12) { self.weight += 2.5 } }
            }
            if screen == "rate" { DispatchQueue.main.asyncAfter(deadline: .now() + 8) { withAnimation(.spring(response: 0.34, dampingFraction: 0.62)) { self.rateLast(2) } } }
            if screen == "plus15" { for t in [8.0, 8.4, 10.5] { DispatchQueue.main.asyncAfter(deadline: .now() + t) { if t < 10 { self.addRest(15) } else { self.minusRest() } } } }
            if screen == "synced" { DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.unsentSets = 1 }; DispatchQueue.main.asyncAfter(deadline: .now() + 9.5) { self.unsentSets = 2 } }
            if screen == "marked" { self.state.settings.setMenu = true; DispatchQueue.main.asyncAfter(deadline: .now() + 8) { if let r = self.shownRef { _ = self.mark(.failure, on: true, entry: r.entry, set: r.set) } } }
            if screen == "next" { DispatchQueue.main.asyncAfter(deadline: .now() + 7) { self.completeSet() }; DispatchQueue.main.asyncAfter(deadline: .now() + 9) { self.skipRestAndGo() } }
            if screen == "rest-end" { self.startRest(until: Date().addingTimeInterval(12), notify: false) }
            if screen == "offline" { self.reachable = false; self.queued = 3; self.unsentSets = 3 }
            if screen == "waiting" { self.queued = 2; self.unsentSets = 2; self.tab = .overview }
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
 *   count      a click each second of the 3-2-1 before a workout
 *   ask        two taps: "All done?", nothing logged for 20 minutes
 *   discarded  stop alone: the workout is gone, nothing saved
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
    static func mark() { play([(0, .click)]) }
    static func skip() { play([(0, .directionDown)]) }
    static func count() { play([(0, .click)]) }
    static func ask() { play([(0, .notification), (0.6, .notification)]) }
    static func discarded() { play([(0, .stop)]) }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
