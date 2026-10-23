import Foundation
import HealthKit

/*
 * Apple Health on the watch, behind the phone's Apple Health switch (Settings → Data on the iPhone,
 * sent with every snapshot as settings.health): a strength-training workout session as soon
 * as a workout starts here or is picked up from the phone, showing the live heart rate and keeping
 * the watch app running with the wrist down (so the rest still taps the wrist on time), and the
 * workout saved to Apple Health when it ends. Off, nothing of this runs and nothing is asked.
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
    /// A session runs and no reading has come yet.
    var measuring: Bool { running && heartRate == nil }

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var query: HKAnchoredObjectQuery?
    /// Every reading of the session, by its own time, for each set's and rest's heart rate.
    private var samples: [(Date, Double)] = []
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
        // The calories the workout burned, for the summary at its end (and in Apple Health).
        if let kcal = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) { share.insert(kcal); read.insert(kcal) }
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
    func syncSetting(_ on: Bool?) {
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

    /// A workout started here or picked up from the phone: the session starts now.
    func start(workoutId wid: String? = nil) {
        wanted = true
        if let wid = wid { workoutId = wid }
        // Already running (opened by the phone before its workout arrived): only the id to add.
        if session != nil { tag(); return }
        guard enabled, HKHealthStore.isHealthDataAvailable() else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
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
            let now = Date()
            s.startActivity(with: now)
            b.beginCollection(withStart: now) { _, _ in }
            tagged = nil
            tag()
            startQuery(from: now)
            running = true
        } catch {
            session = nil
            builder = nil
        }
    }

    /// The app was killed (or crashed) with a workout session running: watchOS kept the session and
    /// hands it back here, with everything it measured. Taken up as if never gone; a session this
    /// launch started meanwhile is dropped (one workout in Apple Health, not two).
    func recover(workoutId wid: String?) {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        store.recoverActiveWorkoutSession { recovered, _ in
            DispatchQueue.main.async {
                guard let s = recovered else { return }
                if let other = self.session, other !== s {
                    other.end()
                    self.builder?.discardWorkout()
                }
                let b = s.associatedWorkoutBuilder()
                b.dataSource = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: s.workoutConfiguration)
                s.delegate = self
                b.delegate = self
                self.session = s
                self.builder = b
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
        for r in readings where !samples.contains(where: { abs($0.0.timeIntervalSince(r.0)) < 0.5 }) { samples.append(r) }
        samples.sort { $0.0 < $1.0 }
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
    /// session's heart rate and calories (nothing when no session ran).
    func end(save: Bool, totals: ((Totals) -> Void)? = nil) {
        wanted = false
        workoutId = nil
        if let q = query { store.stop(q); query = nil }
        let all = samples.map { $0.1 }
        let hr = Totals(hrAvg: all.isEmpty ? nil : (all.reduce(0, +) / Double(all.count)).rounded(), hrMax: all.max()?.rounded(), calories: nil)
        guard let s = session, let b = builder else {
            if let totals = totals { DispatchQueue.main.async { totals(Totals()) } }
            return
        }
        s.end()
        b.endCollection(withEnd: Date()) { _, _ in
            var out = hr
            if let kcalType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
               let kcal = b.statistics(for: kcalType)?.sumQuantity()?.doubleValue(for: .kilocalorie()), kcal > 0 {
                out.calories = kcal.rounded()
            }
            if let totals = totals { DispatchQueue.main.async { totals(out) } }
            if save {
                b.finishWorkout { _, _ in }
            } else {
                b.discardWorkout()
            }
        }
        session = nil
        builder = nil
        DispatchQueue.main.async {
            self.running = false
            self.heartRate = nil
        }
    }

    /* ---------- delegates ---------- */

    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.running = false }
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
}
