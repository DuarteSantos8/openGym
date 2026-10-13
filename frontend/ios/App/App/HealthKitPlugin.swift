import Foundation
import Capacitor
import HealthKit

/**
 * Read-only bridge to Apple Health for the health area (frontend/src/lib/health/apple-health.js).
 * It asks only for the read types the app passes, writes nothing, and logs no values.
 *
 * HealthKit never says whether reading a type was allowed: a type the user declined just has no
 * samples. So every query answers what it finds, and an empty answer is not an error.
 *
 * Registered by AppViewController (a local plugin is not in Capacitor's generated plugin list).
 *
 *   isAvailable()                                  -> { available }
 *   requestAuthorization({ read: [identifier] })   -> { asked }
 *   querySamples({ type, unit, start, end })       -> { samples: [{ id, value, start, end }] }
 *   queryDaily({ type, unit, start, end, stat })   -> { days: [{ date, value, min?, max? }] }
 *                                                     stat: 'sum' | 'avg' | 'range'
 *   querySleep({ start, end })                     -> { nights: [{ date, minutes, start, end }] }
 *   queryCategory({ type, start, end })            -> { samples: [{ value, start, end, source }] }
 *   queryWorkouts({ start, end })                  -> { workouts: [{ activity, start, end, minutes, kcal?, km? }] }
 * Times are milliseconds since 1970; `date` is the local day, YYYY-MM-DD.
 */
