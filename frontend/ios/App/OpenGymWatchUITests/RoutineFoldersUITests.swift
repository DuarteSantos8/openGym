import XCTest

/**
 * Taps the start screen's routines under the phone's folders (SessionStore.demoFoldersJSON, launched
 * with -OpenGymWatchDemo -OpenGymWatchScreen folders). A folder is a header, not a button: what is
 * tapped is the routine under it. Run by .github/workflows/ios.yml (ios/ci/add-watch-ui-tests.rb).
 */
final class RoutineFoldersUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", "folders"]
        app.launch()
    }

    func testFoldersListTheirRoutines() {
        XCTAssertTrue(app.staticTexts["Upper"].waitForExistence(timeout: 15), "no Upper folder header")
        XCTAssertTrue(app.buttons["Pull day"].exists, "Pull day is not listed under Upper")
        XCTAssertTrue(app.staticTexts["Lower"].exists, "no Lower folder header")
        XCTAssertTrue(app.buttons["Legs"].exists, "Legs is not listed under Lower")
    }

    func testRoutineUnderFolderStarts() {
        let row = app.buttons["Pull day"]
        XCTAssertTrue(row.waitForExistence(timeout: 15), "Pull day did not show up")
        row.tap()
        // The workout runs: its first exercise is on screen and the start screen's row is gone.
        XCTAssertTrue(app.staticTexts["Barbell Row"].waitForExistence(timeout: 10), "the routine did not start")
        XCTAssertFalse(row.exists, "the start screen is still up")
    }
}
