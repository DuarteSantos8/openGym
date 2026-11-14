import XCTest
@testable import WatchCore

final class HealthExportTests: XCTestCase {
    let metrics: [String: Any] = ["activeKcal": 12.345, "basalKcal": 3.21, "sampledAt": 1000, "final": true]
    func testDeniedBasalKeepsActiveEnergy() {
        let values = HealthExportCore.energy(metrics, allowed: ["activeKcal"])
        XCTAssertEqual(values.map(\.key), ["activeKcal"])
        XCTAssertEqual(values.first?.kcal, 12.345)
    }
    func testDeniedEnergyIsOptional() {
        XCTAssertTrue(HealthExportCore.energy(metrics, allowed: []).isEmpty)
        XCTAssertEqual(HealthExportCore.energy(metrics, allowed: ["basalKcal"]).map(\.key), ["basalKcal"])
    }
    func testOnlyFinalFiniteMeasurementsAreExported() {
        var value = metrics; value["final"] = false
        XCTAssertTrue(HealthExportCore.energy(value, allowed: Set(HealthExportCore.energyKeys)).isEmpty)
        value = metrics; value["activeKcal"] = Double.nan
        XCTAssertEqual(HealthExportCore.energy(value, allowed: Set(HealthExportCore.energyKeys)).map(\.key), ["basalKcal"])
        value = metrics; value["sampledAt"] = 0
        XCTAssertTrue(HealthExportCore.energy(value, allowed: Set(HealthExportCore.energyKeys)).isEmpty)
    }
    func testWorkoutAndAssociatedSamplesAdvanceOnCorrectionsAndRetries() {
        let version = HealthExportCore.version(now: 1000, previous: 1000)
        XCTAssertEqual(version, 1001)
        XCTAssertEqual(HealthExportCore.version(now: 900, previous: Double(version)), 1002)
        XCTAssertEqual(HealthExportCore.version(now: 2000, previous: Double(version)), 2000)
    }
    func testCleanupFindsBothEnergyTypesByExactSessionIdentifier() {
        XCTAssertEqual(HealthExportCore.energyIDs(["opengym-w-one", "opengym-w-two"]), [
            "opengym-w-one-activeKcal", "opengym-w-one-basalKcal", "opengym-w-two-activeKcal", "opengym-w-two-basalKcal",
        ])
    }
}