@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySamples", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryDaily", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryCategory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryWorkouts", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    // The only unit strings the app sends; anything else is refused rather than handed to
    // HKUnit(from:), which raises an exception on a string it cannot parse.
    // Built from HKUnit's own constructors, never parsed, so none of them can raise.
    private static let units: [String: HKUnit] = {
        var u: [String: HKUnit] = [
        "kg": HKUnit.gramUnit(with: .kilo),
        "g": HKUnit.gram(),
        "mg": HKUnit.gramUnit(with: .milli),
        "mcg": HKUnit.gramUnit(with: .micro),
        "%": HKUnit.percent(),
        "count": HKUnit.count(),
        "cm": HKUnit.meterUnit(with: .centi),
        "m": HKUnit.meter(),
        "km": HKUnit.meterUnit(with: .kilo),
        "kcal": HKUnit.kilocalorie(),
        "count/min": HKUnit.count().unitDivided(by: HKUnit.minute()),
        "min": HKUnit.minute(),
        "ms": HKUnit.secondUnit(with: .milli),
        "mmHg": HKUnit.millimeterOfMercury(),
        "degC": HKUnit.degreeCelsius(),
        "mg/dL": HKUnit.gramUnit(with: .milli).unitDivided(by: HKUnit.literUnit(with: .deci)),
        "km/hr": HKUnit.meterUnit(with: .kilo).unitDivided(by: HKUnit.hour()),
        "mL": HKUnit.literUnit(with: .milli),
        "L": HKUnit.liter(),
        "L/min": HKUnit.liter().unitDivided(by: HKUnit.minute()),
        "IU": HKUnit.internationalUnit(),
        "mcS": HKUnit.siemenUnit(with: .micro),
        "dBASPL": HKUnit.decibelAWeightedSoundPressureLevel(),
        "mL/kg*min": HKUnit.literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute())),
        "kcal/hr*kg": HKUnit.kilocalorie().unitDivided(by: HKUnit.hour().unitMultiplied(by: HKUnit.gramUnit(with: .kilo))),
        ]
        // Power (running and cycling) came with iOS 16; before it there is nothing to read anyway.
        if #available(iOS 16.0, *) { u["W"] = HKUnit.watt() }
        return u
    }()

    // Sleep analysis values that count as asleep: unspecified (1), core (3), deep (4), REM (5).
    // In bed (0) and awake (2) do not. Raw values, valid on every iOS this app supports.
    private static let asleepValues: Set<Int> = [1, 3, 4, 5]

    // The local day of a time, YYYY-MM-DD. Built from calendar components rather than a shared
    // DateFormatter, which is not safe across the queries' concurrent result handlers.
    private func dayString(_ date: Date) -> String {
        let c = Calendar(identifier: .gregorian).dateComponents(in: TimeZone.current, from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private func date(_ call: CAPPluginCall, _ key: String, _ fallback: Date) -> Date {
        guard let ms = call.getDouble(key) else { return fallback }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    private func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        if let hk = error as? HKError, hk.code == .errorAuthorizationDenied || hk.code == .errorAuthorizationNotDetermined {
            call.reject("Not authorised", "permission")
        } else {
            call.reject("Health query failed", "failed")
        }
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Health data is not available on this device", "unavailable")
            return
        }
        let ids = call.getArray("read", String.self) ?? []
        var types = Set<HKObjectType>()
        for id in ids {
            if id == "HKWorkoutTypeIdentifier" {
                types.insert(HKObjectType.workoutType())
            } else if id.hasPrefix("HKCategoryTypeIdentifier") {
                if let t = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: id)) { types.insert(t) }
            } else if let t = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: id)) {
                types.insert(t)
            }
        }
        guard !types.isEmpty else {
            call.reject("No known Health types", "invalid")
            return
        }
        // Read only: nothing is ever shared (written) to Apple Health.
        store.requestAuthorization(toShare: nil, read: types) { ok, error in
            if let error = error { self.reject(call, error); return }
            call.resolve(["asked": ok])
        }
    }

    private func quantityArgs(_ call: CAPPluginCall) -> (HKQuantityType, HKUnit)? {
        guard let id = call.getString("type"),
              let type = HKObjectType.quantityType(forIdentifier: HKQuantityTypeIdentifier(rawValue: id)),
              let unitKey = call.getString("unit"),
              let unit = HealthKitPlugin.units[unitKey],
              type.is(compatibleWith: unit) else {
            call.reject("Unknown type or unit", "invalid")
            return nil
        }
        return (type, unit)
    }

    @objc func querySamples(_ call: CAPPluginCall) {
        guard let args = quantityArgs(call) else { return }
        let (type, unit) = args
        let start = date(call, "start", Date.distantPast)
        let end = date(call, "end", Date())
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { self.reject(call, error); return }
            let out: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { s in
                ["id": s.uuid.uuidString, "value": s.quantity.doubleValue(for: unit), "start": self.ms(s.startDate), "end": self.ms(s.endDate)]
            }
            call.resolve(["samples": out])
        }
        store.execute(query)
    }

    @objc func queryDaily(_ call: CAPPluginCall) {
        guard let args = quantityArgs(call) else { return }
        let (type, unit) = args
        let stat = call.getString("stat") ?? "avg"
        // A cumulative type (steps, distance, energy) is summed; a discrete one (heart rate)
        // averaged. Asking HealthKit for the wrong kind raises an exception, so it is checked here.
        let cumulative = type.aggregationStyle == .cumulative
        if (stat == "sum") != cumulative {
            call.reject("Statistic does not fit the type", "invalid")
            return
        }
        let options: HKStatisticsOptions = stat == "sum" ? .cumulativeSum
            : stat == "range" ? [.discreteAverage, .discreteMin, .discreteMax] : .discreteAverage
        let calendar = Calendar.current
        let anchor = calendar.startOfDay(for: date(call, "start", Date()))
        let end = date(call, "end", Date())
        let predicate = HKQuery.predicateForSamples(withStart: anchor, end: end, options: [])
        let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                                                options: options, anchorDate: anchor, intervalComponents: DateComponents(day: 1))
        query.initialResultsHandler = { _, results, error in
            if let error = error { self.reject(call, error); return }
            var days: [[String: Any]] = []
            results?.enumerateStatistics(from: anchor, to: end) { s, _ in
                let value = cumulative ? s.sumQuantity()?.doubleValue(for: unit) : s.averageQuantity()?.doubleValue(for: unit)
                guard let v = value else { return }
                var day: [String: Any] = ["date": self.dayString(s.startDate), "value": v]
                if stat == "range" {
                    if let lo = s.minimumQuantity()?.doubleValue(for: unit) { day["min"] = lo }
                    if let hi = s.maximumQuantity()?.doubleValue(for: unit) { day["max"] = hi }
                }
                days.append(day)
            }
            call.resolve(["days": days])
        }
        store.execute(query)
    }

    @objc func querySleep(_ call: CAPPluginCall) {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.reject("Sleep is not available", "unavailable")
            return
        }
        let start = date(call, "start", Date.distantPast)
        let end = date(call, "end", Date())
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { self.reject(call, error); return }
            // An iPhone and a Watch both record the same night: the asleep intervals of every
            // source are merged where they overlap before they are counted, so it counts once.
            var spans: [(Date, Date)] = []
            for s in (samples as? [HKCategorySample] ?? []) where HealthKitPlugin.asleepValues.contains(s.value) {
                if let last = spans.last, s.startDate <= last.1 {
                    if s.endDate > last.1 { spans[spans.count - 1].1 = s.endDate }
                } else {
                    spans.append((s.startDate, s.endDate))
                }
            }
            // Each span belongs to the day it ended on: a night is the day you woke up.
            var nights: [String: (minutes: Double, start: Date, end: Date)] = [:]
            for (a, b) in spans {
                let key = self.dayString(b)
                let minutes = b.timeIntervalSince(a) / 60
                if let n = nights[key] {
                    nights[key] = (n.minutes + minutes, min(n.start, a), max(n.end, b))
                } else {
                    nights[key] = (minutes, a, b)
                }
            }
            let out: [[String: Any]] = nights.keys.sorted().map { key in
                let n = nights[key]!
                return ["date": key, "minutes": n.minutes, "start": self.ms(n.start), "end": self.ms(n.end)]
            }
            call.resolve(["nights": out])
        }
        store.execute(query)
    }

    // Any category's samples as they are: the app folds them by day (api/health/fold.js) and reads
    // the value by the category's own family (severity, flow, test result…).
    @objc func queryCategory(_ call: CAPPluginCall) {
        guard let id = call.getString("type"), id.hasPrefix("HKCategoryTypeIdentifier"),
              let type = HKObjectType.categoryType(forIdentifier: HKCategoryTypeIdentifier(rawValue: id)) else {
            call.reject("Unknown type", "invalid")
            return
        }
        let start = date(call, "start", Date.distantPast)
        let end = date(call, "end", Date())
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { self.reject(call, error); return }
            let out: [[String: Any]] = (samples as? [HKCategorySample] ?? []).map { s in
                ["value": s.value, "start": self.ms(s.startDate), "end": self.ms(s.endDate),
                 "source": s.sourceRevision.source.bundleIdentifier]
            }
            call.resolve(["samples": out])
        }
        store.execute(query)
    }

    // Workouts: the activity as HealthKit's number, the minutes, and the energy and distance the
    // workout carries (HKWorkout's totals, which every iOS this app supports still fills in).
    @objc func queryWorkouts(_ call: CAPPluginCall) {
        let start = date(call, "start", Date.distantPast)
        let end = date(call, "end", Date())
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { self.reject(call, error); return }
            let out: [[String: Any]] = (samples as? [HKWorkout] ?? []).map { w in
                var o: [String: Any] = ["activity": Int(w.workoutActivityType.rawValue), "start": self.ms(w.startDate),
                                        "end": self.ms(w.endDate), "minutes": w.duration / 60]
                if let e = w.totalEnergyBurned?.doubleValue(for: HKUnit.kilocalorie()) { o["kcal"] = e }
                if let d = w.totalDistance?.doubleValue(for: HKUnit.meterUnit(with: .kilo)) { o["km"] = d }
                return o
            }
            call.resolve(["workouts": out])
        }
        store.execute(query)
    }
}
