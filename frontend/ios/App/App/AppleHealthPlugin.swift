import Capacitor
import Foundation
import HealthKit
import UIKit

/**
 * Apple Health on the iPhone, the same calls as HealthConnectPlugin.java (lib/health-sync.js):
 * finished workouts and weigh-ins go to Apple Health, each with a sync identifier of its own
 * ('opengym-w-<id>', 'opengym-bw-<day>'), so writing one again replaces it and removing finds
 * exactly what openGym wrote. It asks to read the heart rate and the body weight too, for the
 * Apple Watch app's workout session, and keeps the switch where the watch link reads it
 * (App Group "healthEnabled").
 *
 * A workout the Apple Watch app already saved for the same session (same sync identifier, the
 * watch as its source) is left as it is: it has the heart rate in it, and a second copy would count
 * the session twice. The same goes for one the iPhone's own workout session saved (iOS 26, AirPods
 * heart rate, PhoneWorkoutPlugin.swift), which PhoneWorkoutLedger remembers. Removing takes that copy out too, and says which ids Apple Health still holds
 * afterwards, so lib/health-sync.js keeps them and tries again rather than forgetting them.
 *
 * Reading back (v1.4.3), each behind its own switch in Settings: the heart rate during a finished
 * workout (readHeartRate, for any watch that saves to Apple Health, Garmin and Polar included) and
 * weigh-ins other apps saved (readWeights). Foreground only, through HKSampleQuery; what to take is
 * decided in JS (lib/health-read.js). Apple Health never says whether reading was allowed, so a
 * refusal simply reads nothing.
 */
