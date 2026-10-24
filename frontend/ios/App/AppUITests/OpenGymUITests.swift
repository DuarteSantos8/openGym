import XCTest

/**
 * Walks the iPhone app the way someone new does and checks what only a real phone shows: that the
 * end of a rest still arrives as a notification once the app has left the screen (RestAlertPlugin),
 * that a sheet with a text field stays above the keyboard, and that the training reminder and the
 * missed-day nudge are really pending with iOS once switched on. Run by .github/workflows/ios.yml,
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
     * page is still starting and go nowhere. The first-start steps come right after the choice
     * (views/PermissionSteps.jsx): notifications (allowed here, and so is the system's question)
     * and, on an iPhone with Apple Health, the Health step (Continue, then Don't Allow in the iOS
     * sheet). Nothing is tapped twice and
     * nothing in the app is tapped while a system alert is up: a late alert used to swallow one
     * tap and pass the next one through to home underneath (CI 10-13, the gym card opened).
     */
    private func chooseLocal() {
        if app.buttons["Log"].waitForExistence(timeout: 45) { return }   // chosen in an earlier test
        let local = app.buttons["Use on this device"]
        XCTAssertTrue(local.waitForExistence(timeout: 60), "the onboarding choice did not show up")
        for _ in 0..<5 {
            if systemAlertUp() { allowSystemAlert(within: 20) }
            if local.exists && local.isHittable { local.tap() }
            passPermissionSteps()
            if app.buttons["Log"].waitForExistence(timeout: 20) { return }
        }
        XCTFail("home never showed after the onboarding choice")
    }

    private func systemAlertUp() -> Bool { springboard.alerts.firstMatch.exists }

    /**
     * Both first-start steps, whichever show, each with its one Continue (App Review 5.1.1(iv)):
     * notifications, then the system's own Allow (waited for up to 20 s, the simulator can be slow
     * to ask); Apple Health, then Don't Allow in the iOS sheet, which leaves it off. Done when neither step is on screen any more.
     */
    private func passPermissionSteps() {
        let notifications = app.staticTexts["Never miss the end of a rest"]
        let health = app.staticTexts["Your workouts in Apple Health"]
        var allowedNotifications = false, declinedHealth = false
        let until = Date().addingTimeInterval(60)
        guard notifications.waitForExistence(timeout: 8) || health.exists else { return }
        while Date() < until {
            if systemAlertUp() { allowSystemAlert(within: 20); sleep(1); continue }
            if notifications.exists {
                if !allowedNotifications {
                    shot("0-permission-step")
                    let next = app.buttons["Continue"]
                    if next.exists { next.tap(); allowedNotifications = true }
                    // The system asks next; give it time before looking at the page again.
                    _ = springboard.alerts.firstMatch.waitForExistence(timeout: 20)
                }
                sleep(1)
                continue
            }
            if health.exists {
                if !declinedHealth {
                    shot("0b-apple-health-step")
                    let next = app.buttons["Continue"]
                    if next.exists { next.tap(); declinedHealth = true }
                }
                // The Health sheet is the app's own window, not a springboard alert.
                let dont = app.buttons["Don't Allow"]
                if dont.waitForExistence(timeout: 10) { dont.tap() }
                sleep(1)
                continue
            }
            // Neither shows: the next step may still be coming (the page checks each one first).
            if !health.waitForExistence(timeout: 3) && !notifications.exists { return }
        }
    }

    private func allowSystemAlert(within seconds: Int) {
        let allow = springboard.alerts.buttons["Allow"]
        for _ in 0..<seconds {
            if allow.exists { allow.tap(); return }
            sleep(1)
        }
    }

    /** A switch on, for sure: tapped until it reads on, a system question answered in between. */
    private func switchOn(_ sw: XCUIElement, _ what: String) {
        XCTAssertTrue(sw.waitForExistence(timeout: 15), "no \(what) switch")
        for _ in 0..<6 {
            if systemAlertUp() { allowSystemAlert(within: 5) }
            if (sw.value as? String) == "1" { return }
            sw.tap()
            allowSystemAlert(within: 5)
            sleep(1)
        }
        XCTAssertEqual(sw.value as? String, "1", "the \(what) switch did not stay on")
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
        let tick = app.switches["Set 1 done"]
        tap(tick, "Set 1 done")
        // The first rest asks for notifications; on a slow simulator the question can take a while.
        let countdown = button(startingWith: "1:")
        let allow = springboard.alerts.buttons["Allow"]
        var counting = false
        for i in 0..<40 {
            if allow.exists { allow.tap() }
            if countdown.exists { counting = true; break }
            // A tap that did not tick (something moved under it): once more, never on a ticked set.
            if i == 4, (tick.value as? String) == "0" { tick.tap() }
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

    /**
     * The training reminder and the missed-day nudge reach iOS as pending local notifications:
     * a workout logged today (finished here, or the one test2 left running), the reminder and
     * the nudge switched on, and then iOS itself is asked what it holds for the app. The app
     * shows that only when launched with -OpenGymUITestPending (MainViewController.swift).
     * Reminder ids are 1000-1059 (one per planned day in 60), nudge ids 2000-2006
     * (lib/mobile.js); with a three-day plan and a workout today the week ahead always has both.
     */
    func test3ReminderAndNudgeArePendingNotifications() {
        app.launchArguments = ["-OpenGymUITestPending"]
        app.launch()
        let finish = app.buttons["Finish"]
        let resume = app.buttons["Resume"]
        let home = app.buttons["Log"]
        let local = app.buttons["Use on this device"]
        // One query for any of the four, waited on, rather than four polled every second: on a busy
        // simulator each poll is a whole snapshot of the app, and they ran past XCTest's limit (CI 10-13).
        let anyScreen = app.buttons.matching(NSPredicate(format: "label IN %@", ["Finish", "Resume", "Log", "Use on this device"])).firstMatch
        XCTAssertTrue(anyScreen.waitForExistence(timeout: 120), "the app never showed a screen")
        if local.exists { chooseLocal() }
        if !finish.exists && resume.exists { resume.tap() }
        if !finish.waitForExistence(timeout: 5) {
            // Nothing running (test2 failed early or ran alone): start one the way test2 does.
            XCTAssertTrue(home.waitForExistence(timeout: 30), "home did not show")
            if app.buttons["Load starter plan"].waitForExistence(timeout: 5) {
                tap(app.buttons["Load starter plan"], "Load starter plan")
                tap(button(startingWith: "Full Body"), "the Full Body plan")
            }
            tap(app.buttons["Choose a different workout"], "Choose a different workout")
            tap(app.staticTexts["Full Body A"], "Full Body A")
            tap(app.switches["Set 1 done"], "Set 1 done")
            allowSystemAlert(within: 5)
        }
        tap(finish, "Finish")
        tap(button(startingWith: "Finish and save"), "Finish and save")
        // The summary is a centred card taller than the screen: its button is at the foot of the
        // card's own scroll, below what shows (CI 10-13: the tap landed under the card).
        let nice = app.buttons["Nice!"]
        XCTAssertTrue(nice.waitForExistence(timeout: 20), "Nice! (the summary) did not show up")
        let window = app.windows.firstMatch
        let bottom = window.frame.maxY - 80
        for _ in 0..<6 where nice.frame.maxY > bottom {
            // A drag in the middle of the card, upwards: scrolls the card, never dismisses it.
            window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
                .press(forDuration: 0.05, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)))
            sleep(1)
        }
        shot("6-summary")
        nice.tap()
        for _ in 0..<5 where nice.exists { sleep(1) }
        if nice.exists { nice.tap() }
        shot("6-finished")

        tap(button(startingWith: "Settings"), "Settings")
        tap(button(startingWith: "Reminders"), "Reminders")
        switchOn(app.switches["Workout day reminder"], "reminder")
        switchOn(app.switches["Nudge me when I skip a planned workout"], "nudge")
        shot("7-reminders-on")

        // The store reschedules on its next save; poll what iOS holds until both kinds are there.
        let probe = app.staticTexts["og-pending-notifications"]
        XCTAssertTrue(probe.waitForExistence(timeout: 20), "the pending-notifications probe is missing")
        var ids: [Int] = []
        for _ in 0..<45 {
            ids = probe.label.replacingOccurrences(of: "pending:", with: "").split(separator: ",").compactMap { Int($0) }
            if ids.contains(where: { (1000...1059).contains($0) }) && ids.contains(where: { (2000...2006).contains($0) }) { break }
            sleep(1)
        }
        let pending = XCTAttachment(string: probe.label)
        pending.name = "pending notifications"
        pending.lifetime = .keepAlways
        add(pending)
        XCTAssertTrue(ids.contains(where: { (1000...1059).contains($0) }), "no training reminder pending: \(probe.label)")
        XCTAssertTrue(ids.contains(where: { (2000...2006).contains($0) }), "no missed-day nudge pending: \(probe.label)")
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
