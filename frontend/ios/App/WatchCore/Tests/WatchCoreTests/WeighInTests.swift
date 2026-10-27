import XCTest
@testable import WatchCore

/// The weigh-in's crown in two parts: whole units, and the tenth on a tile of its own.
final class WeighInTests: XCTestCase {
    func testSplitsIntoWholeAndTenth() {
        XCTAssertEqual(WeighIn.parts(79.4).whole, 79)
        XCTAssertEqual(WeighIn.parts(79.4).tenth, 4)
        XCTAssertEqual(WeighIn.parts(80).tenth, 0)
        XCTAssertEqual(WeighIn.parts(79.95).whole, 80, "rounded to the tenth first")
        XCTAssertEqual(WeighIn.parts(79.95).tenth, 0)
        XCTAssertEqual(WeighIn.parts(0.3).whole, 0)
    }

    func testJoinsBackOnTheTenthsGrid() {
        XCTAssertEqual(WeighIn.join(whole: 79, tenth: 4), 79.4)
        XCTAssertEqual(WeighIn.join(whole: 80, tenth: 0), 80)
        XCTAssertEqual(WeighIn.join(whole: 79, tenth: 12), 79.9, "the tenth never carries over")
        let v = 72.3
        let p = WeighIn.parts(v)
        XCTAssertEqual(WeighIn.join(whole: p.whole, tenth: p.tenth), v)
    }

    func testTheCrownRangesAreUnchanged() {
        XCTAssertEqual(WeighIn.wholes(unit: "kg"), 20...320)
        XCTAssertEqual(WeighIn.wholes(unit: "lb"), 20...700)
    }

    func testNudgeMovesOneTenth() {
        XCTAssertEqual(WeighIn.nudged(79.4, up: true, unit: "kg"), 79.5)
        XCTAssertEqual(WeighIn.nudged(79.4, up: false, unit: "kg"), 79.3)
    }

    func testNudgeCarriesOverTheWholeUnit() {
        XCTAssertEqual(WeighIn.nudged(79.9, up: true, unit: "kg"), 80.0)
        XCTAssertEqual(WeighIn.nudged(80.0, up: false, unit: "kg"), 79.9)
    }

    func testNudgeStopsWhereTheCrownStops() {
        XCTAssertEqual(WeighIn.nudged(20.0, up: false, unit: "kg"), 20.0)
        XCTAssertEqual(WeighIn.nudged(320.9, up: true, unit: "kg"), 320.9)
        XCTAssertEqual(WeighIn.nudged(700.9, up: true, unit: "lb"), 700.9)
        XCTAssertEqual(WeighIn.nudged(5, up: true, unit: "kg"), 20.0, "pulled inside first")
        XCTAssertEqual(WeighIn.nudged(400, up: false, unit: "kg"), 320.9)
    }

    func testNudgeStaysOnTheGrid() {
        XCTAssertEqual(WeighIn.nudged(72.3, up: true, unit: "kg"), 72.4)
        var v = 20.0
        for _ in 0..<80 { v = WeighIn.nudged(v, up: true, unit: "kg") }
        XCTAssertEqual(v, 28.0)
    }

    func testTheTopOfTheRangeSplits() {
        XCTAssertEqual(WeighIn.parts(320.9).whole, 320)
        XCTAssertEqual(WeighIn.parts(320.9).tenth, 9)
        XCTAssertEqual(WeighIn.join(whole: 320, tenth: 9), 320.9)
    }
}
