import Capacitor
import Foundation
import HealthKit
import UIKit
import CoreLocation

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
        CAPPluginMethod(name: "authorizeWeather", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureWeather", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelWeather", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readWeights", returnType: CAPPluginReturnPromise),
    ]

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
                let hasEnergy = sessions.contains { ($0["healthMetrics"] as? [String: Any])?["final"] as? Bool == true }
                if hasEnergy {
                    let energy: Set<HKSampleType> = [HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!, HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned)!]
                    try await self.store.requestAuthorization(toShare: energy, read: [])
                }
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
        // The iPhone's own workout session (AirPods heart rate, #818) saved this one live, with its
        // heart rate: left as it is, like the watch's copy.
        if await PhoneWorkoutLedger.handled(id) { return }
        let start = Date(timeIntervalSince1970: startMs / 1000), end = Date(timeIntervalSince1970: endMs / 1000)
        let measured = s["healthMetrics"] as? [String: Any]
        var energy: [HKQuantitySample] = []
        for (key, identifier) in [("activeKcal", HKQuantityTypeIdentifier.activeEnergyBurned), ("basalKcal", .basalEnergyBurned)] {
            guard measured?["final"] as? Bool == true,
                  let stamp = (measured?["sampledAt"] as? NSNumber)?.doubleValue, stamp.isFinite, stamp > 0, stamp <= 9007199254740991,
                  let kcal = (measured?[key] as? NSNumber)?.doubleValue, kcal.isFinite, kcal >= 0,
                  let type = HKQuantityType.quantityType(forIdentifier: identifier) else { continue }
            guard store.authorizationStatus(for: type) == .sharingAuthorized else { throw HKError(.errorAuthorizationDenied) }
            energy.append(HKQuantitySample(type: type, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                start: start, end: end, metadata: [HKMetadataKeySyncIdentifier: id + "-" + key, HKMetadataKeySyncVersion: Int64(stamp)]))
        }
        // A retry/enrichment adds versioned samples only to this app's exact exported session.
        // Watch/phone live workouts were handled above; never recreate those to attach metadata.
        if !energy.isEmpty, let own = try await ownSession(id, start: start, end: end) {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                store.add(energy, to: own) { ok, error in
                    if let error { cont.resume(throwing: error) }
                    else if ok { cont.resume() }
                    else { cont.resume(throwing: HKError(.errorInvalidArgument)) }
                }
            }
            return
        }
        let config = HKWorkoutConfiguration()
        config.activityType = AppleHealthPlugin.activityTypes[(s["type"] as? String) ?? ""] ?? .other
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())
        try await builder.beginCollection(at: start)
        var meta = syncMetadata(id)
        if let title = s["title"] as? String, !title.isEmpty { meta["OpenGymTitle"] = title }
        if let weather = s["weather"] as? [String: Any],
           let celsius = (weather["celsius"] as? NSNumber)?.doubleValue, celsius.isFinite, (-90...60).contains(celsius),
           let humidity = (weather["humidity"] as? NSNumber)?.doubleValue, humidity.isFinite, (0...100).contains(humidity),
           let observed = (weather["observedAt"] as? NSNumber)?.doubleValue, observed.isFinite, observed >= startMs, observed <= endMs {
            meta[HKMetadataKeyWeatherTemperature] = HKQuantity(unit: .degreeCelsius(), doubleValue: celsius)
            meta[HKMetadataKeyWeatherHumidity] = HKQuantity(unit: .percent(), doubleValue: humidity / 100)
        }
        try await builder.addMetadata(meta)
        if !energy.isEmpty { try await builder.addSamples(energy) }
        try await builder.endCollection(at: end)
        _ = try await builder.finishWorkout()
    }

    private func ownSession(_ id: String, start: Date, end: Date) async throws -> HKWorkout? {
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForObjects(from: .default()),
            HKQuery.predicateForObjects(withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: [id]),
        ])
        return try await withCheckedThrowingContinuation { cont in
            let q = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, found, error in
                if let error { cont.resume(throwing: error); return }
                cont.resume(returning: (found ?? []).compactMap { $0 as? HKWorkout }.first {
                    abs($0.startDate.timeIntervalSince(start)) < 0.001 && abs($0.endDate.timeIntervalSince(end)) < 0.001
                })
            }
            store.execute(q)
        }
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
