import Foundation
import HealthKit

/*
 * Apple Health on the watch, behind the phone's Apple Health switch (Settings → Data on the iPhone,
 * sent with every snapshot as settings.health): a workout session (of the type the phone planned,
 * strength training unless it says otherwise: a run is a run, #799) as soon as a workout starts
 * here or is picked up from the phone, showing the live heart rate and keeping the watch app
 * running with the wrist down (so the rest still taps the wrist on time), and the workout saved to
 * Apple Health when it ends. Off, nothing of this runs and nothing is asked.
 *
 * The heart rate arrives two ways at once, whichever is first: the workout builder's statistics
 * and an anchored query on heart-rate samples, which carry their own time (the sets' and rests'
 * heart rates are worked out from those times). Until the first reading: "measuring".
 * The permission is asked when the phone's switch turns it on, at the start screen, never in the
 * middle of the first set. A workout started on the iPhone can open the app (HealthKit's
 * startWatchApp, WatchAppDelegate): the session starts then, and gets the workout's id when it comes.
 */
final class WorkoutManager: NSObject, ObservableObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
    static let enabledKey = "healthEnabled"

    @Published var enabled: Bool = UserDefaults.standard.bool(forKey: WorkoutManager.enabledKey) {
        didSet { UserDefaults.standard.set(enabled, forKey: WorkoutManager.enabledKey) }
    }
    @Published private(set) var heartRate: Double?
    @Published private(set) var running = false
    /// Demo screenshots only: a heart rate without a sensor.
    func setDemoHeartRate(_ v: Double) { heartRate = v }
    /// A session runs and no reading has come yet.
    var measuring: Bool { running && heartRate == nil }

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var query: HKAnchoredObjectQuery?
    /// Every reading of the session, by its own time, for each set's and rest's heart rate.
    private var samples: [(Date, Double)] = []
    /// The same, read-only, for the Pulse page.
    var heartSamples: [(Date, Double)] { samples }
    private let bpm = HKUnit.count().unitDivided(by: .minute())
    /// A workout to measure (started here or picked up), even before the permission answer.
    private var wanted = false

    /// { avg, max } over a stretch of the session, or nil without readings in it.
    func stats(from start: Date, to end: Date) -> [String: Double]? {
        let inside = samples.filter { $0.0 >= start && $0.0 <= end }.map { $0.1 }
        guard !inside.isEmpty else { return nil }
        let avg = inside.reduce(0, +) / Double(inside.count)
        return ["avg": avg.rounded(), "max": (inside.max() ?? avg).rounded()]
    }

    /// Asks for what the session needs: saving workouts, reading the heart rate.
    func requestAuthorization(_ done: @escaping (Bool) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else { done(false); return }
        var share: Set<HKSampleType> = [HKObjectType.workoutType()]
        var read: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { read.insert(hr) }
        // The age the Zones page takes the max heart rate from.
        if let dob = HKObjectType.characteristicType(forIdentifier: .dateOfBirth) { read.insert(dob) }
        // The calories the workout burned, for the summary at its end (and in Apple Health).
        if let kcal = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) { share.insert(kcal); read.insert(kcal) }
        // Resting energy too: Apple Health's "Total Energy" is active plus resting, and the live
        // builder only collects the types it may write (TestFlight 11-04: both read 0 kcal).
        if let basal = HKObjectType.quantityType(forIdentifier: .basalEnergyBurned) { share.insert(basal); read.insert(basal) }
        store.requestAuthorization(toShare: share, read: read) { ok, _ in
            DispatchQueue.main.async { done(ok) }
        }
    }

    /// "on", "off" or "denied", for the phone's Settings → Apple Watch.
    var status: String {
        guard HKHealthStore.isHealthDataAvailable() else { return "off" }
        if store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingDenied { return "denied" }
        return enabled ? "on" : "off"
    }

    /// The phone's setting, when it sends one: on asks for the permission (once) right away.
    /// Whether a permission this app asks for was never answered: a watch that said yes to an
    /// older build (workouts and heart rate only) was never asked for the calories, so its
    /// workouts went into Apple Health with 0 kcal (TestFlight 11-04). Asked once more then.
    private var needsMoreAuthorization: Bool {
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        // The date of birth too (Zones): a yes given before Zones never covered it.
        let types: [HKObjectType?] = [HKObjectType.quantityType(forIdentifier: .activeEnergyBurned),
                                      HKObjectType.quantityType(forIdentifier: .basalEnergyBurned),
                                      HKObjectType.characteristicType(forIdentifier: .dateOfBirth)]
        return types.compactMap { $0 }.contains { store.authorizationStatus(for: $0) == .notDetermined }
    }
    private var askedAgain = false

    func syncSetting(_ on: Bool?) {
        if on == true, enabled, !askedAgain, needsMoreAuthorization {
            askedAgain = true
            requestAuthorization { _ in self.onStatus?() }
            return
        }
        guard let on = on, on != enabled else { return }
        if on {
            requestAuthorization { ok in
                self.enabled = ok
                if ok && self.wanted { self.start() }
                self.onStatus?()
            }
        } else {
            enabled = false
            end(save: true)
            onStatus?()
        }
    }

    /// Told when the status changes (SessionStore reports it to the phone).
    var onStatus: (() -> Void)?

    /// The workout's id, for Apple Health's sync identifier (the phone writes none of its own then).
    private var workoutId: String?
    /// The id the running session carries already.
    private var tagged: String?

    /// One workout in Apple Health, not two: the phone skips writing one with this sync id.
    private func tag() {
        guard let b = builder, let wid = workoutId, tagged != wid else { return }
        tagged = wid
        b.addMetadata([HKMetadataKeySyncIdentifier: "opengym-w-\(wid)", HKMetadataKeySyncVersion: 1]) { _, _ in }
    }

    /// The phone's names for a workout's type (lib/health-connect.js SESSION_TYPES, #799).
    static let activityTypes: [String: HKWorkoutActivityType] = [
        "strength_training": .traditionalStrengthTraining, "walking": .walking, "running": .running,
        "biking_stationary": .cycling, "biking": .cycling, "elliptical": .elliptical, "stair_climbing_machine": .stairClimbing,
        "rowing": .rowing, "jump_rope": .jumpRope, "hiit": .highIntensityIntervalTraining, "mixed_cardio": .mixedCardio,
        "yoga": .yoga, "flexibility": .flexibility, "other_workout": .other,
    ]

    /// A session made and prepared, not started yet (the countdown before a workout started here).
    private var prepared = false

    /// The countdown before a workout started here: the session is made and prepared, which turns
    /// the heart-rate sensor on. It needs a few seconds to lock on, so set 1 has its heart rate.
    func prepare(type: String? = nil) {
        guard session == nil, make(type: type, opened: nil) else { return }
        prepared = true
        session?.prepare()
    }

    /// A workout started here or picked up from the phone: the session starts now (the prepared
    /// one, after a countdown), as the type the phone planned (a run is a run in Apple Health),
    /// else as the type HealthKit opened the app with, else strength training. A session already
    /// running keeps its type.
    func start(workoutId wid: String? = nil, type: String? = nil, opened: HKWorkoutActivityType? = nil) {
        wanted = true
        if let wid = wid { workoutId = wid }
        // Already running (opened by the phone before its workout arrived): only the id to add.
        if session != nil && !prepared { tag(); return }
        guard session != nil || make(type: type, opened: opened), let s = session, let b = builder else { return }
        prepared = false
        let now = Date()
        s.startActivity(with: now)
        b.beginCollection(withStart: now) { _, _ in }
        tagged = nil
        tag()
        startQuery(from: now)
        running = true
    }

    /// A new session of the planned type and its builder, when Apple Health is on.
    private func make(type: String?, opened: HKWorkoutActivityType?) -> Bool {
        guard enabled, HKHealthStore.isHealthDataAvailable() else { return false }
        let config = HKWorkoutConfiguration()
        config.activityType = type.flatMap { WorkoutManager.activityTypes[$0] } ?? opened ?? .traditionalStrengthTraining
        config.locationType = .indoor
        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self
            session = s
            builder = b
            samples = []
            heartRate = nil
            calories = nil
            paused = false
            return true
        } catch {
            session = nil
            builder = nil
            return false
        }
    }

    /// Rested for a workout nobody finishes (SensorPlan): the session pauses, which lets the
    /// heart-rate sensor go back to its everyday rate. Nothing is lost: the builder keeps what it
    /// measured, and the workout is still saved when it ends. `resume()` picks it up again.
    private(set) var paused = false

    func pause() {
        guard let s = session, !paused, s.state == .running else { return }
        paused = true
        s.pause()
    }

    func resume() {
        guard paused else { return }
        paused = false
        session?.resume()
    }

    /// The app was killed (or crashed) with a workout session running: watchOS kept the session and
    /// hands it back here, with everything it measured. Taken up as if never gone; a session this
    /// launch started meanwhile is dropped (one workout in Apple Health, not two).
    /// `stillRuns` (asked on main, once the session is back): whether a workout runs on the watch
    /// now. The session of a workout that ended meanwhile (finished on the phone while the app was
    /// dead, the snapshot applied before the session came back) is ended at once: taken up, it
    /// had nobody to end it, kept the sensor at workout rate for hours, and became the session of
    /// the next workout, started long before that one began.
    func recover(workoutId wid: String?, stillRuns: @escaping () -> Bool = { true }) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.recoverActiveWorkoutSession { recovered, _ in
            DispatchQueue.main.async {
                guard let s = recovered else { return }
                guard stillRuns() else {
                    let b = s.associatedWorkoutBuilder()
                    // No workout it could belong to: dropped, nothing saved.
                    guard let wid = wid else { b.discardWorkout(); s.end(); return }
                    // The workout it measured, ended on the phone meanwhile: saved under that
                    // workout's id, as when the watch app had been running (one copy in Apple
                    // Health; a workout discarded there is taken out again by `healthGone`).
                    b.addMetadata([HKMetadataKeySyncIdentifier: "opengym-w-\(wid)", HKMetadataKeySyncVersion: 1]) { _, _ in
                        s.end()
                        b.endCollection(withEnd: HealthWriteCore.liveEnd(at: nil, start: b.startDate, now: Date())) { _, _ in b.finishWorkout { _, _ in } }
                    }
                    return
                }
                if let other = self.session, other !== s {
                    // Discarded before it ends, or the discard saves it (see end).
                    self.builder?.discardWorkout()
                    other.end()
                }
                let b = s.associatedWorkoutBuilder()
                b.dataSource = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: s.workoutConfiguration)
                s.delegate = self
                b.delegate = self
                self.session = s
                self.builder = b
                self.paused = s.state == .paused
                self.wanted = true
                if let wid = wid { self.workoutId = wid }
                self.tagged = nil
                self.tag()
                if let q = self.query { self.store.stop(q) }
                self.startQuery(from: s.startDate ?? Date())
                self.running = true
            }
        }
    }

    /// Takes out of Apple Health the workouts this app saved under these sync ids (workouts deleted
    /// in openGym), with the calories saved along with them. Heart-rate readings are the watch's
    /// sensors' own and stay, as with Apple's Workout app. `done` gets the ids that are settled:
    /// removed, or with no copy of this app's to remove. Nothing settled when Health could not be
    /// read or the delete was refused: the next snapshot tries again.
    /// `keepTrying`: ids of workouts that ran here just now, whose copy may still be on its way
    /// into Health (a workout deleted on the phone while the watch was still saving it): not
    /// settled while no copy is found, so the next snapshot looks again.
    func deleteWorkouts(syncIds ids: [String], keepTrying: Set<String> = [], done: @escaping ([String]) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(), !ids.isEmpty else { done([]); return }
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: ids)
        let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, found, error in
            guard let self = self else { return }
            if error != nil { DispatchQueue.main.async { done([]) }; return }
            let me = Bundle.main.bundleIdentifier ?? ""
            let mine = (found as? [HKWorkout] ?? []).filter { $0.sourceRevision.source.bundleIdentifier == me }
            let held = Set(mine.compactMap { $0.metadata?[HKMetadataKeySyncIdentifier] as? String })
            // Settled without a delete: no copy of this app's, and not one that may still come.
            let nothing = ids.filter { !held.contains($0) && !keepTrying.contains($0) }
            if mine.isEmpty { DispatchQueue.main.async { done(nothing) }; return }
            let group = DispatchGroup()
            if let kcal = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
                for w in mine {
                    group.enter()
                    self.store.deleteObjects(of: kcal, predicate: HKQuery.predicateForObjects(from: w)) { _, _, _ in group.leave() }
                }
            }
            group.notify(queue: .global()) {
                self.store.delete(mine) { ok, _ in
                    DispatchQueue.main.async { done(ok ? nothing + Array(held) : nothing) }
                }
            }
        }
        store.execute(q)
    }

    private func startQuery(from start: Date) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        let handler: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?) -> Void = { [weak self] _, added, _, _, _ in
            guard let self = self else { return }
            let readings = (added as? [HKQuantitySample] ?? []).map { ($0.endDate, $0.quantity.doubleValue(for: self.bpm)) }
            guard !readings.isEmpty else { return }
            DispatchQueue.main.async { self.add(readings) }
        }
        let q = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: nil, limit: HKObjectQueryNoLimit, resultsHandler: handler)
        q.updateHandler = handler
        query = q
        store.execute(q)
    }

    /// When the badge last changed: it follows the readings at most every few seconds (a redraw of
    /// the page each time costs battery), sooner when the number really moves.
    private var shownAt = Date.distantPast

    private func add(_ readings: [(Date, Double)]) {
        // Kept in time order by inserting each reading where it belongs: a duplicate (the same reading
        // from the query and from the builder) can then only be the neighbour on either side, instead
        // of a scan of the whole workout's readings and a full sort for every new one.
        for r in readings {
            var lo = 0, hi = samples.count
            while lo < hi { let mid = (lo + hi) / 2; if samples[mid].0 < r.0 { lo = mid + 1 } else { hi = mid } }
            if lo < samples.count && abs(samples[lo].0.timeIntervalSince(r.0)) < 0.5 { continue }
            if lo > 0 && abs(samples[lo - 1].0.timeIntervalSince(r.0)) < 0.5 { continue }
            samples.insert(r, at: lo)
        }
        guard let last = samples.last?.1 else { return }
        let now = Date()
        if heartRate == nil || abs((heartRate ?? 0) - last) >= 5 || now.timeIntervalSince(shownAt) >= 4 {
            if heartRate != last { heartRate = last }
            shownAt = now
        }
    }

    /// The whole session's heart rate and calories, for the summary.
    struct Totals {
        var hrAvg: Double?
        var hrMax: Double?
        var calories: Double?
    }

    /// The workout ended: saved to Apple Health, or dropped when `save` is false. `totals` gets the
    /// session's heart rate and calories (nothing when no session ran). `at`: when it really ended
    /// (a workout left running ends at its last set, not when the watch noticed), else now.
    func end(save: Bool, at: Date? = nil, totals: ((Totals) -> Void)? = nil) {
        wanted = false
        workoutId = nil
        prepared = false
        if let q = query { store.stop(q); query = nil }
        let endAt = at ?? Date()
        let all = samples.filter { $0.0 <= endAt }.map { $0.1 }
        let hr = Totals(hrAvg: all.isEmpty ? nil : (all.reduce(0, +) / Double(all.count)).rounded(), hrMax: all.max()?.rounded(), calories: nil)
        guard let s = session, let b = builder else {
            if let totals = totals { DispatchQueue.main.async { totals(hr) } }
            return
        }
        session = nil
        builder = nil
        paused = false
        if !save {
            // Dropped while the builder still collects: discarded first, the session ended after,
            // and no endCollection. With the session and the collection ended first, HealthKit can
            // take the discard for a finish (its builder has only "finish" left from there), and a
            // discarded workout still turned up in Apple Health (TestFlight 1.4.4, #776).
            b.discardWorkout()
            s.end()
            if let totals = totals { DispatchQueue.main.async { totals(hr) } }
            settle()
            return
        }
        s.end()
        // Never before the session's own start (a workout picked up from the phone after its last set).
        // Never before the start, never ahead of now (a phone's clock or a stale snapshot): HealthWriteCore.liveEnd.
        b.endCollection(withEnd: HealthWriteCore.liveEnd(at: endAt, start: b.startDate, now: Date())) { _, _ in
            var out = hr
            if let kcalType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
               let kcal = b.statistics(for: kcalType)?.sumQuantity()?.doubleValue(for: .kilocalorie()), kcal > 0 {
                out.calories = kcal.rounded()
            }
            if let totals = totals { DispatchQueue.main.async { totals(out) } }
            b.finishWorkout { _, _ in }
        }
        settle()
    }

    /// The badge after a session ended, unless a new one started meanwhile (a workout that
    /// follows straight on the one discarded).
    private func settle() {
        DispatchQueue.main.async {
            guard self.session == nil else { return }
            self.running = false
            self.heartRate = nil
        }
    }

    /* ---------- delegates ---------- */

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        guard toState == .ended || toState == .stopped else { return }
        DispatchQueue.main.async { self.lost(workoutSession) }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.lost(workoutSession) }
    }

    /// The system ended or failed the session while the workout still runs (another workout app,
    /// an error). It used to stay in `session`, so start() never made a new one: the rest of the
    /// workout ran without a session, nothing kept the app in front, and a timed set or a rest
    /// running out dropped you on the watch face (#883, #936). What it measured is saved, and the
    /// next set or hold starts a fresh one. A session we ended ourselves is already gone from `session`.
    private func lost(_ s: HKWorkoutSession) {
        guard let current = session, current === s else { return }
        let b = builder
        session = nil
        builder = nil
        prepared = false
        paused = false
        tagged = nil
        if let q = query { store.stop(q); query = nil }
        if let b = b {
            let endAt = Date()
            b.endCollection(withEnd: HealthWriteCore.liveEnd(at: endAt, start: b.startDate, now: Date())) { _, _ in b.finishWorkout { _, _ in } }
        }
        running = false
        heartRate = nil
        // No restart from here: a session the system keeps refusing would loop. The next thing the
        // lifter does (a set, a hold, a rest from the phone) goes through start() and makes one.
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    /// Active calories so far, for the workout screen when it shows them (at most every 10 s).
    @Published private(set) var calories: Double?
    private var caloriesAt = Date.distantPast

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        if let kcalType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned), collectedTypes.contains(kcalType),
           let kcal = workoutBuilder.statistics(for: kcalType)?.sumQuantity()?.doubleValue(for: .kilocalorie()) {
            DispatchQueue.main.async {
                let now = Date()
                guard now.timeIntervalSince(self.caloriesAt) >= 10 || self.calories == nil else { return }
                self.caloriesAt = now
                let rounded = kcal.rounded()
                if self.calories != rounded { self.calories = rounded }
            }
        }
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate),
              collectedTypes.contains(hrType),
              let stats = workoutBuilder.statistics(for: hrType),
              let value = stats.mostRecentQuantity()?.doubleValue(for: bpm) else { return }
        let at = stats.mostRecentQuantityDateInterval()?.end ?? Date()
        DispatchQueue.main.async { self.add([(at, value)]) }
    }

    /// CI's screenshots (SessionStore.startDemo): a measuring session with a workout's readings.
    /// Age from Apple Health's date of birth; nil when it is not there or not shared.
    var age: Int? {
        if let demoAge { return demoAge }
        guard let dob = try? store.dateOfBirthComponents(), let born = Calendar.current.date(from: dob) else { return nil }
        return Calendar.current.dateComponents([.year], from: born, to: Date()).year
    }
    private var demoAge: Int?

    func demo(heartRate hr: Double?, calories kcal: Double?, readings: [(Date, Double)], age: Int? = nil) {
        samples = readings; demoAge = age
        heartRate = hr; calories = kcal; running = true
    }
}
