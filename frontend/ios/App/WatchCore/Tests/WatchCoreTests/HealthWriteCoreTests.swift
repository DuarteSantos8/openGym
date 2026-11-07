import XCTest
@testable import WatchCore

/// openGym v1.4.5 (TestFlight 59): every value HealthKit would raise an uncatchable exception for,
/// and every number that would trap in Swift, is turned away before it gets there.
final class HealthWriteCoreTests: XCTestCase {
    let now: Double = 1_793_000_000_000            // 2026-10-26
    let hour: Double = 3_600_000

    private func verdict(_ start: Double?, _ end: Double?, id: String? = "opengym-w-1") -> HealthWriteCore.Verdict {
        HealthWriteCore.session(id: id, start: start, end: end, now: now)
    }

    func testAnOrdinaryWorkoutIsWrittenWithItsCalories() {
        XCTAssertEqual(verdict(now - 2 * hour, now - hour), .write(energy: true))
    }

    func testAForgottenWorkoutIsWrittenWithoutCalories() {
        // The owner's case: a workout left open for more than a day.
        XCTAssertEqual(verdict(now - 30 * hour, now), .write(energy: false))
        XCTAssertEqual(verdict(now - 24 * hour, now), .write(energy: true))
        XCTAssertEqual(verdict(now - 24 * hour - 1, now), .write(energy: false))
        XCTAssertEqual(verdict(now - 7 * 24 * hour, now), .write(energy: false))
    }

    func testAWorkoutOverAWeekIsNotWritten() {
        XCTAssertEqual(verdict(now - 7 * 24 * hour - 1, now), .skip("longer than 7 days"))
    }

    func testMissingAndEmptyIds() {
        XCTAssertEqual(verdict(now - hour, now, id: nil), .skip("no id"))
        XCTAssertEqual(verdict(now - hour, now, id: ""), .skip("no id"))
    }

    func testMissingTimes() {
        XCTAssertEqual(verdict(nil, now), .skip("no start or end"))
        XCTAssertEqual(verdict(now, nil), .skip("no start or end"))
    }

    func testNaNInfinityAndNegativeTimes() {
        for bad in [Double.nan, .infinity, -.infinity, -1, 0, -now] {
            XCTAssertEqual(verdict(bad, now), .skip("time out of range"), "start \(bad)")
            XCTAssertEqual(verdict(now - hour, bad), .skip("time out of range"), "end \(bad)")
        }
    }

    func testBefore2001() {
        let y2000 = HealthWriteCore.epochMs - 86_400_000
        XCTAssertEqual(verdict(y2000, y2000 + hour), .skip("time out of range"))
        XCTAssertEqual(verdict(HealthWriteCore.epochMs, HealthWriteCore.epochMs + hour), .write(energy: true))
    }

    func testFarFutureAndHugeTimes() {
        XCTAssertEqual(verdict(now + 2 * 24 * hour, now + 2 * 24 * hour + hour), .skip("time out of range"))
        XCTAssertEqual(verdict(now - hour, 1e300), .skip("time out of range"))
        XCTAssertEqual(verdict(now - hour, Double.greatestFiniteMagnitude), .skip("time out of range"))
        // Another phone's clock a few minutes ahead is fine.
        XCTAssertEqual(verdict(now, now + 10 * 60_000), .write(energy: true))
    }

    func testEndNotAfterStart() {
        XCTAssertEqual(verdict(now, now), .skip("end not after start"))
        XCTAssertEqual(verdict(now, now - 1), .skip("end not after start"))
    }

    func testCalories() {
        XCTAssertEqual(HealthWriteCore.kcal(350), 350)
        XCTAssertEqual(HealthWriteCore.kcal(20_000), 20_000)
        for bad in [nil, Double.nan, .infinity, -.infinity, 0, -5, 20_001, 1e12] as [Double?] {
            XCTAssertNil(HealthWriteCore.kcal(bad), "\(String(describing: bad))")
        }
    }

    func testWeighIns() {
        XCTAssertTrue(HealthWriteCore.weight(id: "opengym-bw-2026-10-26", time: now, kg: 81.4, now: now))
        XCTAssertTrue(HealthWriteCore.weight(id: "a", time: now, kg: 999.9, now: now))
        for kg in [0, -1, 1000, 1500, Double.nan, .infinity] {
            XCTAssertFalse(HealthWriteCore.weight(id: "a", time: now, kg: kg, now: now), "kg \(kg)")
        }
        XCTAssertFalse(HealthWriteCore.weight(id: "", time: now, kg: 80, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: nil, time: now, kg: 80, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: "a", time: nil, kg: 80, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: "a", time: now, kg: nil, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: "a", time: .nan, kg: 80, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: "a", time: 0, kg: 80, now: now))
        XCTAssertFalse(HealthWriteCore.weight(id: "a", time: now + 3 * 24 * hour, kg: 80, now: now))
    }

