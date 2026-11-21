import XCTest

/**
 * Taps the keypad's ✓ and ✕ by their edge, not their glyph (1.4.5, owner: glass draws no hit area,
 * so only the checkmark and the cross took a tap). Launched on the demo's keypad screen
 * (SessionStore: -OpenGymWatchScreen keypad opens the weight keypad).
 */
final class KeypadUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", "keypad"]
        app.launch()
    }

    private var save: XCUIElement { app.buttons["Save"] }
    private var cancel: XCUIElement { app.buttons["Cancel"] }

    /// A tap near the left edge of the control, inside its shape and well away from the glyph in the middle.
    private func tapEdge(_ e: XCUIElement, _ what: String) {
        XCTAssertTrue(e.waitForExistence(timeout: 15), "\(what) did not show up")
        e.coordinate(withNormalizedOffset: CGVector(dx: 0.12, dy: 0.5)).tap()
    }

    private func assertKeypadClosed() {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: save)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the keypad stayed open")
    }

    private func type(_ keys: String...) {
        for k in keys { app.buttons[k].firstMatch.tap() }
    }

    func testCheckEdgeSavesTheTypedNumber() {
        XCTAssertTrue(save.waitForExistence(timeout: 15), "the keypad did not open")
        type("7", "7")
        tapEdge(save, "the check")
        assertKeypadClosed()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "77", "77")).firstMatch.waitForExistence(timeout: 5), "77 was not saved")
    }

    func testCheckEdgeWithNothingTypedAnswers() {
        XCTAssertTrue(save.waitForExistence(timeout: 15), "the keypad did not open")
        tapEdge(save, "the check")
        assertKeypadClosed()
    }

    func testCrossEdgeCancels() {
        XCTAssertTrue(cancel.waitForExistence(timeout: 15), "the keypad did not open")
        type("7", "7")
        tapEdge(cancel, "the cross")
        assertKeypadClosed()
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "77", "77")).firstMatch.exists, "the typed number was saved")
    }
}
