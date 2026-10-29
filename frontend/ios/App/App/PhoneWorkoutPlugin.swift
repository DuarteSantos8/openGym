import Capacitor
import Foundation
import HealthKit

/**
 * A workout session on the iPhone itself (iOS 26 and later, #818): what makes AirPods Pro 3 and
 * Powerbeats Pro 2 measure the heart rate, since iOS only turns their sensor on while an app on the
 * phone runs a workout session. The page (lib/phone-workout.js) decides when it runs: Apple Health
 * on, a live workout on this phone, and no Apple Watch app taking that workout. The heart rate it
 * gathers goes into the same per-set fields the watch fills (set.hr / set.restHr), worked out on the
 * page from the samples' own times, and the workout is saved to Apple Health once, here, with the
 * same sync identifier the post-hoc write would use ('opengym-w-<id>'), so that one is skipped
 * (AppleHealthPlugin.saveSession asks PhoneWorkoutLedger).
 *
 * Taking the AirPods out only stops the readings: HealthKit keeps the session, and they come back
 * when the buds go back in. The app killed mid-workout: iOS hands the session back at the next launch
 * (AppDelegate, recoverActiveWorkoutSession), and the page adopts it for its running workout.
 *
 * Usage from JS:
 *   const PhoneWorkout = registerPlugin('PhoneWorkout')
 *   await PhoneWorkout.status()     // { supported, running, wid, start }
 *   await PhoneWorkout.start({ wid, type })       // { ok, wid, start }
 *   await PhoneWorkout.recover()    // { wid, start } of a session iOS kept, or {}
 *   await PhoneWorkout.samples({ since })         // { samples: [[ms, bpm]] }
 *   await PhoneWorkout.end({ wid, save, at, title, discarded })   // discarded: the workout is gone, never saved
 *   PhoneWorkout.addListener('heartRate', ({ bpm, at }) => ...)   // at most every few seconds
 *
 * Below iOS 26 status says { supported: false } and every other call does nothing.
 */
@objc(PhoneWorkoutPlugin)
public class PhoneWorkoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhoneWorkoutPlugin"
    public let jsName = "PhoneWorkout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "samples", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        if #available(iOS 26.0, *) {
            PhoneWorkoutSession.shared.onReading = { [weak self] bpm, at in
                self?.notifyListeners("heartRate", data: ["bpm": bpm, "at": at])
            }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *), HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["supported": false, "running": false])
            return
        }
        let s = PhoneWorkoutSession.shared
        DispatchQueue.main.async {
            var out: [String: Any] = ["supported": true, "running": s.running]
            if let wid = s.workoutId { out["wid"] = wid }
            if let start = s.startedAt { out["start"] = start.timeIntervalSince1970 * 1000 }
            call.resolve(out)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *), let wid = call.getString("wid"), !wid.isEmpty else {
            call.resolve(["ok": false])
            return
        }
        let type = call.getString("type")
        DispatchQueue.main.async {
            let s = PhoneWorkoutSession.shared
            let ok = s.start(workoutId: wid, type: type)
            var out: [String: Any] = ["ok": ok]
            if let w = s.workoutId { out["wid"] = w }
            if let start = s.startedAt { out["start"] = start.timeIntervalSince1970 * 1000 }
            call.resolve(out)
        }
    }

    @objc func recover(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { call.resolve([:]); return }
        PhoneWorkoutSession.shared.recover { wid, start in
            var out: [String: Any] = [:]
            if let wid = wid { out["wid"] = wid }
            if let start = start { out["start"] = start.timeIntervalSince1970 * 1000 }
            call.resolve(out)
        }
    }

    @objc func samples(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { call.resolve(["samples": []]); return }
        let since = call.getDouble("since").map { Date(timeIntervalSince1970: $0 / 1000) }
        PhoneWorkoutSession.shared.samples(since: since) { list in
            call.resolve(["samples": list.map { [$0.0.timeIntervalSince1970 * 1000, $0.1] }])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 26.0, *) else { call.resolve(); return }
        let save = call.getBool("save") ?? true
        let at = call.getDouble("at").map { Date(timeIntervalSince1970: $0 / 1000) }
        let wid = call.getString("wid")
        let title = call.getString("title")
        let discarded = call.getBool("discarded") ?? false
        DispatchQueue.main.async {
            PhoneWorkoutSession.shared.end(workoutId: wid, save: save && !discarded, at: at, title: title, discarded: discarded)
            call.resolve()
        }
    }
}

