import XCTest

/**
 * Walks the iPhone app the way someone new does and checks what only a real phone shows: that the
 * end of a rest still arrives as a notification once the app has left the screen (RestAlertPlugin),
 * and that a sheet with a text field stays above the keyboard. Run by .github/workflows/ios.yml,
 * which adds this target to the project for the run only (ios/ci/add-ui-tests.rb). The run's
 * build carries no exercise media, so the screenshots it keeps show placeholders.
 */
final class OpenGymUITests: XCTestCase {
    let app = XCUIApplication()
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }

    private func tap(_ e: XCUIElement, _ what: String, timeout: TimeInterval = 15) {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "\(what) did not show up")
        e.tap()
    }

    private func button(startingWith prefix: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    /**
     * "Use on this device", until home shows. On a slow simulator the first tap can land while the
     * page is still starting and go nowhere.
     */
    private func chooseLocal() {
        if app.buttons["Log"].waitForExistence(timeout: 45) { return }   // chosen in an earlier test
        let local = app.buttons["Use on this device"]
        XCTAssertTrue(local.waitForExistence(timeout: 60), "the onboarding choice did not show up")
        for _ in 0..<5 {
            if local.exists { local.tap() }
            if app.buttons["Log"].waitForExistence(timeout: 8) { return }
        }
        XCTFail("home never showed after the onboarding choice")
    }

    // XCTest runs a class's tests in name order: the keyboard check wants a plain home screen, and
    // this one leaves a workout running.
    func test2RestEndsWithANotificationInTheBackground() {
        app.launch()
        chooseLocal()
        shot("1-home")
        tap(app.buttons["Load starter plan"], "Load starter plan")
        tap(button(startingWith: "Full Body"), "the Full Body plan")
        tap(app.buttons["Choose a different workout"], "Choose a different workout")
        tap(app.staticTexts["Full Body A"], "Full Body A")
        shot("2-workout")
        tap(app.switches["Set 1 done"], "Set 1 done")
        // The first rest asks for notifications; on a slow simulator the question can take a while.
        let countdown = button(startingWith: "1:")
        let allow = springboard.alerts.buttons["Allow"]
        var counting = false
        for _ in 0..<40 {
            if allow.exists { allow.tap() }
            if countdown.exists { counting = true; break }
            sleep(1)
        }
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        if !counting {
            shot("3-no-countdown")
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "app tree without a countdown"
            tree.lifetime = .keepAlways
            add(tree)
        }
        XCTAssertTrue(counting, "no rest countdown after a set")
        shot("3-rest")

        XCUIDevice.shared.press(.home)
        // The rest is 90 s; its end has to arrive on its own, with the app in the background.
        let banner = springboard.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "Next set")).firstMatch
        let arrived = banner.waitForExistence(timeout: 120)
        shot("4-notification")
        XCTAssertTrue(arrived, "the end of the rest never arrived as a notification")
    }

    func test1WeighInSheetStaysAboveTheKeyboard() {
        app.launch()
        chooseLocal()
        tap(app.buttons["Log"], "Log (body weight)")
        let field = app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 15), "no weight field")
        // The sheet slides in; wait until the field is where a finger can reach it.
        for _ in 0..<20 where !field.isHittable { usleep(500_000) }
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no keyboard")
        shot("5-keyboard")
        let save = app.buttons["Save"]
        XCTAssertTrue(save.waitForExistence(timeout: 5), "no Save button")
        let keyboardTop = app.keyboards.firstMatch.frame.minY
        XCTAssertLessThanOrEqual(save.frame.maxY, keyboardTop + 1, "Save sits under the keyboard")
    }
}
