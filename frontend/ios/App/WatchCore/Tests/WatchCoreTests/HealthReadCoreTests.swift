import XCTest
@testable import WatchCore

/// openGym v1.4.3: what the iPhone app hands to JS when it reads heart rate and weigh-ins back
/// from Apple Health.
final class HealthReadCoreTests: XCTestCase {
    func testSamplesInsideTheWindowOldestFirst() {
        let s = [HealthReadCore.HeartSample(ms: 15_000, bpm: 130), .init(ms: 9_000, bpm: 100), .init(ms: 20_000, bpm: 140), .init(ms: 1_000, bpm: 90)]
        XCTAssertEqual(HealthReadCore.samples(s, from: 5_000, to: 15_000), [[9_000, 100], [15_000, 130]])
    }

    func testImplausibleRatesAreLeftOut() {
        let s = [HealthReadCore.HeartSample(ms: 0, bpm: 10), .init(ms: 1, bpm: 300), .init(ms: 2, bpm: 25), .init(ms: 3, bpm: 250.4)]
        XCTAssertEqual(HealthReadCore.samples(s, from: 0, to: 10).map { $0[1] }, [25, 250])
    }

    func testOwnRecordsAreRecognised() {
        XCTAssertTrue(HealthReadCore.isOwn(source: "com.withings.wiscale2", syncId: "opengym-bw-2026-10-15"))
        XCTAssertTrue(HealthReadCore.isOwn(source: "ch.duartesantos.opengym", syncId: nil))
        XCTAssertTrue(HealthReadCore.isOwn(source: "ch.duartesantos.opengym.watchkitapp", syncId: nil))
        XCTAssertFalse(HealthReadCore.isOwn(source: "ch.duartesantos.opengymx", syncId: nil))
        XCTAssertFalse(HealthReadCore.isOwn(source: "com.garmin.connect.mobile", syncId: "abc"))
    }

    func testWeighInsLeaveOutOpenGymsOwn() {
        let out = HealthReadCore.weights([
            .init(ms: 2_000, kg: 80, id: "b", source: "ch.duartesantos.opengym", syncId: "opengym-bw-2026-10-15"),
            .init(ms: 1_000, kg: 81.25, id: "a", source: "com.withings.wiscale2", syncId: nil),
            .init(ms: 3_000, kg: 0, id: "c", source: "com.example", syncId: nil),
        ])
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0]["kg"] as? Double, 81.25)
        XCTAssertEqual(out[0]["origin"] as? String, "com.withings.wiscale2")
        XCTAssertNil(out[0]["clientId"])
    }
}