/**
 * Which workouts the phone's own session saved to Apple Health (by sync identifier), so the post-hoc
 * write (AppleHealthPlugin.saveSession) leaves them alone: one workout in Apple Health, not two, and
 * the live one keeps the heart rate it was saved with. "live": a session runs or is being saved;
 * "saved": it is in Apple Health. Kept in UserDefaults (the last few dozen), so a relaunch still knows.
 * Not gated on iOS 26, because the plugin that asks runs everywhere.
 */
enum PhoneWorkoutLedger {
    private static let key = "phoneWorkoutLedger"
    private static let max = 60
    private static let lock = NSLock()

    private static func read() -> [[String]] {
        (UserDefaults.standard.array(forKey: key) as? [[String]]) ?? []
    }

    static func mark(_ syncId: String, _ state: String?) {
        lock.lock(); defer { lock.unlock() }
        var all = read().filter { $0.first != syncId }
        if let state = state { all.append([syncId, state]) }
        UserDefaults.standard.set(Array(all.suffix(max)), forKey: key)
    }

    static func state(_ syncId: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return read().first { $0.first == syncId }?.last
    }

    /// Whether the phone's own session has (or is about to have) this workout in Apple Health. A
    /// session still being saved is waited for, a little: the page finishes a workout and writes it
    /// in the same breath, and the live save is the one that should win.
    static func handled(_ syncId: String) async -> Bool {
        for _ in 0..<40 {
            switch state(syncId) {
            case "saved": return true
            case "live": try? await Task.sleep(nanoseconds: 500_000_000)
            default: return false
            }
        }
        // Still running after 20 s: a session nobody ended. The post-hoc write goes ahead; it
        // carries a newer sync version, so Apple Health keeps one workout either way.
        return false
    }
}

