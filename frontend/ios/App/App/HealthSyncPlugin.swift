import Foundation
import Capacitor
import HealthKit

// Only weight and finished workout timestamps cross this bridge after local opt-in.
@objc(HealthSyncPlugin)
public class HealthSyncPlugin: CAPPlugin {
    private let health = HKHealthStore()
    private let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass)!

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func authorize(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is unavailable on this device")
            return
        }
        health.requestAuthorization(toShare: [bodyMass, HKObjectType.workoutType()], read: [bodyMass, HKObjectType.workoutType()]) { _, error in
            if let error = error { call.reject(error.localizedDescription) }
            else { call.resolve() }
        }
    }

    @objc func readWeights(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is unavailable"); return }
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let query = HKSampleQuery(sampleType: bodyMass, predicate: nil, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let calendar = Calendar.current
            let rows: [[String: Any]] = (samples ?? []).compactMap { sample in
                guard let sample = sample as? HKQuantitySample else { return nil }
                let c = calendar.dateComponents([.year, .month, .day], from: sample.startDate)
                guard let year = c.year, let month = c.month, let day = c.day else { return nil }
                return [
                    "date": String(format: "%04d-%02d-%02d", year, month, day),
                    "kg": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                    "timestamp": Int64(sample.startDate.timeIntervalSince1970 * 1000),
                    "own": sample.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier,
                ]
            }
            call.resolve(["weights": rows])
        }
        health.execute(query)
    }

    @objc func writeWeights(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is unavailable"); return }
        let entries = (call.getArray("weights") as? [[String: Any]]) ?? []
        let own = HKQuery.predicateForObjects(from: .default())
        let query = HKSampleQuery(sampleType: bodyMass, predicate: own, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, error in
            guard let self = self else { call.reject("Health sync stopped"); return }
            if let error = error { call.reject(error.localizedDescription); return }
            let existing = Dictionary((samples ?? []).compactMap { item -> (String, HKQuantitySample)? in
                guard let sample = item as? HKQuantitySample,
                      let id = sample.metadata?[HKMetadataKeyExternalUUID] as? String else { return nil }
                return (id, sample)
            }, uniquingKeysWith: { first, _ in first })
            var written = 0
            func next(_ index: Int) {
                if index == entries.count { call.resolve(["written": written]); return }
                let row = entries[index]
                guard let date = row["date"] as? String, date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
                      let kg = (row["kg"] as? NSNumber)?.doubleValue, kg.isFinite, kg > 0, kg < 500,
                      let timestamp = (row["timestamp"] as? NSNumber)?.doubleValue,
                      timestamp.isFinite, timestamp > 0, timestamp <= 8640000000000000,
                      let version = (row["version"] as? NSNumber)?.doubleValue,
                      version.isFinite, version > 0, version <= 8640000000000000 else { next(index + 1); return }
                let id = "opengym-weight-\(date)"
                if let old = existing[id], abs(old.quantity.doubleValue(for: .gramUnit(with: .kilo)) - kg) < 0.001,
                   abs(old.startDate.timeIntervalSince1970 * 1000 - timestamp) < 1 {
                    next(index + 1); return
                }
                let at = Date(timeIntervalSince1970: timestamp / 1000)
                let sample = HKQuantitySample(type: self.bodyMass, quantity: HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg), start: at, end: at, metadata: [HKMetadataKeyExternalUUID: id, HKMetadataKeySyncIdentifier: id, HKMetadataKeySyncVersion: Int64(version)])
                let save = {
                    self.health.save(sample) { ok, error in
                        if let error = error { call.reject(error.localizedDescription); return }
                        guard ok else { call.reject("HealthKit did not save the sample"); return }
                        written += 1
                        next(index + 1)
                    }
                }
                // HealthKit replaces older versions atomically, even without read access.
                save()
            }
            next(0)
        }
        health.execute(query)
    }

    @objc func writeWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is unavailable"); return }
        let entries = (call.getArray("workouts") as? [[String: Any]]) ?? []
        let query = HKSampleQuery(sampleType: .workoutType(), predicate: nil, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, error in
            guard let self = self else { call.reject("Health sync stopped"); return }
            if let error = error { call.reject(error.localizedDescription); return }
            let existing = (samples ?? []).compactMap { $0 as? HKWorkout }
            var written = 0
            func next(_ index: Int) {
                if index == entries.count { call.resolve(["written": written]); return }
                let row = entries[index]
                guard let id = row["id"] as? String, !id.isEmpty,
                      let startMs = (row["start"] as? NSNumber)?.doubleValue,
                      let endMs = (row["end"] as? NSNumber)?.doubleValue,
                      startMs.isFinite, endMs.isFinite, startMs > 0, endMs <= 8640000000000000, endMs > startMs else { next(index + 1); return }
                let start = Date(timeIntervalSince1970: startMs / 1000)
                let end = Date(timeIntervalSince1970: endMs / 1000)
                let externalID = "opengym-workout-\(id)"
                // Match our own stable identifier; unrelated workouts may overlap in time.
                if existing.contains(where: {
                    $0.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier &&
                    ($0.metadata?[HKMetadataKeyExternalUUID] as? String) == externalID
                }) { next(index + 1); return }
                let name = (row["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "openGym"
                let workout = HKWorkout(activityType: .traditionalStrengthTraining, start: start, end: end, workoutEvents: nil, totalEnergyBurned: nil, totalDistance: nil, metadata: [HKMetadataKeyExternalUUID: externalID, HKMetadataKeySyncIdentifier: externalID, HKMetadataKeySyncVersion: 1, HKMetadataKeyWorkoutBrandName: name])
                self.health.save(workout) { ok, error in
                    if let error = error { call.reject(error.localizedDescription); return }
                    guard ok else { call.reject("HealthKit did not save the sample"); return }
                    written += 1
                    next(index + 1)
                }
            }
            next(0)
        }
        health.execute(query)
    }
    @objc func deleteWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health is unavailable"); return }
        guard health.authorizationStatus(for: .workoutType()) == .sharingAuthorized else {
            call.reject("Allow openGym to write workouts in Apple Health before deleting an exported workout"); return
        }
        guard let row = call.getObject("workout"), let target = HealthWorkoutDeletion(row) else {
            call.reject("Invalid workout deletion request"); return
        }
        let own = HKQuery.predicateForObjects(from: .default())
        let identifier = HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeyExternalUUID, operatorType: .equalTo, value: target.externalID)
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [own, identifier])
        let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, error in
            guard let self = self else { call.reject("Health sync stopped"); return }
            if let error = error { call.reject(error.localizedDescription); return }
            let matches = (samples ?? []).compactMap { $0 as? HKWorkout }.filter {
                target.matches(source: $0.sourceRevision.source.bundleIdentifier,
                               appSource: Bundle.main.bundleIdentifier ?? "",
                               externalID: $0.metadata?[HKMetadataKeyExternalUUID] as? String,
                               start: $0.startDate, end: $0.endDate)
            }
            // Never broaden an empty match to a date range, another source or all workouts.
            guard !matches.isEmpty else {
                // Own samples remain readable when external workout reads are denied.
                // An absent identifier is an idempotent no-op; a date mismatch is unresolved.
                call.resolve(["deleted": 0, "confirmed": (samples ?? []).isEmpty]); return
            }
            self.health.delete(matches) { ok, error in
                if let error = error { call.reject(error.localizedDescription); return }
                guard ok else { call.reject("HealthKit did not delete the workout"); return }
                call.resolve(["deleted": matches.count, "confirmed": true])
            }
        }
        health.execute(query)
    }

}
