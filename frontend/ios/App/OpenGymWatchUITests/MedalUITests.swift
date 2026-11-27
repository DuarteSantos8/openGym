import XCTest

/**
 * Taps the medal summary (Watch/SummaryMedal.swift) in a watch simulator, on the demo session CI's
 * screenshots use: it shows after Finish, a swipe turns it on to the record bars and Done, and Done
 * closes it. The Crown cannot be turned from a test; its stops are the same ones a swipe moves.
 * Run by .github/workflows/ios.yml (ios/ci/add-watch-ui-tests.rb adds this target for the run only).
 */
final class MedalUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ screen: String) {
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", screen]
        app.launch()
    }

    private func element(_ type: XCUIElement.ElementType, containing text: String) -> XCUIElement {
        app.descendants(matching: type).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private var medal: XCUIElement { element(.any, containing: "Workout saved") }
    private var done: XCUIElement { app.buttons["Done"].firstMatch }
    /// On the front Done sits in the tree below the screen, not on the glass (isHittable throws there).
    private var doneOnGlass: Bool { done.exists && app.frame.contains(CGPoint(x: done.frame.midX, y: done.frame.midY)) }

    private func wait(_ failure: String, timeout: TimeInterval = 10, until met: @escaping () -> Bool) {
        let e = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in met() }, object: app)
        XCTAssertEqual(XCTWaiter().wait(for: [e], timeout: timeout), .completed, failure)
    }

    func testMedalShowsAfterFinish() {
        launch("finish")
        let finish = element(.button, containing: "Finish workout")
        XCTAssertTrue(finish.waitForExistence(timeout: 15), "the Overview has no Finish")
        // Finish is held for a second (HoldToFinish); it may be below the first screenful.
        for _ in 0..<6 where !finish.isHittable { app.swipeUp() }
        XCTAssertFalse(medal.exists, "the medal was up before Finish")
        finish.press(forDuration: 1.5)
        XCTAssertTrue(medal.waitForExistence(timeout: 10), "no medal after Finish")
    }

    func testSwipeTurnsMedalToDone() {
        launch("summary")
        XCTAssertTrue(medal.waitForExistence(timeout: 15), "the medal did not show up")
        XCTAssertFalse(doneOnGlass, "Done was on the glass before the medal was turned")
        // One swipe is one stop: the back, home with the record bars, then a page down to Done.
        for _ in 0..<4 where !doneOnGlass { app.swipeUp() }
        wait("swiping did not scroll the medal to Done") { self.doneOnGlass }
    }

    func testDoneClosesMedal() {
        launch("summary-end")
        wait("Done did not show up", timeout: 15) { self.doneOnGlass }
        done.tap()
        wait("the medal stayed after Done") { !self.medal.exists }
        // The workout the demo summary sits over is back on its set page.
        XCTAssertTrue(element(.button, containing: "Set 1 of").waitForExistence(timeout: 5), "Done did not go back to the workout")
    }
}
