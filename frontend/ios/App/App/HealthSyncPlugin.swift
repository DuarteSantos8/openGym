import Foundation
import Capacitor
import HealthKit
import CoreLocation
import UIKit

// Only weight and finished workout timestamps cross this bridge after local opt-in.
@objc(HealthSyncPlugin)
public class HealthSyncPlugin: CAPPlugin {
    private let health = HKHealthStore()
    private let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass)!

    private let activeEnergy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
    private let basalEnergy = HKObjectType.quantityType(forIdentifier: .basalEnergyBurned)!
    private let weather = WorkoutWeatherCapture()

    @objc func authorizeWeather(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.weather.authorize { error in
                if let error { call.reject(error) } else { call.resolve() }
            }
        }
    }
    @objc func captureWeather(_ call: CAPPluginCall) {
        guard let ms = call.getDouble("start"), ms.isFinite, ms > 0,
              ms <= Date().timeIntervalSince1970 * 1000,
              Date().timeIntervalSince1970 * 1000 - ms <= 21600000 else {
            call.reject("Start a current workout before collecting weather"); return
        }
        DispatchQueue.main.async {
            self.weather.capture(start: Date(timeIntervalSince1970: ms / 1000)) { result, error in
                if let result { call.resolve(result) }
                else { call.reject(error ?? "Workout weather is unavailable") }
            }
        }
    }
    @objc func cancelWeather(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.weather.cancel(); call.resolve() }
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func authorize(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is unavailable on this device")
            return
        }
        health.requestAuthorization(toShare: [bodyMass, HKObjectType.workoutType(), activeEnergy, basalEnergy], read: [bodyMass, HKObjectType.workoutType()]) { _, error in
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
                let own = existing.first {
                    $0.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier &&
                    ($0.metadata?[HKMetadataKeyExternalUUID] as? String) == externalID &&
                    abs($0.startDate.timeIntervalSince(start)) < 0.001 && abs($0.endDate.timeIntervalSince(end)) < 0.001
                }
                let measured = row["healthMetrics"] as? [String: Any]
                var energySamples: [HKQuantitySample] = []
                for (key, type) in [("activeKcal", self.activeEnergy), ("basalKcal", self.basalEnergy)] {
                    guard measured?["final"] as? Bool == true,
                          let sampledAt = (measured?["sampledAt"] as? NSNumber)?.doubleValue, sampledAt.isFinite, sampledAt > 0, sampledAt <= 9007199254740991,
                          let kcal = (measured?[key] as? NSNumber)?.doubleValue, kcal.isFinite, kcal >= 0 else { continue }
                    guard self.health.authorizationStatus(for: type) == .sharingAuthorized else {
                        call.reject("Allow openGym to save active and resting energy in Apple Health"); return
                    }
                    // Stable identifiers make a retry replace its own sample instead of adding calories twice.
                    energySamples.append(HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                        start: start, end: end, metadata: [HKMetadataKeySyncIdentifier: externalID + "-" + key, HKMetadataKeySyncVersion: Int64(sampledAt)]))
                }
                if let own {
                    guard !energySamples.isEmpty else { next(index + 1); return }
                    // Enrich only our exact exported workout. Never replace/delete a workout or another app's data.
                    self.health.add(energySamples, to: own) { ok, error in
                        if let error { call.reject(error.localizedDescription); return }
                        guard ok else { call.reject("HealthKit did not associate workout energy"); return }
                        written += 1
                        next(index + 1)
                    }
                    return
                }
                // Only stable app-owned identifiers deduplicate; unrelated sessions may overlap.
                if existing.contains(where: {
                    $0.sourceRevision.source.bundleIdentifier == Bundle.main.bundleIdentifier &&
                    ($0.metadata?[HKMetadataKeyExternalUUID] as? String) == externalID
                }) { next(index + 1); return }
                let configuration = HKWorkoutConfiguration()
                configuration.activityType = .traditionalStrengthTraining
                configuration.locationType = .indoor
                let builder = HKWorkoutBuilder(healthStore: self.health, configuration: configuration, device: nil)
                builder.beginCollection(withStart: start) { ok, error in
                    guard ok else { call.reject(error?.localizedDescription ?? "Cannot start workout export"); return }
                    var metadata: [String: Any] = [HKMetadataKeyExternalUUID: externalID, HKMetadataKeySyncIdentifier: externalID, HKMetadataKeySyncVersion: 1, HKMetadataKeyWorkoutBrandName: (row["name"] as? String) ?? "openGym"]
                    if let weather = row["weather"] as? [String: Any],
                       let celsius = (weather["celsius"] as? NSNumber)?.doubleValue, celsius.isFinite, (-90...60).contains(celsius),
                       let humidity = (weather["humidity"] as? NSNumber)?.doubleValue, humidity.isFinite, (0...100).contains(humidity),
                       let observed = (weather["observedAt"] as? NSNumber)?.doubleValue, observed.isFinite,
                       observed >= startMs, observed <= endMs {
                        metadata[HKMetadataKeyWeatherTemperature] = HKQuantity(unit: .degreeCelsius(), doubleValue: celsius)
                        // HealthKit percentUnit uses a fraction in 0...1.
                        metadata[HKMetadataKeyWeatherHumidity] = HKQuantity(unit: .percent(), doubleValue: humidity / 100)
                    }
                    builder.addMetadata(metadata) { ok, error in
                        guard ok else { call.reject(error?.localizedDescription ?? "Cannot identify workout"); return }
                        let finish = {
                            builder.endCollection(withEnd: end) { ok, error in
                                guard ok else { call.reject(error?.localizedDescription ?? "Cannot end workout export"); return }
                                builder.finishWorkout { workout, error in
                                    if let error { call.reject(error.localizedDescription); return }
                                    guard workout != nil else { call.reject("HealthKit did not save the workout"); return }
                                    written += 1
                                    next(index + 1)
                                }
                            }
                        }
                        if energySamples.isEmpty { finish() }
                        else {
                            builder.add(energySamples) { ok, error in
                                guard ok else { call.reject(error?.localizedDescription ?? "Cannot save workout energy"); return }
                                finish()
                            }
                        }
                    }
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

// A single foreground location fix and bounded weather request. No route or coordinates
// are persisted, logged, returned to JavaScript or sent to the openGym server.
private final class WorkoutWeatherCapture: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var permission: ((String?) -> Void)?
    private var completion: (([String: Any]?, String?) -> Void)?
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var timeout: DispatchWorkItem?
    private var started = Date.distantPast
    private var generation = UUID()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }
    func authorize(_ callback: @escaping (String?) -> Void) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: callback(nil)
        case .denied, .restricted: callback("Allow location access in iOS Settings")
        default:
            guard permission == nil else { callback("Location permission is being requested"); return }
            permission = callback
            manager.requestWhenInUseAuthorization()
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager.authorizationStatus != .notDetermined else { return }
        let callback = permission; permission = nil
        let allowed = manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways
        callback?(allowed ? nil : "Allow location access in iOS Settings")
        if !allowed, completion != nil { finish(nil, "Allow location access in iOS Settings") }
    }
    func capture(start: Date, callback: @escaping ([String: Any]?, String?) -> Void) {
        cancel()
        guard UIApplication.shared.applicationState == .active else {
            callback(nil, "Open the iPhone app to collect workout weather"); return
        }
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            callback(nil, "Allow location access in iOS Settings"); return
        }
        started = start; completion = callback
        let expiry = DispatchWorkItem { [weak self] in self?.finish(nil, "Workout weather is unavailable") }
        timeout = expiry
        DispatchQueue.main.asyncAfter(deadline: .now() + 25, execute: expiry)
        manager.startUpdatingLocation()
    }
    func cancel() { finish(nil, "Weather request cancelled") }
    private func finish(_ result: [String: Any]?, _ error: String?) {
        generation = UUID()
        timeout?.cancel(); timeout = nil
        manager.stopUpdatingLocation()
        task?.cancel(); task = nil
        session?.invalidateAndCancel(); session = nil
        let callback = completion; completion = nil
        callback?(result, error)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if completion != nil { finish(nil, "Workout weather is unavailable") }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard completion != nil, task == nil,
              let point = locations.last(where: {
                  CLLocationCoordinate2DIsValid($0.coordinate) && $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 1500 &&
                  abs($0.timestamp.timeIntervalSinceNow) <= 15 && $0.timestamp >= started
              }) else { return }
        let observedAt = point.timestamp.timeIntervalSince1970 * 1000
        manager.stopUpdatingLocation()
        // Weather models do not need precise gym coordinates (~1 km rounding).
        let latitude = (point.coordinate.latitude * 100).rounded() / 100
        let longitude = (point.coordinate.longitude * 100).rounded() / 100
        var url = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        url.queryItems = [URLQueryItem(name: "latitude", value: String(latitude)),
                         URLQueryItem(name: "longitude", value: String(longitude)),
                         URLQueryItem(name: "current", value: "temperature_2m,relative_humidity_2m"),
                         URLQueryItem(name: "temperature_unit", value: "celsius"),
                         URLQueryItem(name: "timeformat", value: "unixtime"),
                         URLQueryItem(name: "timezone", value: "GMT"),
                         URLQueryItem(name: "forecast_days", value: "1")]
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10; config.timeoutIntervalForResource = 15
        config.urlCache = nil; config.httpCookieStorage = nil
        let session = URLSession(configuration: config); self.session = session
        let token = generation
        task = session.dataTask(with: url.url!) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self, self.generation == token, self.completion != nil else { return }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      let data, data.count <= 32768,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let current = json["current"] as? [String: Any],
                      let units = json["current_units"] as? [String: Any],
                      units["temperature_2m"] as? String == "°C", units["relative_humidity_2m"] as? String == "%",
                      let celsius = (current["temperature_2m"] as? NSNumber)?.doubleValue,
                      celsius.isFinite, (-90...60).contains(celsius),
                      let humidity = (current["relative_humidity_2m"] as? NSNumber)?.doubleValue,
                      humidity.isFinite, (0...100).contains(humidity),
                      let at = (current["time"] as? NSNumber)?.doubleValue, at.isFinite,
                      abs(Date().timeIntervalSince1970 - at) <= 1800 else {
                    self.finish(nil, "Workout weather is unavailable"); return
                }
                self.finish(["celsius": celsius, "humidity": humidity, "observedAt": observedAt], nil)
            }
        }
        task?.resume()
    }
}
