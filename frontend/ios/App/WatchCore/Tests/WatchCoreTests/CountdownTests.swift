import XCTest
@testable import WatchCore

/// The 3-2-1 before a workout started on the watch.
final class CountdownTests: XCTestCase {
    func testCountsThreeTwoOneThenGo() {
        XCTAssertEqual(Countdown.number(at: 0), 3)
        XCTAssertEqual(Countdown.number(at: 0.99), 3)
        XCTAssertEqual(Countdown.number(at: 1), 2)
        XCTAssertEqual(Countdown.number(at: 2.5), 1)
        XCTAssertEqual(Countdown.number(at: 3), 0)
        XCTAssertEqual(Countdown.number(at: 60), 0, "never below go")
        XCTAssertEqual(Countdown.number(at: -1), 3, "a clock a moment behind still shows 3")
    }

    func testFaceIsTheNumberUntilTheWorkoutBegins() {
        XCTAssertEqual(Countdown.face(at: 0, going: false), .number(3))
        XCTAssertEqual(Countdown.face(at: 0.99, going: false), .number(3))
        XCTAssertEqual(Countdown.face(at: 1, going: false), .number(2))
        XCTAssertEqual(Countdown.face(at: 2.5, going: false), .number(1))
        XCTAssertEqual(Countdown.face(at: 3, going: false), .number(1), "never a 0")
        XCTAssertEqual(Countdown.face(at: 60, going: false), .number(1), "never a 0")
        XCTAssertEqual(Countdown.face(at: -1, going: false), .number(3))
    }

    func testFaceIsGoOnceTheWorkoutBegan() {
        XCTAssertEqual(Countdown.face(at: 3.02, going: true), .go)
        XCTAssertEqual(Countdown.face(at: 1.2, going: true), .go, "a tap that starts early gets GO! too")
        XCTAssertEqual(Countdown.face(at: 0, going: true), .go)
    }

    func testGoHoldsAboutHalfASecond() {
        XCTAssertTrue((0.5...0.7).contains(Countdown.goSeconds))
    }

    func testGoRingSweepsFullThenWaves() {
        XCTAssertEqual(Countdown.goRing(at: 0).sweep, 0)
        XCTAssertNil(Countdown.goRing(at: 0).wave)
        XCTAssertTrue((0.8...1).contains(Countdown.goRing(at: 0.14).sweep))
        XCTAssertEqual(Countdown.goRing(at: 0.28).sweep, 1)
        XCTAssertNil(Countdown.goRing(at: 0.1).wave)
        let w = try! XCTUnwrap(Countdown.goRing(at: 0.38).wave)
        XCTAssertTrue(w > 0 && w < 1)
        var last = 0.0
        for i in 0...60 {
            let s = Countdown.goRing(at: Double(i) / 100).sweep
            XCTAssertGreaterThanOrEqual(s, last)
            last = s
        }
    }

    func testGoRingIsDoneBeforeTheHoldEnds() {
        let r = Countdown.goRing(at: Countdown.goSeconds)
        XCTAssertNil(r.wave)
        XCTAssertEqual(r.sweep, 1)
    }

    func testGoRingStillWhenAsked() {
        let still = Countdown.goRing(at: .infinity)
        XCTAssertEqual(still.sweep, 1)
        XCTAssertNil(still.wave)
        let before = Countdown.goRing(at: -1)
        XCTAssertEqual(before.sweep, 0)
        XCTAssertNil(before.wave)
    }
}
