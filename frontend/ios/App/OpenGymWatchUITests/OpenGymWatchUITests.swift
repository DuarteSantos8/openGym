import XCTest

/**
 * Taps the Apple Watch app's controls in a watch simulator, on the demo session CI's screenshots use
 * (SessionStore.startDemo, launched with -OpenGymWatchDemo -OpenGymWatchScreen <screen>): a control
 * that looks right in a screenshot can still take no tap (a hit area that is too small, a layer over
 * it). Every new tappable control gets a tap here and an assert on what it changes. Run by
 * .github/workflows/ios.yml, which adds this target to the project for the run only
 * (ios/ci/add-watch-ui-tests.rb).
 */
final class OpenGymWatchUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ screen: String, _ extra: [String] = []) {
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", screen] + extra
        app.launch()
    }

    private func element(_ type: XCUIElement.ElementType, containing text: String) -> XCUIElement {
        app.descendants(matching: type).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    /// Only the set menu has Add set (the page's own Done button is under it).
    private var addSetButton: XCUIElement { element(.button, containing: "Add set") }

    private func assertMenuClosed() {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: addSetButton)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "the set menu stayed open")
    }

    private func tap(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 15) {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "\(what) did not show up")
        e.tap()
    }

    /// The set page's pill ("2/3", read as "Set 2 of 3, Failure") opens the set menu. Taps are ignored
    /// for a second after it opens (SessionStore.lockTouches), so the menu's own controls wait that out.
    private func openSetMenu() {
        launch("set-failure")
        tap(element(.button, containing: "Set 2 of"), "the set pill")
        XCTAssertTrue(addSetButton.waitForExistence(timeout: 5), "the set menu did not open")
        Thread.sleep(forTimeInterval: 1.5)
    }

    func testSetMenuWarmupMark() {
        openSetMenu()
        tap(app.buttons["Warm-up"].firstMatch, "the Warm-up disc")
        // The menu closes and the set's pill now names the mark.
        assertMenuClosed()
        XCTAssertTrue(element(.button, containing: "Warm-up").waitForExistence(timeout: 5), "the set was not marked as a warm-up")
    }

    func testSetMenuAddSet() {
        openSetMenu()
        tap(addSetButton, "Add set")
        // "Set N added" over the page, and the menu closed.
        XCTAssertTrue(element(.any, containing: "added").waitForExistence(timeout: 5), "no set was added")
        assertMenuClosed()
    }
}
