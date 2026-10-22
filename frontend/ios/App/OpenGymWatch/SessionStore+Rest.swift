import Foundation
import WatchKit

/// The phone's rest timer on the wrist. The phone keeps the real one: +15 s and Skip are sent to it
/// and shown here at once, and its next application context settles the figures.
extension SessionStore {

    private static let warningLeft: TimeInterval = 10
    private static let addStep = 15

    var restRunning: Bool { restPaused || restEndsAt != nil }

    func applyRest(_ state: RestState?, at: Date) {
        // Application contexts can arrive out of order across a relaunch; the newest wins.
        guard at > restAppliedAt else { return }
        restAppliedAt = at
        guard let state else {
            clearRest()
            return
        }
        restTotal = max(state.total, state.left)
        restPaused = state.paused
        restLeftWhenPaused = state.left
        restEndsAt = state.paused ? nil : state.endsAt
        // Once per rest: a new one comes with ready false, so only the turn to true taps.
        if state.ready && !restReady {
            // Stronger than .success: this is the one tap that asks for attention during a rest.
            WKInterfaceDevice.current().play(.notification)
        }
        restReady = state.ready
        scheduleRestHaptics()
    }

    func addFifteen() {
        link.sendRestAction("add15")
        if restPaused {
            restLeftWhenPaused += Self.addStep
            restTotal = max(restTotal, restLeftWhenPaused)
        } else if let ends = restEndsAt {
            let moved = ends.addingTimeInterval(TimeInterval(Self.addStep))
            restEndsAt = moved
            restTotal = max(restTotal, Int(moved.timeIntervalSinceNow.rounded(.up)))
            scheduleRestHaptics()
        }
    }

    func skipRest() {
        link.sendRestAction("skip")
        clearRest()
    }

    func clearRest() {
        restHaptics?.cancel()
        restHaptics = nil
        restEndsAt = nil
        restPaused = false
        restLeftWhenPaused = 0
        restTotal = 0
        restReady = false
    }

    /// A tap at ten seconds left and the notification haptic at zero, then the countdown goes.
    private func scheduleRestHaptics() {
        restHaptics?.cancel()
        guard let ends = restEndsAt, !restPaused else {
            restHaptics = nil
            return
        }
        restHaptics = Task { [weak self] in
            let warning = ends.timeIntervalSinceNow - Self.warningLeft
            if warning > 0 {
                try? await Task.sleep(for: .seconds(warning))
                guard !Task.isCancelled else { return }
                WKInterfaceDevice.current().play(.click)
            }
            try? await Task.sleep(for: .seconds(max(0, ends.timeIntervalSinceNow)))
            guard !Task.isCancelled, let self, self.restEndsAt == ends else { return }
            WKInterfaceDevice.current().play(.notification)
            self.clearRest()
        }
    }
}