@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleHealthPlugin"
    public let jsName = "AppleHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWeights", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBody", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readVitals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "allowBirthDate", returnType: CAPPluginReturnPromise),
    ]

    static let enabledKey = "healthEnabled"
    private let store = HKHealthStore()
    private var bodyMass: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyMass)! }

    /// The estimated active energy of a workout logged on the phone (#724), lib/active-energy.js.
    private var activeEnergy: HKQuantityType? { HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) }

    private var shareTypes: Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType(), bodyMass]
        if let kcal = activeEnergy { types.insert(kcal) }
        return types
    }
    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType(), bodyMass]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
        // What a watch measured during a workout logged on the phone wins over the estimate.
        if let kcal = activeEnergy { types.insert(kcal) }
        return types
    }

    /// Saving workouts is what the switch is about; weigh-ins follow when allowed too.
    private var granted: Bool { store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized }
    /// Optional: refused, the workouts still go in, without calories.
    private var caloriesGranted: Bool {
        guard let kcal = activeEnergy else { return false }
        return store.authorizationStatus(for: kcal) == .sharingAuthorized
    }

    @objc func status(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "unsupported", "granted": false])
            return
        }
        call.resolve(["status": "available", "granted": granted, "calories": caloriesGranted])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["granted": false]); return }
        // { read: ['heartRate' | 'weight'], write: [...] } asks for just those reads (the switches
        // added in v1.4.3); without them, everything, as before.
        // write: ['calories'] asks for the active energy alone (someone who turned Health on
        // before v1.4.5 never saw it).
        if let read = call.getArray("read") as? [String] {
            var types: Set<HKObjectType> = []
            if read.contains("heartRate"), let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
            if read.contains("weight") { types.insert(bodyMass) }
            // Body composition (v1.4.5): Apple Health has body fat and lean mass of the four.
            if read.contains("bodyFat"), let fat = HKObjectType.quantityType(forIdentifier: .bodyFatPercentage) { types.insert(fat) }
            if read.contains("leanMass"), let lean = HKObjectType.quantityType(forIdentifier: .leanBodyMass) { types.insert(lean) }
            // Vitals (v1.4.5, lib/vitals.js): the Daily form card and the check-in's sleep.
            if read.contains("sleep"), let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
            if read.contains("restingHeartRate"), let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) { types.insert(rhr) }
            if read.contains("hrv"), let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) { types.insert(hrv) }
            if read.contains("steps"), let steps = HKObjectType.quantityType(forIdentifier: .stepCount) { types.insert(steps) }
            // Sport (v1.4.5, gm-hooks, lib/activities.js): other apps' workouts, as activities and recovery suggestions.
            if read.contains("exercise") { types.insert(HKObjectType.workoutType()) }
            if read.contains("distance"), let dist = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) { types.insert(dist) }
            if (read.contains("calories") || read.contains("totalCalories")), let kcal = activeEnergy { types.insert(kcal) }
            if read.contains("floors"), let fl = HKObjectType.quantityType(forIdentifier: .flightsClimbed) { types.insert(fl) }
            if read.contains("speed"), let ws = HKObjectType.quantityType(forIdentifier: .walkingSpeed) { types.insert(ws) }
            var share: Set<HKSampleType> = []
            if let write = call.getArray("write") as? [String], write.contains("calories"), let kcal = activeEnergy { share.insert(kcal); types.insert(kcal) }
            store.requestAuthorization(toShare: share, read: types) { _, _ in
                call.resolve(["granted": self.granted, "calories": self.caloriesGranted])
            }
            return
        }
        store.requestAuthorization(toShare: shareTypes, read: readTypes) { _, _ in
            call.resolve(["granted": self.granted, "calories": self.caloriesGranted])
        }
    }

    /// The Apple Watch's Zones page takes the max heart rate from the age; the watch app shares this
    /// app's Health permissions. Asks once; once answered, Apple Health is the only place to change
    /// it, so it opens there. Answers { opened: Bool }.
    @objc func allowBirthDate(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(),
              let dob = HKObjectType.characteristicType(forIdentifier: .dateOfBirth) else { call.resolve(["opened": false]); return }
        store.getRequestStatusForAuthorization(toShare: [], read: [dob]) { status, _ in
            if status == .unnecessary {
                DispatchQueue.main.async {
                    if let url = URL(string: "x-apple-health://") { UIApplication.shared.open(url) }
                    call.resolve(["opened": true])
                }
            } else {
                self.store.requestAuthorization(toShare: [], read: [dob]) { _, _ in call.resolve(["opened": false]) }
            }
        }
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        OpenGymGroup.defaults.set(call.getBool("on") ?? false, forKey: AppleHealthPlugin.enabledKey)
        call.resolve()
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: "x-apple-health://") { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    /// Writes the workouts and weigh-ins the page hands over, each on its own: one that HealthKit
    /// refuses (or that HealthWriteCore turns away before HealthKit could raise an exception for it)
    /// never stops the others. Answers { skipped: [id], failed: [id] }: skipped were not valid and
    /// never tried, failed were refused by Apple Health. lib/health-sync.js keeps both as written,
    /// so a bad record stored long ago is not tried again at every launch, only once it changes.
    @objc func write(_ call: CAPPluginCall) {
        let sessions = (call.getArray("sessions") as? [[String: Any]]) ?? []
        let weights = (call.getArray("weights") as? [[String: Any]]) ?? []
        Task {
            do {
                guard self.granted else { throw HKError(.errorAuthorizationDenied) }
                var skipped: [String] = [], failed: [String] = []
                for s in sessions {
                    let id = (s["id"] as? String) ?? ""
                    do {
                        let written = try await self.saveSession(s)
                        if !written { skipped.append(id) }
                    } catch {
                        // The permission taken back halfway: the whole sync stops, as before.
                        if let hk = error as? HKError, hk.code == .errorAuthorizationDenied || hk.code == .errorAuthorizationNotDetermined { throw error }
                        failed.append(id)
                    }
                }
                if self.store.authorizationStatus(for: self.bodyMass) == .sharingAuthorized {
                    var samples: [(String, HKQuantitySample)] = []
                    for w in weights {
                        if let sample = self.weightSample(w) { samples.append(((w["id"] as? String) ?? "", sample)) } else { skipped.append((w["id"] as? String) ?? "") }
                    }
                    if !samples.isEmpty {
                        do {
                            try await self.store.save(samples.map { $0.1 })
                        } catch {
                            // One of them refused: each on its own, so the rest still go in.
                            for (id, sample) in samples {
                                do { try await self.store.save(sample) } catch { failed.append(id) }
                            }
                        }
                    }
                }
                call.resolve(["skipped": skipped.filter { !$0.isEmpty }, "failed": failed.filter { !$0.isEmpty }])
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        let sessions = (call.getArray("sessions") as? [String]) ?? []
        let weights = (call.getArray("weights") as? [String]) ?? []
        Task {
            do {
                var left: [String] = []
                if !sessions.isEmpty { left += try await self.delete(HKObjectType.workoutType(), ids: sessions) }
                // Their estimated calories (#724): only ever ours, so nothing is reported left.
                if !sessions.isEmpty, self.caloriesGranted, let kcal = self.activeEnergy {
                    _ = try? await self.delete(kcal, ids: sessions.map { $0 + "-kcal" })
                }
                if !weights.isEmpty { left += try await self.delete(self.bodyMass, ids: weights) }
                call.resolve(["left": left])
            } catch {
                self.fail(call, error)
            }
        }
    }

    @objc func readHeartRate(_ call: CAPPluginCall) {
        guard let from = call.getDouble("from"), let to = call.getDouble("to"), to > from,
              let type = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            call.reject("from and to are needed", "failed")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: Date(timeIntervalSince1970: from / 1000), end: Date(timeIntervalSince1970: to / 1000))
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        query(type, predicate) { found in
            let all = found.compactMap { $0 as? HKQuantitySample }.map {
                HealthReadCore.HeartSample(ms: $0.startDate.timeIntervalSince1970 * 1000, bpm: $0.quantity.doubleValue(for: perMinute))
            }
            let origins = Array(Set(found.map { $0.sourceRevision.source.bundleIdentifier }))
            call.resolve(["samples": HealthReadCore.samples(all, from: from, to: to), "origins": origins])
        } failed: { self.fail(call, $0) }
    }

    @objc func readWeights(_ call: CAPPluginCall) {
        guard let since = call.getDouble("since") else { call.reject("since is needed", "failed"); return }
        let predicate = HKQuery.predicateForSamples(withStart: Date(timeIntervalSince1970: since / 1000), end: nil)
        query(bodyMass, predicate) { found in
            let all = found.compactMap { $0 as? HKQuantitySample }.map {
                HealthReadCore.WeighIn(ms: $0.startDate.timeIntervalSince1970 * 1000, kg: $0.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                                       id: $0.uuid.uuidString, source: $0.sourceRevision.source.bundleIdentifier,
                                       syncId: $0.metadata?[HKMetadataKeySyncIdentifier] as? String)
            }
            call.resolve(["records": HealthReadCore.weights(all)])
        } failed: { self.fail(call, $0) }
    }

    /// Body fat (in percent) and lean body mass (kg) since `since`, as { kind, t, v, id, origin, clientId }
    /// (lib/health-read.js mergeBodyComp). Not allowed reads nothing, as Apple Health keeps that private.
    @objc func readBody(_ call: CAPPluginCall) {
        guard let since = call.getDouble("since") else { call.reject("since is needed", "failed"); return }
        guard let fat = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage),
              let lean = HKQuantityType.quantityType(forIdentifier: .leanBodyMass) else {
            call.resolve(["records": [[String: Any]]()])
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: Date(timeIntervalSince1970: since / 1000), end: nil)
        let row: (String, HKQuantitySample, Double) -> [String: Any] = { kind, sample, value in
            var r: [String: Any] = [
                "kind": kind, "t": sample.startDate.timeIntervalSince1970 * 1000, "v": value,
                "id": sample.uuid.uuidString, "origin": sample.sourceRevision.source.bundleIdentifier,
            ]
            if let sync = sample.metadata?[HKMetadataKeySyncIdentifier] as? String { r["clientId"] = sync }
            return r
        }
        query(fat, predicate) { fats in
            let fatRows = fats.compactMap { $0 as? HKQuantitySample }.map { row("fat", $0, $0.quantity.doubleValue(for: .percent()) * 100) }
            self.query(lean, predicate) { leans in
                let leanRows = leans.compactMap { $0 as? HKQuantitySample }.map { row("lean", $0, $0.quantity.doubleValue(for: .gramUnit(with: .kilo))) }
                call.resolve(["records": fatRows + leanRows])
            } failed: { self.fail(call, $0) }
        } failed: { self.fail(call, $0) }
    }

    /// Vitals from local midnight of `from` ('YYYY-MM-DD') on, as lib/vitals.js reads them: sleep
    /// stretches (from the noon before, so the first night is whole; asleep 0, awake 1, only in bed 2),
    /// resting heart rate and HRV (SDNN, ms) samples, and the steps per local day as Apple Health
    /// totals them (HKStatisticsCollectionQuery, which leaves out the iPhone and Watch counting the
    /// same walk twice). Not allowed reads nothing, as everywhere else here.
    @objc func readVitals(_ call: CAPPluginCall) {
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = TimeZone.current
        fmt.dateFormat = "yyyy-MM-dd"
        guard let from = call.getString("from"), let day = fmt.date(from: from) else { call.reject("from is needed", "failed"); return }
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is not available", "unavailable"); return }
        let start = Calendar.current.startOfDay(for: day)
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil)
        let nights = HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-12 * 3600), end: nil)
        Task {
            var sleepRows: [[String: Any]] = []
            if let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
                let found = await self.samples(type, nights)
                for case let c as HKCategorySample in found {
                    let a: Int
                    switch c.value {
                    case HKCategoryValueSleepAnalysis.inBed.rawValue: a = 2
                    case HKCategoryValueSleepAnalysis.awake.rawValue: a = 1
                    default: a = 0
                    }
                    sleepRows.append(["s": c.startDate.timeIntervalSince1970 * 1000, "e": c.endDate.timeIntervalSince1970 * 1000, "a": a])
                }
            }
            let perMinute = HKUnit.count().unitDivided(by: .minute())
            let rhr = await self.points(.restingHeartRate, perMinute, predicate)
            let hrv = await self.points(.heartRateVariabilitySDNN, .secondUnit(with: .milli), predicate)
            let steps = await self.dailySteps(from: start, fmt: fmt)
            call.resolve(["sleep": sleepRows, "rhr": rhr, "hrv": hrv, "steps": steps, "hrvKind": "sdnn"])
        }
    }

    /// Workouts since `since` (ms), or in [since, until] when `until` is passed, from any app,
    /// openGym's own included (JS skips those by origin, lib/activities.js isOwnRecord), as
    /// { id, sport, start, end, km?, kcal?, elev?, speedAvg?, speedMax?, steps?, floors?, hrAvg?,
    ///   hrMin?, hrMax?, laps?, title?, sourceName?, origin, clientId? }. Not allowed reads nothing.
    @objc func readWorkouts(_ call: CAPPluginCall) {
        guard let since = call.getDouble("since") else { call.reject("since is needed", "failed"); return }
        let until = call.getDouble("until").flatMap { $0 > since ? Date(timeIntervalSince1970: $0 / 1000) : nil }
        let details = call.getBool("details") ?? false
        let sportsFilter = Set((call.getArray("sports") as? [String]) ?? [])
        let predicate = HKQuery.predicateForSamples(withStart: Date(timeIntervalSince1970: since / 1000), end: until)
        query(HKObjectType.workoutType(), predicate) { found in
            let workouts = found.compactMap { $0 as? HKWorkout }.filter { w in
                sportsFilter.isEmpty || sportsFilter.contains(AppleHealthPlugin.sportName(w.workoutActivityType))
            }
            let baseRow: (HKWorkout) -> [String: Any] = { w in
                var r: [String: Any] = [
                    "id": w.uuid.uuidString, "sport": AppleHealthPlugin.sportName(w.workoutActivityType),
                    "start": w.startDate.timeIntervalSince1970 * 1000, "end": w.endDate.timeIntervalSince1970 * 1000,
                    "origin": w.sourceRevision.source.bundleIdentifier,
                ]
                let sourceName = w.sourceRevision.source.name.trimmingCharacters(in: .whitespacesAndNewlines)
                if !sourceName.isEmpty { r["sourceName"] = sourceName }
                if let km = w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo)), km > 0 { r["km"] = km }
                if let kcal = self.workoutKcal(w), kcal > 0 { r["kcal"] = kcal.rounded() }
                if let elev = (w.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity)?.doubleValue(for: .meter()), elev > 0 {
                    r["elev"] = elev.rounded()
                }
                let mps = HKUnit.meter().unitDivided(by: .second())
                if let avgMps = (w.metadata?[HKMetadataKeyAverageSpeed] as? HKQuantity)?.doubleValue(for: mps), avgMps > 0 {
                    r["speedAvg"] = avgMps * 3.6
                }
                if let maxMps = (w.metadata?[HKMetadataKeyMaximumSpeed] as? HKQuantity)?.doubleValue(for: mps), maxMps > 0 {
                    r["speedMax"] = maxMps * 3.6
                }
                if let title = (w.metadata?["OpenGymTitle"] as? String) ?? (w.metadata?[HKMetadataKeyWorkoutBrandName] as? String), !title.isEmpty {
                    r["title"] = title
                }
                if let sync = w.metadata?[HKMetadataKeySyncIdentifier] as? String { r["clientId"] = sync }
                return r
            }
            guard details else {
                call.resolve(["records": workouts.map(baseRow)])
                return
            }
            Task {
                var rows: [[String: Any]] = []
                for w in workouts {
                    var r = baseRow(w)
                    let own = HealthReadCore.isOwn(source: w.sourceRevision.source.bundleIdentifier, syncId: w.metadata?[HKMetadataKeySyncIdentifier] as? String)
                    if !own {
                        let laps = self.workoutLaps(w)
                        if !laps.isEmpty { r["laps"] = laps }
                        async let steps = self.sessionSum(.stepCount, from: w.startDate, to: w.endDate)
                        async let floors = self.sessionSum(.flightsClimbed, from: w.startDate, to: w.endDate)
                        async let hr = self.sessionHeartRate(from: w.startDate, to: w.endDate)
                        async let spd = self.sessionWalkingSpeed(from: w.startDate, to: w.endDate)
                        if let st = await steps, st > 0 { r["steps"] = st }
                        if let fl = await floors, fl > 0 { r["floors"] = fl }
                        let h = await hr
                        if let avg = h.avg { r["hrAvg"] = avg }
                        if let min = h.min { r["hrMin"] = min }
                        if let max = h.max { r["hrMax"] = max }
                        let s = await spd
                        if r["speedAvg"] == nil, let avg = s.avg { r["speedAvg"] = avg }
                        if r["speedMax"] == nil, let max = s.max { r["speedMax"] = max }
                    }
                    rows.append(r)
                }
                call.resolve(["records": rows])
            }
        } failed: { self.fail(call, $0) }
    }

    private func workoutKcal(_ w: HKWorkout) -> Double? {
        if #available(iOS 16.0, *), let kcalType = activeEnergy,
           let sum = w.statistics(for: kcalType)?.sumQuantity()?.doubleValue(for: .kilocalorie()), sum > 0 {
            return sum
        }
        if let legacy = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()), legacy > 0 { return legacy }
        return nil
    }

    private func workoutLaps(_ w: HKWorkout) -> [[String: Any]] {
        guard let events = w.workoutEvents else { return [] }
        var out: [[String: Any]] = []
        for ev in events where ev.type == .lap || ev.type == .segment {
            let sec = Int(ev.dateInterval.duration.rounded())
            if sec >= 1 { out.append(["sec": sec]) }
            if out.count >= 50 { break }
        }
        return out
    }

    private func sessionSum(_ id: HKQuantityTypeIdentifier, from start: Date, to end: Date) async -> Int? {
        guard end > start, let type = HKQuantityType.quantityType(forIdentifier: id) else { return nil }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate, .strictEndDate])
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: .cumulativeSum) { _, stat, _ in
                let n = stat?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                cont.resume(returning: n > 0 ? Int(n.rounded()) : nil)
            }
            store.execute(q)
        }
    }

    private func sessionHeartRate(from start: Date, to end: Date) async -> (avg: Int?, min: Int?, max: Int?) {
        guard end > start, let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return (nil, nil, nil) }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate, .strictEndDate])
        let perMinute = HKUnit.count().unitDivided(by: .minute())
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: [.discreteAverage, .discreteMin, .discreteMax]) { _, stat, _ in
                let clean: (Double?) -> Int? = { $0.flatMap { HealthReadCore.bpmRange.contains($0.rounded()) ? Int($0.rounded()) : nil } }
                let avg = clean(stat?.averageQuantity()?.doubleValue(for: perMinute))
                let min = clean(stat?.minimumQuantity()?.doubleValue(for: perMinute))
                let max = clean(stat?.maximumQuantity()?.doubleValue(for: perMinute))
                cont.resume(returning: (avg, min, max))
            }
            store.execute(q)
        }
    }

    private func sessionWalkingSpeed(from start: Date, to end: Date) async -> (avg: Double?, max: Double?) {
        guard end > start, let type = HKQuantityType.quantityType(forIdentifier: .walkingSpeed) else { return (nil, nil) }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate, .strictEndDate])
        let mps = HKUnit.meter().unitDivided(by: .second())
        return await withCheckedContinuation { cont in
            let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: pred, options: [.discreteAverage, .discreteMax]) { _, stat, _ in
                let kmh: (Double?) -> Double? = { $0.flatMap { $0 > 0 ? $0 * 3.6 : nil } }
                let avg = kmh(stat?.averageQuantity()?.doubleValue(for: mps))
                let max = kmh(stat?.maximumQuantity()?.doubleValue(for: mps))
                cont.resume(returning: (avg, max))
            }
            store.execute(q)
        }
    }

    /// Apple Health's activity types to lib/activities.js SPORTS, plus 'strength', 'gym' (machines,
    /// HIIT, classes), 'walk' and 'stretch', which JS keeps out of the activities ('walk' and
    /// 'stretch' are offered inside Log recovery instead). Anything else is 'other'.
    static func sportName(_ type: HKWorkoutActivityType) -> String {
        HealthReadCore.sportName(type)
    }

    /// Every sample of `type` matching `predicate`, or none when reading is not allowed or fails.
    private func samples(_ type: HKSampleType, _ predicate: NSPredicate) async -> [HKSample] {
        await withCheckedContinuation { cont in
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HealthReadCore.maxSamples, sortDescriptors: [sort]) { _, found, _ in
                cont.resume(returning: found ?? [])
            }
            store.execute(q)
        }
    }

    private func points(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, _ predicate: NSPredicate) async -> [[String: Any]] {
        guard let type = HKObjectType.quantityType(forIdentifier: id) else { return [] }
        return await samples(type, predicate).compactMap { $0 as? HKQuantitySample }.map {
            ["t": $0.startDate.timeIntervalSince1970 * 1000, "v": $0.quantity.doubleValue(for: unit)]
        }
    }

    private func dailySteps(from start: Date, fmt: DateFormatter) async -> [[String: Any]] {
        guard let type = HKObjectType.quantityType(forIdentifier: .stepCount) else { return [] }
        return await withCheckedContinuation { cont in
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: nil),
                                                options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, results, _ in
                var rows: [[String: Any]] = []
                results?.enumerateStatistics(from: start, to: Date()) { stat, _ in
                    let n = stat.sumQuantity()?.doubleValue(for: .count()) ?? 0
                    if n > 0 { rows.append(["d": fmt.string(from: stat.startDate), "n": n.rounded()]) }
                }
                cont.resume(returning: rows)
            }
            store.execute(q)
        }
    }

    /// Every sample of `type` matching `predicate`, oldest first.
    private func query(_ type: HKSampleType, _ predicate: NSPredicate, done: @escaping ([HKSample]) -> Void, failed: @escaping (Error) -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else { failed(HKError(.errorHealthDataUnavailable)); return }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HealthReadCore.maxSamples, sortDescriptors: [sort]) { _, found, error in
            // Reading not allowed answers with no samples rather than an error; a real error is passed on.
            if let error = error, (error as? HKError)?.code != .errorAuthorizationDenied { failed(error) } else { done(found ?? []) }
        }
        store.execute(q)
    }

    private func fail(_ call: CAPPluginCall, _ error: Error) {
        if let hk = error as? HKError, hk.code == .errorAuthorizationDenied || hk.code == .errorAuthorizationNotDetermined {
            call.reject("Apple Health permission not granted", "permission")
        } else if !HKHealthStore.isHealthDataAvailable() {
            call.reject("Apple Health is not available", "unavailable")
        } else {
            call.reject(error.localizedDescription, "failed")
        }
    }

    /// Each write a newer version than the last, so Apple Health replaces the one it has.
    private func syncMetadata(_ id: String) -> [String: Any] {
        [HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: NSNumber(value: Int64(Date().timeIntervalSince1970 * 1000))]
    }

    /// lib/health-connect.js SESSION_TYPES; also the watch's workout type (WatchBridgePlugin).
    static let activityTypes: [String: HKWorkoutActivityType] = [
        "strength_training": .traditionalStrengthTraining, "walking": .walking, "running": .running,
        "biking_stationary": .cycling, "biking": .cycling, "elliptical": .elliptical, "stair_climbing_machine": .stairClimbing,
        "rowing": .rowing, "jump_rope": .jumpRope, "hiit": .highIntensityIntervalTraining, "mixed_cardio": .mixedCardio,
        "yoga": .yoga, "flexibility": .flexibility, "other_workout": .other,
    ]

    /// One workout into Apple Health; false when it was not valid and left out (HealthWriteCore).
    /// A workout longer than a day goes in with its real start and end but without calories, one
    /// longer than a week not at all (the same as Health Connect, lib/health-connect.js).
    private func saveSession(_ s: [String: Any]) async throws -> Bool {
        let id = s["id"] as? String
        let startMs = (s["start"] as? NSNumber)?.doubleValue, endMs = (s["end"] as? NSNumber)?.doubleValue
        let now = Date().timeIntervalSince1970 * 1000
        guard case .write(let energyOk) = HealthWriteCore.session(id: id, start: startMs, end: endMs, now: now),
              let id = id, let startMs = startMs, let endMs = endMs else { return false }
        let start = Date(timeIntervalSince1970: startMs / 1000), end = Date(timeIntervalSince1970: endMs / 1000)
        // A workout type with a limit of its own (none today): HealthKit would raise at the finish.
        guard AppleHealthPlugin.fits(HKObjectType.workoutType(), from: start, to: end, cap: false) else { return false }
        if try await watchSaved(id) {
            // The watch saved this workout, but with no energy at all (TestFlight 11-04: "Active
            // and Total Energy always 0 kcal"; a watch that never got the calories permission, or
            // a session paused through the rests). The phone's estimate fills in as a sample of
            // its own over the same stretch, with the same checks as a workout the phone saves.
            // A watch (or any other source) that measured something keeps it: nothing counts twice.
            if energyOk, caloriesGranted, let type = activeEnergy,
               let estimate = HealthWriteCore.kcal((s["kcal"] as? NSNumber)?.doubleValue),
               AppleHealthPlugin.fits(type, from: start, to: end),
               await measuredEnergy(type, from: start, to: end) == nil {
                var kmeta = syncMetadata(id + "-kcal")
                kmeta["OpenGymEstimate"] = true
                let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: estimate),
                                              start: start, end: end, device: .local(), metadata: kmeta)
                try? await store.save(sample)
            }
            return true
        }
        // The iPhone's own workout session (AirPods heart rate, #818) saved this one live, with its
        // heart rate: left as it is, like the watch's copy.
        if await PhoneWorkoutLedger.handled(id) { return true }
        let config = HKWorkoutConfiguration()
        config.activityType = AppleHealthPlugin.activityTypes[(s["type"] as? String) ?? ""] ?? .other
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        try await builder.beginCollection(at: start)
        var meta = syncMetadata(id)
        if let title = s["title"] as? String, !title.isEmpty { meta["OpenGymTitle"] = String(title.prefix(1000)) }
        try await builder.addMetadata(meta)
        // The estimated active energy, with a sync identifier of its own so a rewrite replaces it
        // too. The Apple Watch measures its own; this is for a workout the phone logged.
        if energyOk, let estimate = HealthWriteCore.kcal((s["kcal"] as? NSNumber)?.doubleValue), caloriesGranted, let type = activeEnergy,
           AppleHealthPlugin.fits(type, from: start, to: end) {
            // A watch worn while the phone logged (any that saves to Apple Health) measured the
            // real thing: that goes on the workout instead (idea from #434). Apple Health's own
            // totals take one source per stretch of time, so nothing counts twice.
            let measured = await measuredEnergy(type, from: start, to: end)
            // HealthKit raises an Objective-C exception, which Swift cannot catch, for a value it
            // won't take: that killed the app at every launch (TestFlight 59). Checked first instead.
            if let kcal = HealthWriteCore.kcal(measured ?? estimate) {
                var kmeta = syncMetadata(id + "-kcal")
                kmeta["OpenGymEstimate"] = measured == nil
                let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                                              start: start, end: end, device: .local(), metadata: kmeta)
                try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                    builder.add([sample]) { _, error in
                        if let error = error { cont.resume(throwing: error) } else { cont.resume() }
                    }
                }
            }
        }
        try await builder.endCollection(at: end)
        _ = try await builder.finishWorkout()
        return true
    }

    /// Active energy other sources saved inside this stretch of time (kcal), or nil without any,
    /// or when reading it is not allowed (Apple Health then simply answers nothing).
    private func measuredEnergy(_ type: HKQuantityType, from start: Date, to end: Date) async -> Double? {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate, .strictEndDate])
        let found: [HKSample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, found, _ in
                cont.resume(returning: found ?? [])
            }
            store.execute(q)
        }
        let me = Bundle.main.bundleIdentifier ?? ""
        let total = found.compactMap { $0 as? HKQuantitySample }
            .filter { $0.sourceRevision.source.bundleIdentifier != me }
            .reduce(0.0) { $0 + $1.quantity.doubleValue(for: .kilocalorie()) }
        return total > 0 ? total.rounded() : nil
    }

    /// Whether another app of ours (the Apple Watch app) saved this session already.
    private func watchSaved(_ id: String) async throws -> Bool {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [id])
        let samples: [HKSample] = try await withCheckedThrowingContinuation { cont in
            let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 5, sortDescriptors: nil) { _, found, error in
                // Not allowed to read workouts: nothing to compare with, the write goes ahead.
                if error != nil { cont.resume(returning: []) } else { cont.resume(returning: found ?? []) }
            }
            store.execute(q)
        }
        let me = Bundle.main.bundleIdentifier ?? ""
        return samples.contains { $0.sourceRevision.source.bundleIdentifier != me }
    }

    /// Whether HealthKit takes a sample of this type over this stretch: an end before the start, or
    /// a stretch longer (or shorter) than the type allows, is an uncatchable exception at creation.
    /// With `cap`, a day at most (HealthWriteCore.energySpanMs: calories of a forgotten workout),
    /// and nothing before 2001, HealthKit's epoch.
    static func fits(_ type: HKSampleType, from start: Date, to end: Date, cap: Bool = true) -> Bool {
        let d = end.timeIntervalSince(start)
        guard start.timeIntervalSinceReferenceDate.isFinite, start.timeIntervalSinceReferenceDate >= 0 else { return false }
        if cap && !(d <= HealthWriteCore.energySpanMs / 1000) { return false }
        return HealthWriteCore.spanFits(d, min: type.isMinimumDurationRestricted ? type.minimumAllowedDuration : nil,
                                        max: type.isMaximumDurationRestricted ? type.maximumAllowedDuration : nil)
    }

    private func weightSample(_ w: [String: Any]) -> HKQuantitySample? {
        let id = w["id"] as? String, time = (w["time"] as? NSNumber)?.doubleValue, kg = (w["kg"] as? NSNumber)?.doubleValue
        guard HealthWriteCore.weight(id: id, time: time, kg: kg, now: Date().timeIntervalSince1970 * 1000),
              let id = id, let time = time, let kg = kg else { return nil }
        let at = Date(timeIntervalSince1970: time / 1000)
        guard AppleHealthPlugin.fits(bodyMass, from: at, to: at) else { return nil }
        return HKQuantitySample(type: bodyMass, quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg),
                                start: at, end: at, metadata: syncMetadata(id))
    }

    /// Deletes every sample with one of these sync identifiers, the Apple Watch app's copy of a
    /// workout included, and answers the ids Apple Health still holds afterwards (one it would not
    /// let this app delete), so the next sync tries them again instead of forgetting them.
    private func delete(_ type: HKObjectType, ids: [String]) async throws -> [String] {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: ids)
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            store.deleteObjects(of: type, predicate: predicate) { _, _, error in
                if let error = error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
        guard let sampleType = type as? HKSampleType else { return [] }
        let still: [HKSample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: sampleType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, found, error in
                // Not allowed to read: nothing to check against, the delete above is all there is.
                cont.resume(returning: error == nil ? (found ?? []) : [])
            }
            store.execute(q)
        }
        return Array(Set(still.compactMap { $0.metadata?[HKMetadataKeySyncIdentifier] as? String }))
    }
}