@available(iOS 26.0, *)
final class PhoneWorkoutSession: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let shared = PhoneWorkoutSession()

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var query: HKAnchoredObjectQuery?
    private let bpm = HKUnit.count().unitDivided(by: .minute())
    /// Every reading of the session by its own time, oldest first (main queue only).
    private var readings: [(Date, Double)] = []

    private(set) var workoutId: String?
    private(set) var startedAt: Date?
    var running: Bool { session != nil }
    /// Told about a new reading, at most every few seconds (the page's small live readout).
    var onReading: ((Double, Double) -> Void)?
    private var toldAt = Date.distantPast
    private var toldBpm: Double?
    /// A recovery asked for at launch, before anyone was listening: its answer, for the page.
    private var recovering = false
    private var recoverWaiters: [(String?, Date?) -> Void] = []

    private static func syncId(_ wid: String) -> String { "opengym-w-\(wid)" }

    /// A session for this workout, started now; true when one runs for it afterwards. A session
    /// already running for it is kept; one left over from another workout is dropped unsaved.
    func start(workoutId wid: String, type: String?) -> Bool {
        if session != nil, workoutId == wid { return true }
        if session != nil { end(workoutId: nil, save: false, at: nil, title: nil, discarded: false) }
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        let config = HKWorkoutConfiguration()
        config.activityType = type.flatMap { AppleHealthPlugin.activityTypes[$0] } ?? .traditionalStrengthTraining
        config.locationType = .indoor
        let s: HKWorkoutSession
        do { s = try HKWorkoutSession(healthStore: store, configuration: config) } catch { return false }
        let b = s.associatedWorkoutBuilder()
        b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
        s.delegate = self
        b.delegate = self
        session = s
        builder = b
        readings = []
        toldBpm = nil
        workoutId = wid
        let now = Date()
        startedAt = now
        PhoneWorkoutLedger.mark(Self.syncId(wid), "live")
        s.startActivity(with: now)
        b.beginCollection(withStart: now) { _, _ in
            // One workout in Apple Health: the post-hoc write finds this sync id and skips it.
            b.addMetadata([HKMetadataKeySyncIdentifier: Self.syncId(wid), HKMetadataKeySyncVersion: 1]) { _, _ in }
        }
        startQuery(from: now)
        return true
    }

    /// The app was killed (or crashed) with a session running: iOS kept it and hands it back, with
    /// everything it measured. The workout's id comes from the sync identifier it was started with.
    func recover(_ done: ((String?, Date?) -> Void)? = nil) {
        DispatchQueue.main.async {
            if self.session != nil { done?(self.workoutId, self.startedAt); return }
            if let done = done { self.recoverWaiters.append(done) }
            guard !self.recovering else { return }
            self.recovering = true
            guard HKHealthStore.isHealthDataAvailable() else { self.settleRecovery(); return }
            self.store.recoverActiveWorkoutSession { recovered, _ in
                DispatchQueue.main.async {
                    if let s = recovered, self.session == nil { self.adopt(s) }
                    self.settleRecovery()
                }
            }
        }
    }

    private func settleRecovery() {
        recovering = false
        let waiters = recoverWaiters
        recoverWaiters = []
        for w in waiters { w(workoutId, startedAt) }
    }

    private func adopt(_ s: HKWorkoutSession) {
        let b = s.associatedWorkoutBuilder()
        b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: s.workoutConfiguration)
        s.delegate = self
        b.delegate = self
        session = s
        builder = b
        let sid = (b.metadata as [String: Any]?)?[HKMetadataKeySyncIdentifier] as? String
        workoutId = sid.flatMap { $0.hasPrefix("opengym-w-") ? String($0.dropFirst("opengym-w-".count)) : nil }
        startedAt = s.startDate ?? b.startDate ?? Date()
        readings = []
        if let q = query { store.stop(q); query = nil }
        startQuery(from: startedAt ?? Date())
    }

    /// The session's readings since `since` (or its start), oldest first: the ones it was told
    /// about, and whatever Apple Health holds for that time that never reached it (readings saved
    /// while the phone was locked come in only once it is unlocked).
    func samples(since: Date?, done: @escaping ([(Date, Double)]) -> Void) {
        DispatchQueue.main.async {
            guard let start = self.startedAt, self.session != nil,
                  let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { done([]); return }
            let from = max(since ?? start, start)
            let predicate = HKQuery.predicateForSamples(withStart: from, end: nil, options: [])
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { [weak self] _, found, _ in
                guard let self = self else { return }
                let fresh = (found as? [HKQuantitySample] ?? []).map { ($0.endDate, $0.quantity.doubleValue(for: self.bpm)) }
                DispatchQueue.main.async {
                    self.add(fresh)
                    done(self.readings.filter { $0.0 >= from })
                }
            }
            self.store.execute(q)
        }
    }

    /// The workout is over: saved to Apple Health (or dropped, `save` false) as it ended at `at`.
    /// `wid` given: only that workout's session ends (a late call for another one changes nothing).
    /// `discarded`: the workout itself was discarded in the app. Then a copy of it that reached
    /// Apple Health anyway is taken out again, a moment later.
    func end(workoutId wid: String?, save: Bool, at: Date?, title: String?, discarded: Bool = false) {
        guard let s = session, let b = builder else { return }
        if let wid = wid, wid != workoutId { return }
        let sid = workoutId.map(Self.syncId)
        if let q = query { store.stop(q); query = nil }
        let endAt = max(at ?? Date(), b.startDate ?? startedAt ?? Date())
        session = nil
        builder = nil
        workoutId = nil
        startedAt = nil
        readings = []
        toldBpm = nil
        if !save {
            // Discarded while the builder still collects, the session ended after: ended first,
            // HealthKit can take the discard for a finish and save the workout (TestFlight 1.4.4).
            b.discardWorkout()
            s.end()
            if let sid = sid {
                PhoneWorkoutLedger.mark(sid, nil)
                if discarded { removeLater(sid) }
            }
            return
        }
        // As Apple's iPhone sample: the activity stops, and once the session says it has stopped
        // the builder ends and saves, then the session ends. Not waited for longer than a few
        // seconds: a session that never reports it is saved all the same.
        var meta: [String: Any] = [:]
        if let title = title, !title.isEmpty { meta["OpenGymTitle"] = title }
        let finish = {
            b.endCollection(withEnd: endAt) { _, _ in
                b.addMetadata(meta) { _, _ in
                    b.finishWorkout { workout, _ in
                        if let sid = sid { PhoneWorkoutLedger.mark(sid, workout != nil ? "saved" : nil) }
                        s.end()
                    }
                }
            }
        }
        stopping.append((s, finish))
        s.stopActivity(with: endAt)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { self.finishStopped(s) }
    }

    /// A discarded workout's copy, should one have reached Apple Health all the same: this app's
    /// own workouts with its sync id are deleted (never the watch app's, never another app's).
    private func removeLater(_ sid: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [sid])
            let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 5, sortDescriptors: nil) { [weak self] _, found, _ in
                guard let self = self else { return }
                let me = Bundle.main.bundleIdentifier ?? ""
                let mine = (found ?? []).filter { $0.sourceRevision.source.bundleIdentifier == me }
                guard !mine.isEmpty else { return }
                self.store.delete(mine) { _, _ in }
            }
            self.store.execute(q)
        }
    }

    /// Sessions told to stop, with what saves each once it has.
    private var stopping: [(HKWorkoutSession, () -> Void)] = []

    private func finishStopped(_ s: HKWorkoutSession) {
        guard let i = stopping.firstIndex(where: { $0.0 === s }) else { return }
        let run = stopping.remove(at: i).1
        run()
    }

    private func startQuery(from start: Date) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, added, _, _, _ in
            guard let self = self else { return }
            let fresh = (added as? [HKQuantitySample] ?? []).map { ($0.endDate, $0.quantity.doubleValue(for: self.bpm)) }
            guard !fresh.isEmpty else { return }
            DispatchQueue.main.async { self.add(fresh) }
        }
        let q = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: nil, limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        query = q
        store.execute(q)
    }

    /// Kept in time order; the same reading from the query and from the builder is one reading.
    private func add(_ fresh: [(Date, Double)]) {
        guard session != nil else { return }
        for r in fresh where r.1 >= 25 && r.1 <= 250 {
            var lo = 0, hi = readings.count
            while lo < hi { let mid = (lo + hi) / 2; if readings[mid].0 < r.0 { lo = mid + 1 } else { hi = mid } }
            if lo < readings.count && abs(readings[lo].0.timeIntervalSince(r.0)) < 0.5 { continue }
            if lo > 0 && abs(readings[lo - 1].0.timeIntervalSince(r.0)) < 0.5 { continue }
            readings.insert(r, at: lo)
        }
        guard let last = readings.last else { return }
        let now = Date()
        if toldBpm == nil || abs((toldBpm ?? 0) - last.1) >= 5 || now.timeIntervalSince(toldAt) >= 4 {
            toldBpm = last.1
            toldAt = now
            onReading?(last.1.rounded(), last.0.timeIntervalSince1970 * 1000)
        }
    }

    /* ---------- delegates ---------- */

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .stopped else { return }
        DispatchQueue.main.async { self.finishStopped(workoutSession) }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        // Another workout took over (a second session, Apple's Fitness app): this one is gone, and
        // what it measured so far stays where the page already put it.
        DispatchQueue.main.async {
            guard self.session === workoutSession else { return }
            if let q = self.query { self.store.stop(q); self.query = nil }
            if let wid = self.workoutId { PhoneWorkoutLedger.mark(Self.syncId(wid), nil) }
            self.builder?.discardWorkout()
            self.session = nil
            self.builder = nil
            self.workoutId = nil
            self.startedAt = nil
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(hrType),
              let stats = workoutBuilder.statistics(for: hrType),
              let value = stats.mostRecentQuantity()?.doubleValue(for: bpm) else { return }
        let at = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        DispatchQueue.main.async {
            guard self.builder === workoutBuilder else { return }
            self.add([(at, value)])
        }
    }
}
