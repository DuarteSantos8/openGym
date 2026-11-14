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
}
