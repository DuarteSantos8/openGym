import XCTest
@testable import CueAudioCore

/// The locked iPhone's rest end (#1393): the end tone, a short gap, then the spoken line, in one
/// file the notification plays. A notification sound may not pass 30 seconds.
final class RestLineMixTests: XCTestCase {
    private let rate = 100
    private let tone = [Int16](repeating: 1, count: 50)
    private let line = [Int16](repeating: 2, count: 200)

    func testToneGapLine() {
        let out = RestLineMix.join(tone: tone, line: line, rate: rate, gapSec: 0.15)
        XCTAssertEqual(out.count, 50 + 15 + 200)
        XCTAssertEqual(Array(out[0..<50]), tone)
        XCTAssertTrue(out[50..<65].allSatisfy { $0 == 0 })
        XCTAssertEqual(Array(out[65...]), line)
    }

    func testTooLongKeepsTheToneAlone() {
        // 50 + 15 + 200 frames is 2.65 s at 100 Hz: over a 2 s limit, the line is dropped whole.
        XCTAssertEqual(RestLineMix.join(tone: tone, line: line, rate: rate, maxSec: 2), tone)
    }

    func testNoToneIsTheLineAlone() {
        XCTAssertEqual(RestLineMix.join(tone: [], line: line, rate: rate), line)
    }

    func testNoLineIsTheToneAsItIs() {
        XCTAssertEqual(RestLineMix.join(tone: tone, line: [], rate: rate), tone)
    }
}
