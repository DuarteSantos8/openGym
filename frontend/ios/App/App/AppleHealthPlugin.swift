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
    ]

    static let enabledKey = "healthEnabled"
    private let store = HKHealthStore()
    private var bodyMass: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyMass)! }

    private var shareTypes: Set<HKSampleType> {
        var types: Set<HKSampleType> = [HKObjectType.workoutType(), bodyMass]
        if #available(iOS 18.0, *) { types.insert(HKQuantityType(.workoutEffortScore)) }
        return types
    }
    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType(), bodyMass]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
        if #available(iOS 18.0, *) { types.insert(HKQuantityType(.workoutEffortScore)) }
        return types
    }

    /// iOS 18 and later: a workout can carry its effort (lib/workout-effort.js).
    private var effortSupported: Bool { if #available(iOS 18.0, *) { return true } else { return false } }
    private var effortGranted: Bool {
        guard #available(iOS 18.0, *) else { return false }
        return store.authorizationStatus(for: HKQuantityType(.workoutEffortScore)) == .sharingAuthorized
    }

    /// Saving workouts is what the switch is about; weigh-ins follow when allowed too.
    private var granted: Bool { store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized }

    @objc func status(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "unsupported", "granted": false])
            return
        }
        call.resolve(["status": "available", "granted": granted, "effort": effortSupported, "effortGranted": effortGranted])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["granted": false]); return }
        // { read: ['heartRate' | 'weight'], write: [...] } asks for just those reads (the switches
        // added in v1.4.3); without them, everything, as before.
        // { effort: true }: just the workout effort (iOS 18), asked for when it is first rated or
        // set to automatic, so a phone that turned Apple Health on before it is asked once.
        if call.getBool("effort") == true {
            guard #available(iOS 18.0, *) else { call.resolve(["granted": false]); return }
            let type = HKQuantityType(.workoutEffortScore)
            store.requestAuthorization(toShare: [type], read: [type]) { _, _ in call.resolve(["granted": self.effortGranted]) }
            return
        }
        if let read = call.getArray("read") as? [String] {
            var types: Set<HKObjectType> = []
            if read.contains("heartRate"), let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
            if read.contains("weight") { types.insert(bodyMass) }
            store.requestAuthorization(toShare: [], read: types) { _, _ in call.resolve(["granted": self.granted]) }
            return
        }
        store.requestAuthorization(toShare: shareTypes, read: readTypes) { _, _ in
            call.resolve(["granted": self.granted])
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

    @objc func write(_ call: CAPPluginCall) {
        let sessions = (call.getArray("sessions") as? [[String: Any]]) ?? []
        let weights = (call.getArray("weights") as? [[String: Any]]) ?? []
        Task {
            do {
                guard self.granted else { throw HKError(.errorAuthorizationDenied) }
                for s in sessions { try await self.saveSession(s) }
                if self.store.authorizationStatus(for: self.bodyMass) == .sharingAuthorized {
                    let samples = weights.compactMap { self.weightSample($0) }
                    if !samples.isEmpty { try await self.store.save(samples) }
                }
                call.resolve()
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

    private func saveSession(_ s: [String: Any]) async throws {
        guard let id = s["id"] as? String,
              let startMs = (s["start"] as? NSNumber)?.doubleValue, let endMs = (s["end"] as? NSNumber)?.doubleValue, endMs > startMs else { return }
        // The workout's effort, 1 to 10 (lib/workout-effort.js). `effortWatch`: the Apple Watch
        // rated it and linked it to its own copy itself, so it is not linked a second time here.
        let effort = (s["effort"] as? NSNumber)?.intValue
        let watchLinked = (s["effortWatch"] as? Bool) ?? false
        let copies = try await savedCopies(id)
        let me = Bundle.main.bundleIdentifier ?? ""
        if let watchCopy = copies.first(where: { $0.sourceRevision.source.bundleIdentifier != me }) {
            // Apple does not say whether a score may be linked to another app's workout: tried, and
            // left at that when it may not. Rated on the watch, which links it itself: the score
            // this phone linked there before (rated here first) is taken away, not left beside it.
            await setEffort(watchLinked ? nil : effort, on: watchCopy)
            return
        }
        // The iPhone's own workout session (AirPods heart rate, #818) saved this one live, with its
        // heart rate: left as it is, like the watch's copy. Its effort is linked to it all the same.
        // Looked up again once it is saved: the page writes the workout the moment it finishes,
        // while the live session is still saving it, so `copies` above can be empty.
        if await PhoneWorkoutLedger.handled(id) {
            let saved = copies.isEmpty ? try await savedCopies(id) : copies
            if let own = saved.first(where: { $0.sourceRevision.source.bundleIdentifier == me }) { await setEffort(effort, on: own) }
            return
        }
        // Written again (renamed, a set fixed, rated): the copy it replaces takes its score with it.
        for old in copies { await setEffort(nil, on: old) }
        let config = HKWorkoutConfiguration()
        config.activityType = AppleHealthPlugin.activityTypes[(s["type"] as? String) ?? ""] ?? .other
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        let start = Date(timeIntervalSince1970: startMs / 1000), end = Date(timeIntervalSince1970: endMs / 1000)
        try await builder.beginCollection(at: start)
        var meta = syncMetadata(id)
        if let title = s["title"] as? String, !title.isEmpty { meta["OpenGymTitle"] = title }
        try await builder.addMetadata(meta)
        try await builder.endCollection(at: end)
        if let saved = try await builder.finishWorkout() { await setEffort(effort, on: saved) }
    }

    /// The copies of this session already in Apple Health: the Apple Watch app's, the iPhone's own
    /// workout session's, or one this plugin wrote before.
    private func savedCopies(_ id: String) async throws -> [HKWorkout] {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [id])
        let samples: [HKSample] = try await withCheckedThrowingContinuation { cont in
            let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 5, sortDescriptors: nil) { _, found, error in
                // Not allowed to read workouts: nothing to compare with, the write goes ahead.
                if error != nil { cont.resume(returning: []) } else { cont.resume(returning: found ?? []) }
            }
            store.execute(q)
        }
        return samples.compactMap { $0 as? HKWorkout }
    }

    /// The workout's effort in Apple Health (iOS 18): the score this app linked before is taken
    /// away, and `score` linked in its place. nil only takes it away. Quietly nothing on an older
    /// iOS, or while the effort permission is not given: the workout itself is saved either way.
    private func setEffort(_ score: Int?, on workout: HKWorkout) async {
        guard #available(iOS 18.0, *), effortGranted else { return }
        let type = HKQuantityType(.workoutEffortScore)
        let predicate = HKQuery.predicateForWorkoutEffortSamplesRelated(workout: workout, activity: nil)
        let linked: [HKSample] = await withCheckedContinuation { cont in
            let q = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, found, _ in
                cont.resume(returning: found ?? [])
            }
            store.execute(q)
        }
        let me = Bundle.main.bundleIdentifier ?? ""
        let ours = linked.filter { $0.sourceRevision.source.bundleIdentifier == me }
        // Already there as it is: nothing to do (every sync of the workout would otherwise churn it).
        if let score = score, ours.count == 1, let q = ours.first as? HKQuantitySample,
           q.quantity.doubleValue(for: .appleEffortScore()) == Double(score) { return }
        if !ours.isEmpty { _ = try? await store.delete(ours) }
        guard let score = score, (1...10).contains(score) else { return }
        let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .appleEffortScore(), doubleValue: Double(score)),
                                      start: workout.startDate, end: workout.endDate)
        _ = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            store.relateWorkoutEffortSample(sample, with: workout, activity: nil) { ok, _ in cont.resume(returning: ok) }
        }
    }

    private func weightSample(_ w: [String: Any]) -> HKQuantitySample? {
        guard let id = w["id"] as? String, let time = (w["time"] as? NSNumber)?.doubleValue,
              let kg = (w["kg"] as? NSNumber)?.doubleValue, kg > 0 else { return nil }
        let at = Date(timeIntervalSince1970: time / 1000)
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
