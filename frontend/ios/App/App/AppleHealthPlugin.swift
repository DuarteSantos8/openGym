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
 * the session twice. Removing takes that copy out too, and says which ids Apple Health still holds
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

    private var shareTypes: Set<HKSampleType> { [HKObjectType.workoutType(), bodyMass] }
    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType(), bodyMass]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
        return types
    }

    /// Saving workouts is what the switch is about; weigh-ins follow when allowed too.
    private var granted: Bool { store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized }

    @objc func status(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "unsupported", "granted": false])
            return
        }
        call.resolve(["status": "available", "granted": granted])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.resolve(["granted": false]); return }
        // { read: ['heartRate' | 'weight'], write: [...] } asks for just those reads (the switches
        // added in v1.4.3); without them, everything, as before.
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
        if try await watchSaved(id) { return }
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
        _ = try await builder.finishWorkout()
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
