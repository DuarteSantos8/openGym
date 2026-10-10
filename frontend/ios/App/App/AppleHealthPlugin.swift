import Foundation
import Capacitor
import HealthKit
import UIKit

/**
 * The iOS side of the health store (lib/health-sync.js): writes finished workouts and weigh-ins
 * to Apple Health, as HealthConnectPlugin.java does to Health Connect on Android. Off until the
 * user turns it on in Settings; nothing is asked of HealthKit before that. What to write is worked
 * out in JS (lib/health-connect.js); this side only turns those plain objects into samples.
 *
 * Every sample carries openGym's own id as its HKMetadataKeySyncIdentifier and the time of the
 * write as its HKMetadataKeySyncVersion: saving it again replaces the stored one, and "remove"
 * finds exactly the samples openGym wrote.
 *
 * HealthKit needs the com.apple.developer.healthkit entitlement, which an app signed with a free
 * Apple ID (Xcode, AltStore, Sideloadly) does not get. The build only asks for it with
 * OPENGYM_HEALTHKIT=YES (project.pbxproj, docs/MOBILE.md), and `status` answers "unsupported"
 * unless the provisioning profile the app was signed with really grants it — so the Settings card
 * stays out of the way on a phone where Apple Health cannot be written to.
 *
 * Usage from JS (lib/health-sync.js):
 *   const AH = registerPlugin('AppleHealth');
 *   await AH.status();              // { status: 'available' | 'unsupported', granted }
 *   await AH.requestPermissions();  // { granted }
 *   await AH.write({ sessions: [...], weights: [...] });
 *   await AH.remove({ sessions: [ids], weights: [ids] });
 *   await AH.readWeights({ anchor }); // { samples: [{ t, kg }], anchor } — weigh-ins from other apps
 *   await AH.openSettings();        // the Health app
 */
@objc(AppleHealthPlugin)
public class AppleHealthPlugin: CAPPlugin {