    func testSpanAgainstTheTypesLimits() {
        XCTAssertTrue(HealthWriteCore.spanFits(3600, min: nil, max: nil))
        XCTAssertTrue(HealthWriteCore.spanFits(0, min: nil, max: nil))
        XCTAssertFalse(HealthWriteCore.spanFits(-1, min: nil, max: nil))
        XCTAssertFalse(HealthWriteCore.spanFits(.nan, min: nil, max: nil))
        XCTAssertFalse(HealthWriteCore.spanFits(.infinity, min: nil, max: nil))
        XCTAssertFalse(HealthWriteCore.spanFits(86_401, min: nil, max: 86_400))
        XCTAssertTrue(HealthWriteCore.spanFits(86_400, min: nil, max: 86_400))
        XCTAssertFalse(HealthWriteCore.spanFits(0.5, min: 1, max: nil))
    }

    func testLiveEndNeverBeforeStartNorAhead() {
        let n = Date(timeIntervalSince1970: now / 1000)
        let start = n.addingTimeInterval(-3600)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: nil, start: start, now: n), n)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: n.addingTimeInterval(-60), start: start, now: n), n.addingTimeInterval(-60))
        // Before its start: at its start. In the future (another clock): now.
        XCTAssertEqual(HealthWriteCore.liveEnd(at: start.addingTimeInterval(-600), start: start, now: n), start)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: n.addingTimeInterval(86_400 * 400), start: start, now: n), n)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: Date(timeIntervalSince1970: .nan), start: start, now: n), n)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: Date(timeIntervalSince1970: .infinity), start: start, now: n), n)
        XCTAssertEqual(HealthWriteCore.liveEnd(at: n.addingTimeInterval(-60), start: nil, now: n), n.addingTimeInterval(-60))
    }

    func testIntNeverTraps() {
        XCTAssertEqual(SafeNum.int(.nan), 0)
        XCTAssertEqual(SafeNum.int(.infinity), Int.max)
        XCTAssertEqual(SafeNum.int(-.infinity), Int.min)
        XCTAssertEqual(SafeNum.int(1e20), Int.max)
        XCTAssertEqual(SafeNum.int(-1e20), Int.min)
        XCTAssertEqual(SafeNum.int(62.9), 62)
        XCTAssertEqual(SafeNum.int(-3.5), -3)
        XCTAssertEqual(SafeNum.rounded(62.5), 63)
        XCTAssertEqual(SafeNum.rounded(.nan), 0)
        XCTAssertEqual(SafeNum.finite(.nan, or: 1), 1)
        XCTAssertEqual(SafeNum.finite(nil, or: 1), 1)
        XCTAssertEqual(SafeNum.finite(2, or: 1), 2)
    }

    func testDates() {
        XCTAssertEqual(SafeNum.date(ms: now)?.timeIntervalSince1970, now / 1000)
        for bad in [nil, Double.nan, .infinity, -1, 1e20] as [Double?] { XCTAssertNil(SafeNum.date(ms: bad)) }
    }

    func testTimerRangeNeverTraps() {
        let n = Date(timeIntervalSince1970: now / 1000)
        XCTAssertEqual(SafeNum.timerRange(n, n.addingTimeInterval(60), now: n), n...n.addingTimeInterval(60))
        XCTAssertEqual(SafeNum.timerRange(n.addingTimeInterval(60), n, now: n), n...n)
        XCTAssertEqual(SafeNum.timerRange(Date(timeIntervalSince1970: .nan), n, now: n), n...n)
        XCTAssertEqual(SafeNum.timerRange(n, Date(timeIntervalSince1970: .infinity), now: n), n...n)
    }

    func testJSONThatIsNotJSONIsNilNotACrash() {
        XCTAssertNotNil(SafeJSON.data(["a": 1, "b": [1.5, "x"]]))
        XCTAssertNil(SafeJSON.data(["a": Double.nan]))
        XCTAssertNil(SafeJSON.data(["a": Double.infinity]))
        XCTAssertNil(SafeJSON.data(["a": Date()]))
        XCTAssertNil(SafeJSON.data("not a container"))
    }
}
