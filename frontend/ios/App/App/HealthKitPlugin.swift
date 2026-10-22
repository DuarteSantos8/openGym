import Foundation
import Capacitor
import HealthKit
import UIKit
import os

/**
 * Writes finished workouts and weigh-ins to Apple Health, the iOS twin of the Android app's
 * HealthConnectPlugin.java: the same five methods, the same plain objects in, the same error
 * codes out, plus readHeartRate, which only iOS has: the watch's heart rate for a workout's
 * window. Off until the user turns it on in Settings; nothing is asked of HealthKit before that.
 * What to write is worked out in JS (lib/health-connect.js).
 *
 * Every object carries openGym's own id as HKMetadataKeyExternalUUID. HealthKit has no
 * replace-by-id, so writing a record again first deletes what this app saved under that id; an
 * object with that id from another source (the watch app) is left alone and not written over.
 *
 * HealthKit never says whether the user allowed writing (a denial looks like a grant), so
 * `granted` only means the request was made once; a denial shows up as a refused save.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthKit');
 *   await HC.status();              // { status: 'available' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted }
 *   await HC.write({ sessions: [{ id, start, end, type, title, notes }], weights: [{ id, time, kg }] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.readHeartRate({ start, end }); // { samples: [{ t: ms, bpm }] }, any source, iOS only
 *   await HC.openSettings();        // the app's page in Settings, or { target: 'health' } for Health
 */
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin {

    private static let requestedKey = "opengym.healthkit.requested"
    private static let titleKey = "ch.duartesantos.opengym.title"
    private static let notesKey = "ch.duartesantos.opengym.notes"

    private let store = HKHealthStore()
    // One write or remove at a time; the HealthKit callbacks are waited for on this queue.
    private let queue = DispatchQueue(label: "ch.duartesantos.opengym.healthkit")
    private let log = Logger(subsystem: "ch.duartesantos.opengym", category: "HealthKit")

    private enum PluginError: Error {
        case unavailable
    }

    private let bodyMass = HKQuantityType(.bodyMass)
    private let heartRate = HKQuantityType(.heartRate)

    /** The session types of lib/health-connect.js (HK_ACTIVITY) as HealthKit activities. */
    static func activityType(for type: String) -> HKWorkoutActivityType {
        switch type {
        case "strength_training": return .traditionalStrengthTraining
        case "walking": return .walking
        case "running": return .running
        case "biking_stationary": return .cycling
        case "elliptical": return .elliptical
        case "stair_climbing_machine": return .stairClimbing
        default: return .other
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve([
            "status": HKHealthStore.isHealthDataAvailable() ? "available" : "unsupported",
            "granted": UserDefaults.standard.bool(forKey: Self.requestedKey),
        ])
    }

    // CAPPlugin declares this one (for its permission helpers); the contract is the same.
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        let share: Set<HKSampleType> = [HKObjectType.workoutType(), bodyMass]
        // Heart rate is read by the workout screen later on; asked now so the user is asked once.
        // Workouts and body mass are read too: without read access a query only returns this
        // app's own objects, and clearOwn could not tell that the watch app already saved one.
        let read: Set<HKObjectType> = [heartRate, HKObjectType.workoutType(), bodyMass]
        store.requestAuthorization(toShare: share, read: read) { [log] _, error in
            if let error = error {
                log.error("HealthKit authorization failed: \(error.localizedDescription, privacy: .public)")
                call.reject(error.localizedDescription, "permission", error)
                return
            }
            UserDefaults.standard.set(true, forKey: Self.requestedKey)
            call.resolve(["granted": true])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        let sessions = call.getArray("sessions", JSObject.self) ?? []
        let weights = call.getArray("weights", JSObject.self) ?? []
        queue.async {
            do {
                try self.ensureAvailable()
                for s in sessions {
                    guard let id = s["id"] as? String,
                          let start = Self.date(s["start"]), let end = Self.date(s["end"]), end > start else { continue }
                    let activity = Self.activityType(for: s["type"] as? String ?? "")
                    var metadata: [String: Any] = [
                        HKMetadataKeyExternalUUID: id,
                        HKMetadataKeyWorkoutBrandName: "openGym",
                    ]
                    if let title = s["title"] as? String, !title.isEmpty { metadata[Self.titleKey] = title }
                    if let notes = s["notes"] as? String, !notes.isEmpty { metadata[Self.notesKey] = notes }
                    if try self.clearOwn(HKObjectType.workoutType(), id: id) {
                        try self.saveWorkout(activity, start: start, end: end, metadata: metadata)
                    }
                }
                for w in weights {
                    guard let id = w["id"] as? String, let time = Self.date(w["time"]),
                          let kg = (w["kg"] as? NSNumber)?.doubleValue, kg > 0 else { continue }
                    if try self.clearOwn(self.bodyMass, id: id) {
                        let sample = HKQuantitySample(type: self.bodyMass,
                                                      quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg),
                                                      start: time, end: time,
                                                      metadata: [HKMetadataKeyExternalUUID: id])
                        try self.wait { done in self.store.save(sample) { _, error in done(error) } }
                    }
                }
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        let sessions = call.getArray("sessions", String.self) ?? []
        let weights = call.getArray("weights", String.self) ?? []
        queue.async {
            do {
                try self.ensureAvailable()
                for id in sessions { _ = try self.clearOwn(HKObjectType.workoutType(), id: id) }
                for id in weights { _ = try self.clearOwn(self.bodyMass, id: id) }
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    /** Heart-rate samples in [start, end] from any source (the watch), oldest first, in bpm. */
    @objc func readHeartRate(_ call: CAPPluginCall) {
        guard let start = Self.date(call.getDouble("start").map { NSNumber(value: $0) }),
              let end = Self.date(call.getDouble("end").map { NSNumber(value: $0) }), end > start else {
            call.reject("start and end are required", "failed")
            return
        }
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let query = HKSampleQuery(sampleType: heartRate, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: [sort]) { [weak self] _, samples, error in
            if let error = error {
                self?.reject(call, error)
                return
            }
            let out: [JSObject] = (samples as? [HKQuantitySample] ?? []).map { s in
                ["t": s.startDate.timeIntervalSince1970 * 1000, "bpm": s.quantity.doubleValue(for: bpm)]
            }
            call.resolve(["samples": out])
        }
        store.execute(query)
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        // There is no public link to Health's sharing screen: the app's own page in Settings, or
        // the Health app when asked for it.
        let link = call.getString("target") == "health" ? "x-apple-health://" : UIApplication.openSettingsURLString
        DispatchQueue.main.async {
            guard let url = URL(string: link) else {
                call.reject("Cannot open \(link)", "failed")
                return
            }
            UIApplication.shared.open(url) { _ in call.resolve() }
        }
    }

    // MARK: - On the queue

    private func ensureAvailable() throws {
        if !HKHealthStore.isHealthDataAvailable() { throw PluginError.unavailable }
    }

    /**
     * Deletes what this app saved under `id`. Returns false when another source has an object with
     * that id: the record is that source's, and openGym does not write it again.
     */
    private func clearOwn(_ type: HKSampleType, id: String) throws -> Bool {
        let found = try objects(type, id: id)
        let own = HKSource.default().bundleIdentifier
        let mine = found.filter { $0.sourceRevision.source.bundleIdentifier == own }
        if !mine.isEmpty {
            try wait { done in self.store.delete(mine) { _, error in done(error) } }
        }
        if mine.count < found.count {
            log.info("Skipped \(id, privacy: .public): written by another source")
            return false
        }
        return true
    }

    private func objects(_ type: HKSampleType, id: String) throws -> [HKSample] {
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, allowedValues: [id])
        var out: [HKSample] = []
        try wait { done in
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit,
                                      sortDescriptors: nil) { _, samples, error in
                out = samples ?? []
                done(error)
            }
            self.store.execute(query)
        }
        return out
    }

    private func saveWorkout(_ activity: HKWorkoutActivityType, start: Date, end: Date, metadata: [String: Any]) throws {
        if #available(iOS 17.0, *) {
            let config = HKWorkoutConfiguration()
            config.activityType = activity
            let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
            try wait { done in builder.beginCollection(withStart: start) { _, error in done(error) } }
            try wait { done in builder.addMetadata(metadata) { _, error in done(error) } }
            try wait { done in builder.endCollection(withEnd: end) { _, error in done(error) } }
            try wait { done in builder.finishWorkout { _, error in done(error) } }
        } else {
            let workout = HKWorkout(activityType: activity, start: start, end: end, duration: end.timeIntervalSince(start),
                                    totalEnergyBurned: nil, totalDistance: nil, metadata: metadata)
            try wait { done in self.store.save(workout) { _, error in done(error) } }
        }
    }

    /** Runs one HealthKit call and blocks the queue until its completion handler answers. */
    private func wait(_ body: (@escaping (Error?) -> Void) -> Void) throws {
        let sem = DispatchSemaphore(value: 0)
        var failure: Error?
        body { error in
            failure = error
            sem.signal()
        }
        sem.wait()
        if let failure = failure { throw failure }
    }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        if case PluginError.unavailable = error {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        let code: String
        switch (error as? HKError)?.code {
        case .errorAuthorizationDenied?, .errorAuthorizationNotDetermined?: code = "permission"
        case .errorHealthDataUnavailable?, .errorHealthDataRestricted?: code = "unavailable"
        default: code = "failed"
        }
        log.error("HealthKit \(code, privacy: .public): \(error.localizedDescription, privacy: .public)")
        call.reject(error.localizedDescription, code, error)
    }

    private static func date(_ value: Any?) -> Date? {
        guard let ms = (value as? NSNumber)?.doubleValue, ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }
}
