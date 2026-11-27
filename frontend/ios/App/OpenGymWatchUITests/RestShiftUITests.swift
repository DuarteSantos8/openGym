import XCTest

/**
 * Taps the rest screen's -15 and +15 in the watch demo session (SessionStore's -OpenGymWatchDemo
 * -OpenGymWatchScreen rest) and checks the circle that shows the seconds added or taken off, right
 * of the countdown. Run by .github/workflows/ios.yml, which adds this target for the run only
 * (ios/ci/add-watch-ui-tests.rb).
 */
final class RestShiftUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", "rest"]
        app.launch()
    }

    /// The buttons carry the same "+15 s" label as the circle, so the circle is the static text.
    private func circle(_ label: String) -> XCUIElement { app.staticTexts[label] }

    private func tap(_ button: String) {
        let b = app.buttons[button]
        XCTAssertTrue(b.waitForExistence(timeout: 20), "the \(button) button did not show up")
        b.tap()
    }

    private func assertBesideCountdown(_ c: XCUIElement) {
        let countdown = app.staticTexts["Rest"].firstMatch
        XCTAssertTrue(countdown.waitForExistence(timeout: 5), "no countdown")
        XCTAssertGreaterThanOrEqual(c.frame.minX, countdown.frame.maxX - 1, "the circle is not right of the countdown")
        XCTAssertLessThan(abs(c.frame.midY - countdown.frame.midY), 20, "the circle is not level with the countdown")
    }

    func testPlus15ShowsACircleWithPlus15() {
        XCTAssertFalse(circle("+15 s").exists, "a circle showed before any tap")
        tap("+15 s")
        XCTAssertTrue(circle("+15 s").waitForExistence(timeout: 5), "+15 showed no circle")
        assertBesideCountdown(circle("+15 s"))
    }

    func testMinus15ShowsACircleWithMinus15() {
        XCTAssertFalse(circle("−15 s").exists, "a circle showed before any tap")
        tap("−15 s")
        XCTAssertTrue(circle("−15 s").waitForExistence(timeout: 5), "-15 showed no circle")
        assertBesideCountdown(circle("−15 s"))
    }

    func testPlusThenMinusTakesTheCircleAway() {
        tap("+15 s")
        XCTAssertTrue(circle("+15 s").waitForExistence(timeout: 5), "+15 showed no circle")
        tap("−15 s")
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: circle("+15 s"))
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the circle stayed at a net of zero")
        XCTAssertFalse(circle("−15 s").exists, "a -15 circle showed at a net of zero")
    }
}
