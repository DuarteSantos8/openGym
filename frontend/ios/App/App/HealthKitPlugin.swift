import Capacitor
import Foundation
import HealthKit
import os

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "latestBodyMass", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "openGym", category: "HealthKit")

    @objc public func latestBodyMass(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(),
              let bodyMass = HKObjectType.quantityType(forIdentifier: .bodyMass) else {
            logger.warning("Health data unavailable; using manual weigh-in")
            call.resolve(["status": "unsupported"])
            return
        }
        DispatchQueue.main.async {
            self.logger.info("Requesting read-only body mass access")
            self.healthStore.requestAuthorization(toShare: [], read: [bodyMass]) { completed, error in
                guard completed else {
                    self.logger.error("Health authorization request failed; using manual weigh-in. Code: \((error as NSError?)?.code ?? -1)")
                    call.reject("Apple Health access could not be requested", "authorization-failed")
                    return
                }
                // Completion does not reveal whether the user allowed read access.
                self.readLatest(bodyMass, call: call)
            }
        }
    }

    private func readLatest(_ bodyMass: HKQuantityType, call: CAPPluginCall) {
        let newestFirst = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: bodyMass, predicate: nil, limit: 1, sortDescriptors: [newestFirst]) { _, samples, error in
            if let error = error {
                self.logger.error("Health body mass query failed; using manual weigh-in. Code: \((error as NSError).code)")
                call.reject("Apple Health weight could not be read", "query-failed")
                return
            }
            guard let sample = samples?.first as? HKQuantitySample else {
                self.logger.warning("No readable body mass sample; using manual weigh-in")
                call.resolve(["status": "no-readable-data"])
                return
            }
            self.logger.info("Latest body mass sample read; handing it to the existing weight save flow")
            call.resolve([
                "status": "available",
                "kilograms": sample.quantity.doubleValue(for: .gramUnit(with: .kilo)),
                "measuredAt": sample.startDate.timeIntervalSince1970 * 1000
            ])
        }
        healthStore.execute(query)
    }
}