    private let store = HKHealthStore()
    // Metadata keys of openGym's own; HKWorkout has no title or notes of its own.
    private static let titleKey = "OpenGymTitle"
    private static let notesKey = "OpenGymNotes"

    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }
    private var massType: HKQuantityType { HKQuantityType.quantityType(forIdentifier: .bodyMass)! }

    // One call at a time, in order: a remove queued behind a write must not overtake it.
    private var tail: Task<Void, Never> = Task {}
    private func enqueue(_ work: @escaping () async -> Void) {
        let before = tail
        tail = Task { await before.value; await work() }
    }

    // Whether this copy of the app may use HealthKit at all: built to ask for it (Info.plist
    // OpenGymHealthKit, set from OPENGYM_HEALTHKIT) and signed with a profile that grants it.
    // AltStore and Sideloadly re-sign with the user's Apple ID, and a free one drops the
    // entitlement; the profile they embed says what was really granted. Without a profile (the
    // simulator, a store build) the build setting is all there is to go by.
    static let entitled: Bool = {
        let flag = (Bundle.main.object(forInfoDictionaryKey: "OpenGymHealthKit") as? String ?? "").uppercased()
        guard flag == "YES" else { return false }
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url) else { return true }
        // The profile is a signed CMS envelope around a plain XML plist; the plist is read as is.
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8), in: start.lowerBound..<data.endIndex),
              let plist = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil) as? [String: Any],
              let entitlements = plist["Entitlements"] as? [String: Any] else { return false }
        return (entitlements["com.apple.developer.healthkit"] as? Bool) == true
    }()

    private var usable: Bool { AppleHealthPlugin.entitled && HKHealthStore.isHealthDataAvailable() }

    private var writeGranted: Bool {
        store.authorizationStatus(for: workoutType) == .sharingAuthorized
            && store.authorizationStatus(for: massType) == .sharingAuthorized
    }

    @objc func status(_ call: CAPPluginCall) {
        guard usable else {
            call.resolve(["status": "unsupported", "granted": false])
            return
        }
        call.resolve(["status": "available", "granted": writeGranted])
    }

    // `read: true` also asks to read body weight (Settings → "Take weigh-ins from Apple Health").
    // HealthKit shows its sheet only for what was never answered, and never says whether reading
    // was allowed: `granted` is about writing.
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        guard usable else {
            call.reject("Apple Health is not available", "unavailable")
            return
        }
        let read: Set<HKObjectType> = call.getBool("read", false) ? [massType] : []
        store.requestAuthorization(toShare: [workoutType, massType], read: read) { _, error in
            if let error = error {
                call.reject(error.localizedDescription, "failed")
                return
            }
            call.resolve(["granted": self.writeGranted])
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        guard usable else {
            call.reject("Apple Health is not available", "unavailable")
            return
        }
        let sessions = call.getArray("sessions", JSObject.self) ?? []
        let weights = call.getArray("weights", JSObject.self) ?? []
        enqueue {
            do {
                let version = Int(Date().timeIntervalSince1970 * 1000)
                for s in sessions { try await self.saveWorkout(s, version: version) }
                let samples = weights.compactMap { self.weightSample($0, version: version) }
                if !samples.isEmpty { try await self.save(samples) }
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard usable else {
            call.reject("Apple Health is not available", "unavailable")
            return
        }
        let sessions = (call.getArray("sessions", String.self) ?? [])
        let weights = (call.getArray("weights", String.self) ?? [])
        enqueue {
            do {
                try await self.delete(self.workoutType, ids: sessions)
                try await self.delete(self.massType, ids: weights)
                call.resolve()
            } catch {
                self.reject(call, error)
            }
        }
    }

    // Weigh-ins other apps and scales wrote since `anchor` (all of them without one), for
    // Settings → "Take weigh-ins from Apple Health". What openGym wrote itself is left out, or
    // every weigh-in would come straight back. The anchor goes back to JS as base64 and is kept in
    // opengym-health.json, so each sample is handed over once: a weigh-in deleted in openGym is
    // not brought back by the next read. Without read access HealthKit answers with nothing at all.
    @objc func readWeights(_ call: CAPPluginCall) {
        guard usable else {
            call.reject("Apple Health is not available", "unavailable")
            return
        }
        var anchor: HKQueryAnchor?
        if let b64 = call.getString("anchor"), let data = Data(base64Encoded: b64) {
            anchor = try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
        }
        let own = Bundle.main.bundleIdentifier ?? ""
        let query = HKAnchoredObjectQuery(type: massType, predicate: nil, anchor: anchor, limit: HKObjectQueryNoLimit) { _, samples, _, next, error in
            if let error = error {
                self.reject(call, error)
                return
            }
            let kg = HKUnit.gramUnit(with: .kilo)
            let out: JSArray = (samples ?? []).compactMap { sample -> JSValue? in
                guard let q = sample as? HKQuantitySample else { return nil }
                if q.sourceRevision.source.bundleIdentifier == own { return nil }
                if let id = q.metadata?[HKMetadataKeySyncIdentifier] as? String, id.hasPrefix("opengym-") { return nil }
                let entry: JSObject = ["t": q.startDate.timeIntervalSince1970 * 1000, "kg": q.quantity.doubleValue(for: kg)]
                return entry
            }
            var result: JSObject = ["samples": out]
            if let next = next, let data = try? NSKeyedArchiver.archivedData(withRootObject: next, requiringSecureCoding: true) {
                result["anchor"] = data.base64EncodedString()
            }
            call.resolve(result)
        }
        store.execute(query)
    }

    // There is no deep link to one app's data in Health; this opens the Health app, where
    // Browse → (a type) → Data Sources & Access lists what openGym wrote.
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: "x-apple-health://") else {
                call.reject("Apple Health is not available", "unavailable")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve() } else { call.reject("Could not open Health", "failed") }
            }
        }
    }

    // MARK: - Writing

    private func syncMetadata(_ id: String, _ version: Int) -> [String: Any] {
        [HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: NSNumber(value: version)]
    }

    private func saveWorkout(_ s: JSObject, version: Int) async throws {
        guard let id = s["id"] as? String,
              let start = AppleHealthPlugin.date(s["start"]),
              let end = AppleHealthPlugin.date(s["end"]), end > start else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = AppleHealthPlugin.activityType(s["type"] as? String ?? "")
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        var metadata = syncMetadata(id, version)
        metadata[HKMetadataKeyIndoorWorkout] = true
        if let title = s["title"] as? String, !title.isEmpty { metadata[AppleHealthPlugin.titleKey] = title }
        if let notes = s["notes"] as? String, !notes.isEmpty { metadata[AppleHealthPlugin.notesKey] = notes }

        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            builder.beginCollection(withStart: start) { _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            builder.addMetadata(metadata) { _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            builder.endCollection(withEnd: end) { _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            builder.finishWorkout { _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
    }

    private func weightSample(_ w: JSObject, version: Int) -> HKQuantitySample? {
        guard let id = w["id"] as? String,
              let time = AppleHealthPlugin.date(w["time"]),
              let kg = AppleHealthPlugin.number(w["kg"]), kg > 0 else { return nil }
        let quantity = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg)
        return HKQuantitySample(type: massType, quantity: quantity, start: time, end: time, metadata: syncMetadata(id, version))
    }

    private func save(_ objects: [HKObject]) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            store.save(objects) { _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
    }

    private func delete(_ type: HKObjectType, ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        let predicate = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: ids)
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            store.deleteObjects(of: type, predicate: predicate) { _, _, error in
                if let error = error { c.resume(throwing: error) } else { c.resume() }
            }
        }
    }

    // MARK: - Helpers

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        if let hk = error as? HKError {
            switch hk.code {
            case .errorAuthorizationDenied, .errorAuthorizationNotDetermined:
                call.reject(hk.localizedDescription, "permission")
                return
            case .errorHealthDataUnavailable, .errorHealthDataRestricted:
                call.reject(hk.localizedDescription, "unavailable")
                return
            default:
                break
            }
        }
        call.reject(error.localizedDescription, "failed")
    }

    // A number from JS, however the bridge typed it.
    static func number(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        return nil
    }

    // Epoch milliseconds from JS.
    static func date(_ value: Any?) -> Date? {
        guard let ms = number(value), ms > 0 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    // The names lib/health-connect.js uses (SESSION_TYPES); anything else is "other".
    static func activityType(_ name: String) -> HKWorkoutActivityType {
        switch name {
        case "strength_training": return .traditionalStrengthTraining
        case "walking": return .walking
        case "running": return .running
        case "biking_stationary": return .cycling
        case "elliptical": return .elliptical
        case "stair_climbing_machine": return .stairClimbing
        default: return .other
        }
    }
}
