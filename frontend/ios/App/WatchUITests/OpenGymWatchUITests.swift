import XCTest

/**
 * Taps the watch app's controls in the demo session (SessionStore's -OpenGymWatchDemo, no phone
 * needed): a control that only looks right in a screenshot has failed on a real wrist before (the
 * session note's invisible field, #1330). Run by .github/workflows/ios.yml, which adds this target
 * for the run only (ios/ci/add-watch-ui-tests.rb).
 */
final class OpenGymWatchUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
    }

    /// The Overview scrolled to its end (-OpenGymWatchScroll end), where Finish, the note and Discard are.
    func testSessionNoteButtonOpensTheTextInput() {
        app.launchArguments = ["-OpenGymWatchDemo", "-OpenGymWatchScreen", "overview", "-OpenGymWatchScroll", "end"]
        app.launch()
        let note = app.buttons["Add session note"]
        XCTAssertTrue(note.waitForExistence(timeout: 20), "the Add session note button did not show up")
        XCTAssertFalse(app.buttons["Cancel"].exists, "the text input was already open")
        note.tap()
        // The system's text input (a sheet with its own Cancel) takes over; the Overview's button is gone behind it.
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 10), "the tap did not open the text input")
    }
}
