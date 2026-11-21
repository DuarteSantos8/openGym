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

    /* ---------- the effort rating (RIR, in half steps) ---------- */

    /// The armed capsule is one adjustable element ("Effort", valued "RIR 1.5"); its − and + discs are
    /// drawn inside it and hidden from VoiceOver, so they are tapped by where they sit: the − disc at the
    /// left end, + at the right. The settled capsule ("RIR 1.5 ✓") is a button of the same name.
    private var armed: XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Effort' AND elementType != %d", XCUIElement.ElementType.button.rawValue)).firstMatch }
    private var settled: XCUIElement { app.buttons["Effort"] }

    private func assertArmed(_ value: String, _ what: String) {
        XCTAssertTrue(armed.waitForExistence(timeout: 5), "\(what): the capsule is not armed")
        let ok = NSPredicate(format: "value == %@", value)
        XCTAssertEqual(XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: ok, object: armed)], timeout: 5), .completed,
                       "\(what): the capsule reads \(String(describing: armed.value)), not \(value)")
    }

    private func tapDisc(plus: Bool) {
        Thread.sleep(forTimeInterval: 1.2) // taps are ignored for a second after the capsule arms (TouchLock)
        armed.coordinate(withNormalizedOffset: CGVector(dx: plus ? 0.93 : 0.07, dy: 0.5)).tap()
    }

    func testRestChipArmsTheCapsuleAndHalvesMove() {
        launch("effort")
        tap(app.buttons["RIR 1"], "the RIR 1 chip")
        assertArmed("RIR 1", "after the chip")
        tapDisc(plus: true)
        assertArmed("RIR 1.5", "after +")
        tapDisc(plus: false)
        assertArmed("RIR 1", "after -")
        tapDisc(plus: true)
        assertArmed("RIR 1.5", "after + again")
        // Five seconds on, it settles to the full-width "RIR 1.5 ✓", and a tap arms it again.
        XCTAssertTrue(settled.waitForExistence(timeout: 12), "the capsule did not settle")
        XCTAssertEqual(settled.value as? String, "RIR 1.5")
        XCTAssertGreaterThan(settled.frame.width, app.frame.width * 0.8, "the settled capsule is not full width")
        settled.tap()
        assertArmed("RIR 1.5", "after a tap on the settled capsule")
    }

    func testFixViewPillArmsOnTap() {
        launch("fix", ["-OpenGymWatchRated", "2"])
        XCTAssertTrue(settled.waitForExistence(timeout: 15), "the fix view shows no rating pill")
        XCTAssertEqual(settled.value as? String, "RIR 2")
        settled.tap()
        assertArmed("RIR 2", "after the tap")
        tapDisc(plus: true)
        assertArmed("RIR 2.5", "after + in the fix view")
    }
}
