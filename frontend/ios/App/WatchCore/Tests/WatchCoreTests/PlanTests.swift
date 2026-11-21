import XCTest
@testable import WatchCore

/// The start screen's size line and the phone's accent colour.
final class PlanTests: XCTestCase {
    func row(warmup: Bool = false, sides: Bool = false) -> SetRow {
        SetRow(w: 50, r: 8, sec: nil, done: false, warmup: warmup, at: nil,
               sides: sides ? Sides(L: SideRow(w: 20, r: 8, done: false), R: SideRow(w: 20, r: 8, done: false)) : nil)
    }

    func entry(_ id: String, _ sets: [SetRow]) -> Entry {
        Entry(id: id, name: id, mode: "reps", restSec: nil, last: nil, sets: sets)
    }

    func testCountsWorkSetsNotWarmupsAndAPerSideSetOnce() {
        let size = Plan.size([
            entry("bench", [row(warmup: true), row(), row(), row()]),
            entry("split", [row(sides: true), row(sides: true)]),
            entry("empty", []),
        ])
        XCTAssertEqual(size.exercises, 2, "an exercise without sets is not one to do")
        XCTAssertEqual(size.sets, 5)
    }

    func testNothingPlannedIsZero() {
        XCTAssertEqual(Plan.size([]).exercises, 0)
        XCTAssertEqual(Plan.size([]).sets, 0)
    }

    func testReadsTheAccentAndRefusesAnythingElse() throws {
        let c = try XCTUnwrap(Hex.rgb("#30d158"))
        XCTAssertEqual(c.r, 0x30 / 255, accuracy: 0.0001)
        XCTAssertEqual(c.g, 0xd1 / 255, accuracy: 0.0001)
        XCTAssertEqual(c.b, 0x58 / 255, accuracy: 0.0001)
        XCTAssertNil(Hex.rgb(nil))
        XCTAssertNil(Hex.rgb("green"))
        XCTAssertNil(Hex.rgb("#30d15"))
        XCTAssertNil(Hex.rgb("#zzzzzz"))
    }
}
