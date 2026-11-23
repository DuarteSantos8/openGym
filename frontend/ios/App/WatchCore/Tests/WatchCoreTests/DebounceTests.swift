import XCTest
@testable import WatchCore

/// The complications' reloads (Debounce): the calls of one set collapse into one reload.
final class DebounceTests: XCTestCase {
    func testCallsCloseTogetherRunOnceWithTheLastOne() {
        let d = Debounce(after: 0.05)
        var ran: [Int] = []
        let done = expectation(description: "ran")
        for i in 1...4 { d.call { ran.append(i); done.fulfill() } }
        wait(for: [done], timeout: 2)
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(ran, [4], "four changes of one set: one reload")
    }

    func testCallsFarApartEachRun() {
        let d = Debounce(after: 0.02)
        var count = 0
        for _ in 1...2 {
            let done = expectation(description: "ran")
            d.call { count += 1; done.fulfill() }
            wait(for: [done], timeout: 2)
        }
        XCTAssertEqual(count, 2, "a later set reloads again")
    }
}
