import Foundation

/*
 * "Ready" during a rest (the phone's watch settings, off by default): once the heart rate is back
 * down after a set, the rest screen says so and the wrist taps once. Advice only: the countdown
 * still runs as the limit, ±15 and Skip are as before, nothing ends a rest by itself. The rule,
 * for the other watches to mirror: docs/dev/REST_BY_HEART_RATE.md. The Wear OS twin is
 * RestReadiness in WatchLogic.kt, tested case for case. Tested in RestReadinessTests.swift.
 */

/// The phone's choice (`settings.hrRest`): `bpm` is a fixed target, nil the automatic one.
struct HrRestSettings: Codable, Equatable {
    var on: Bool?
    var bpm: Double?
}

enum RestReadiness {
    /// Never before this much rest: the pulse dips right after a set before it settles.
    static let floor: TimeInterval = 30
    /// Under the target this long, without a reading above it in between.
    static let hold: TimeInterval = 5
    /// A reading older than this says nothing about now.
    static let stale: TimeInterval = 10
    /// The automatic target starts from the average over this long before the set began.
    static let before: TimeInterval = 60
    /// The automatic target: a quarter of the set's rise above its start...
    static let autoFraction = 0.25
    /// ...but at least this far above the start.
    static let autoMinAbove: Double = 5

    /// The target for one rest, nil when the setting is off or there is nothing to go by. Automatic
    /// works from the set's own readings: `startHr` the average over the minute before the set
    /// began, `peak` the highest during it.
    static func target(settings: HrRestSettings?, startHr: Double?, peak: Double?) -> Double? {
        guard let s = settings, s.on == true else { return nil }
        if let bpm = s.bpm, bpm > 0, bpm.isFinite { return bpm }
        guard let base = startHr else { return nil }
        let rise = max(0, (peak ?? base) - base)
        return base + max(autoMinAbove, rise * autoFraction)
    }

    /// The same from the session's readings, for the set that ran from `setStart` to `setEnd`
    /// (its tick, where the rest begins). Zeros are no reading.
    static func target(settings: HrRestSettings?, readings: [(Date, Double)], setStart: Date, setEnd: Date) -> Double? {
        let pulse = readings.filter { $0.1 > 0 }
        let lead = pulse.filter { $0.0 >= setStart.addingTimeInterval(-before) && $0.0 < setStart }.map(\.1)
        let startHr = lead.isEmpty ? nil : lead.reduce(0, +) / Double(lead.count)
        let peak = pulse.filter { $0.0 >= setStart && $0.0 <= setEnd }.map(\.1).max()
        return target(settings: settings, startHr: startHr, peak: peak)
    }

    /// Ready once the rest has run `floor`, the latest reading is fresh, and the run of readings at
    /// or under `target` that it ends spans `hold`. `since` is where that run starts (nil when the
    /// latest reading is above the target or stale). Only readings since `restStart` count.
    static func evaluate(readings: [(Date, Double)], restStart: Date, now: Date, target: Double) -> (ready: Bool, since: Date?) {
        let inRest = readings.filter { $0.1 > 0 && $0.0 >= restStart && $0.0 <= now }.sorted { $0.0 < $1.0 }
        guard let latest = inRest.last, now.timeIntervalSince(latest.0) <= stale, latest.1 <= target else { return (false, nil) }
        let since = inRest.reversed().prefix { $0.1 <= target }.last?.0 ?? latest.0
        let ready = now.timeIntervalSince(restStart) >= floor && latest.0.timeIntervalSince(since) >= hold
        return (ready, since)
    }
}
