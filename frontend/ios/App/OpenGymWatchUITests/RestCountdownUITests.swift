import XCTest

/**
 * The rest's last three seconds tap the wrist (SessionStore.startRest). A simulator has no wrist and
 * the demo session plays no haptics, so the taps themselves cannot be tested here. What can: a rest
 * that reaches those three seconds still runs out cleanly, and the set page comes back with the app
 * alive. Launched on the demo's rest screen with a short rest (-OpenGymWatchRestSeconds).
 */
final class RestCountdownUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    func testRestRunsOutToTheSetPage() {
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", "rest", "-OpenGymWatchRestSeconds", "8"]
        app.launch()
        let skip = app.buttons["Skip"].firstMatch
        XCTAssertTrue(skip.waitForExistence(timeout: 15), "the rest page did not show up")
        // Skip is on the rest page only: it goes when the rest runs out, taps at 3, 2 and 1 included.
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: skip)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 20), .completed, "the rest never ended")
        XCTAssertEqual(app.state, .runningForeground, "the app stopped when the rest ended")
        let setPill = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Set ")).firstMatch
        XCTAssertTrue(setPill.waitForExistence(timeout: 10), "the set page did not come back")
    }
}
