import HealthKit
import WatchKit
import os

/// The phone launches this app with HKHealthStore.startWatchApp when a workout starts there. The
/// configuration it brings carries no id, so nothing starts here: the start message with the id
/// follows over WatchConnectivity, which the launch has just made reachable.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    private let log = Logger(subsystem: "ch.duartesantos.opengym.watchkitapp", category: "App")

    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        log.info("Launched by the phone for a workout")
    }
}
