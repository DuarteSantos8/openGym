import XCTest
@testable import WatchCore

/// "Ready" during a rest: once the heart rate is back down, the watch says so (docs/dev/REST_BY_HEART_RATE.md).
/// The Wear OS twin has these cases in WatchLogicTest.kt.
final class RestReadinessTests: XCTestCase {
    let start = Date(timeIntervalSince1970: 1_000_000)

    func at(_ s: TimeInterval) -> Date { start.addingTimeInterval(s) }

    /// Readings every `every` seconds from `from`, one value each.
    func readings(_ values: [Double], from: TimeInterval = 0, every: TimeInterval = 5) -> [(Date, Double)] {
        values.enumerated().map { (at(from + Double($0.offset) * every), $0.element) }
    }

    func testReadsThePhonesSettingAsItSendsIt() throws {
        let json = #"{"restHaptics":true,"hrRest":{"on":true,"bpm":null}}"#
        let s = try JSONDecoder().decode(WatchSettings.self, from: Data(json.utf8))
        XCTAssertEqual(s.hrRest, HrRestSettings(on: true, bpm: nil))
        XCTAssertNil(try JSONDecoder().decode(WatchSettings.self, from: Data("{}".utf8)).hrRest)
    }

    func testOffOrMissingMakesNoTarget() {
        XCTAssertNil(RestReadiness.target(settings: nil, startHr: 90, peak: 150))
        XCTAssertNil(RestReadiness.target(settings: HrRestSettings(on: false, bpm: 120), startHr: 90, peak: 150))
        XCTAssertNil(RestReadiness.target(settings: HrRestSettings(on: nil, bpm: 120), startHr: 90, peak: 150))
    }

    func testAFixedTargetIsTakenAsItIs() {
        XCTAssertEqual(RestReadiness.target(settings: HrRestSettings(on: true, bpm: 110), startHr: nil, peak: nil), 110)
        // nonsense from the phone is no fixed target: automatic
        XCTAssertEqual(RestReadiness.target(settings: HrRestSettings(on: true, bpm: 0), startHr: 90, peak: 150), 105)
    }

    func testAutomaticIsAQuarterOfTheWayBackUpFromTheSetsStart() {
        let auto = HrRestSettings(on: true, bpm: nil)
        XCTAssertEqual(RestReadiness.target(settings: auto, startHr: 90, peak: 150), 105)
        // a set that hardly raised the pulse: still a few beats above where it started
        XCTAssertEqual(RestReadiness.target(settings: auto, startHr: 90, peak: 96), 95)
        XCTAssertEqual(RestReadiness.target(settings: auto, startHr: 90, peak: 80), 95)
        XCTAssertEqual(RestReadiness.target(settings: auto, startHr: 90, peak: nil), 95)
        // nothing measured before the set: nothing to go by
        XCTAssertNil(RestReadiness.target(settings: auto, startHr: nil, peak: 150))
    }

    func testAutomaticTakesTheMinuteBeforeTheSetAndThePeakDuringIt() {
        let auto = HrRestSettings(on: true, bpm: nil)
        // 80 long before, 90 and 92 in the minute before the set (which began at 0), 150 at its top, 160 after it
        let all = [(at(-200), 80.0), (at(-50), 90), (at(-10), 92), (at(0), 0), (at(10), 120), (at(25), 150), (at(40), 160)]
        // start 91, peak 150: 91 + 0.25 * 59
        XCTAssertEqual(RestReadiness.target(settings: auto, readings: all, setStart: at(0), setEnd: at(30))!, 105.75, accuracy: 1e-9)
        XCTAssertEqual(RestReadiness.target(settings: HrRestSettings(on: true, bpm: 120), readings: [], setStart: at(0), setEnd: at(30)), 120)
        // nothing in the minute before: no target
        XCTAssertNil(RestReadiness.target(settings: auto, readings: [(at(-200), 80), (at(10), 120)], setStart: at(0), setEnd: at(30)))
        XCTAssertNil(RestReadiness.target(settings: nil, readings: all, setStart: at(0), setEnd: at(30)))
    }

    func testNeverBeforeTheFloor() {
        let low = readings([100, 100, 100, 100, 100, 100], from: 0)
        XCTAssertFalse(RestReadiness.evaluate(readings: low, restStart: start, now: at(25), target: 120).ready)
        XCTAssertTrue(RestReadiness.evaluate(readings: low, restStart: start, now: at(30), target: 120).ready)
    }

    func testAnOldReadingSaysNothingAboutNow() {
        let low = readings([100, 100, 100, 100], from: 0)
        let r = RestReadiness.evaluate(readings: low, restStart: start, now: at(40), target: 120)
        XCTAssertFalse(r.ready)
        XCTAssertNil(r.since)
    }

    func testOneDipUnderTheTargetIsNotReady() {
        let dip = readings([140, 130, 118, 125, 128, 126, 124], from: 0)
        let r = RestReadiness.evaluate(readings: dip, restStart: start, now: at(31), target: 120)
        XCTAssertFalse(r.ready)
        XCTAssertNil(r.since)
    }

    func testTheRunUnderTheTargetMustLastTheHold() {
        // under at 27 s and 30 s: three seconds, not five
        let short = readings([140, 130, 126, 124, 122], from: 0, every: 6) + [(at(27), 119), (at(30), 117)]
        XCTAssertFalse(RestReadiness.evaluate(readings: short, restStart: start, now: at(31), target: 120).ready)
        // and once more at 33 s: six seconds, ready, since the first one under
        let held = short + [(at(33), 116)]
        let r = RestReadiness.evaluate(readings: held, restStart: start, now: at(34), target: 120)
        XCTAssertTrue(r.ready)
        XCTAssertEqual(r.since, at(27))
    }

    func testAReadingAboveTheTargetStartsTheRunAgain() {
        let back = [(at(20), 118.0), (at(26), 117), (at(29), 123), (at(31), 118), (at(34), 117)]
        let r = RestReadiness.evaluate(readings: back, restStart: start, now: at(35), target: 120)
        XCTAssertFalse(r.ready)
        XCTAssertEqual(r.since, at(31))
    }

    func testAtTheTargetCountsAsUnder() {
        let r = RestReadiness.evaluate(readings: readings([140, 120, 120, 120], from: 20), restStart: start, now: at(36), target: 120)
        XCTAssertTrue(r.ready)
        XCTAssertEqual(r.since, at(25))
    }

    func testReadingsFromBeforeTheRestDoNotCount() {
        // low before the rest began, then one reading in it: the run starts with the rest, not before
        let mixed = readings([100, 100], from: -10) + [(at(31), 100)]
        let r = RestReadiness.evaluate(readings: mixed, restStart: start, now: at(32), target: 120)
        XCTAssertFalse(r.ready)
        XCTAssertEqual(r.since, at(31))
    }

    func testAZeroIsNoReading() {
        // a zero at the end is not a pulse back down; the run before it still stands
        let z = readings([100, 100, 100], from: 25) + [(at(36), 0)]
        let r = RestReadiness.evaluate(readings: z, restStart: start, now: at(37), target: 120)
        XCTAssertTrue(r.ready)
        XCTAssertEqual(r.since, at(25))
        XCTAssertFalse(RestReadiness.evaluate(readings: [(at(30), 0), (at(36), 0)], restStart: start, now: at(37), target: 120).ready)
    }

    func testOrderDoesNotMatter() {
        let r = RestReadiness.evaluate(readings: [(at(36), 110), (at(30), 112)], restStart: start, now: at(37), target: 120)
        XCTAssertTrue(r.ready)
        XCTAssertEqual(r.since, at(30))
    }
}
