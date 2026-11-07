import Foundation

/*
 * What may go to Apple Health, and the number and JSON guards the native code uses everywhere it
 * takes a value from the page or the phone (openGym v1.4.5, after TestFlight 59 died at every
 * launch on a forgotten workout).
 *
 * HealthKit raises an Objective-C exception for a sample it will not take (an end before the start,
 * a stretch longer than the type allows, a date before 2001), and Swift traps on Int(.nan), on
 * Int(1e20) and on a ClosedRange whose bounds are the wrong way round. None of that can be caught:
 * the app is gone, and as the same record is tried again at the next launch, it is gone again. So
 * everything is checked here first, in plain values, which `swift test` covers on the Mac
 * (HealthWriteCoreTests). Compiled straight into the iPhone app (App.xcodeproj) and the watch app
 * (ios/ci/add-watch-app.rb), like HealthReadCore.
 *
 * The rules are the same as lib/health-connect.js (healthRecords) and HealthWrite.java on Android:
 *
 *   a workout     needs an id, a finite start from 2001 on, an end after it and no later than a day
 *                 from now; one longer than MAX_SESSION (7 days) is not written at all
 *   its calories  only for a workout of at most ENERGY_SPAN (24 h), and only finite, above 0 and at
 *                 most MAX_KCAL; a longer workout (left running overnight, forgotten for a day) is
 *                 written with its real start and end, without calories (and on Android without
 *                 segments): a stretch that long is not what was burned
 *   a weigh-in    needs an id, a finite time from 2001 on (at most a day ahead) and 0 < kg < 1000
 */
public enum HealthWriteCore {
    /// 2001-01-01T00:00:00Z, HealthKit's own epoch, in ms since 1970. Nothing before it is written.
    public static let epochMs: Double = 978_307_200_000
    /// A workout longer than this is not a workout: not written at all.
    public static let maxSessionMs: Double = 7 * 86_400_000
    /// Calories (and segments on Android) only for a workout up to this long.
    public static let energySpanMs: Double = 86_400_000
    /// A day of the hardest training is well under this; beyond it the number is a typo.
    public static let maxKcal: Double = 20_000
    /// Health Connect takes up to 1000 kg; Apple Health a few more, but nobody weighs that.
    public static let maxKg: Double = 1000
    /// Another device's clock may run a little ahead: up to a day is taken.
    public static let futureSlackMs: Double = 86_400_000

    public enum Verdict: Equatable {
        /// Not written: the reason, for the log and the page.
        case skip(String)
        /// Written; `energy` false when the workout is too long for its calories.
        case write(energy: Bool)
    }

    /// Whether a time (ms since 1970) is one HealthKit takes: finite, 2001 or later, not far ahead.
    public static func validTime(_ ms: Double, now: Double) -> Bool {
        ms.isFinite && ms >= epochMs && ms <= now + futureSlackMs
    }

    /// The verdict for one workout from the page (lib/health-connect.js sessionRecord).
    public static func session(id: String?, start: Double?, end: Double?, now: Double) -> Verdict {
        guard let id = id, !id.isEmpty else { return .skip("no id") }
        guard let start = start, let end = end else { return .skip("no start or end") }
        guard validTime(start, now: now), validTime(end, now: now) else { return .skip("time out of range") }
        guard end > start else { return .skip("end not after start") }
        let span = end - start
        guard span <= maxSessionMs else { return .skip("longer than 7 days") }
        return .write(energy: span <= energySpanMs)
    }

    /// The calories to write, or nil for none (NaN, infinite, zero, negative, absurd).
    public static func kcal(_ v: Double?) -> Double? {
        guard let v = v, v.isFinite, v > 0, v <= maxKcal else { return nil }
        return v
    }

    /// Whether a weigh-in from the page may be written.
    public static func weight(id: String?, time: Double?, kg: Double?, now: Double) -> Bool {
        guard let id = id, !id.isEmpty, let time = time, let kg = kg else { return false }
        return validTime(time, now: now) && kg.isFinite && kg > 0 && kg < maxKg
    }

    /// Whether a sample of a type with these duration limits (seconds, nil = none) fits `span`
    /// seconds: what HKObject's own validation checks, and raises an exception for.
    public static func spanFits(_ span: Double, min: Double?, max: Double?) -> Bool {
        guard span.isFinite, span >= 0 else { return false }
        if let max = max, span > max { return false }
        if let min = min, span < min { return false }
        return true
    }

    /// When a live workout session ends: `at` (the page's or the phone's), else now; never before
    /// its own start and never in the future. A NaN or absurd `at` (another device's clock, a
    /// stale snapshot) is now.
    public static func liveEnd(at: Date?, start: Date?, now: Date) -> Date {
        var end = now
        if let at = at, at.timeIntervalSince1970.isFinite, at < now { end = at }
        if let start = start, start.timeIntervalSince1970.isFinite, end < start { end = start }
        return end
    }
}

/// Number guards for values that come from the page or the phone. Int(Double) traps on NaN, on
/// infinity and on anything past Int's range; these never do.
public enum SafeNum {
    /// `v` rounded toward zero as an Int: NaN is 0, beyond Int's range the nearest end of it.
    public static func int(_ v: Double) -> Int {
        guard !v.isNaN else { return 0 }
        if v >= 9.2e18 { return Int.max }
        if v <= -9.2e18 { return Int.min }
        return Int(v)
    }

    /// `v` rounded to the nearest Int, as above.
    public static func rounded(_ v: Double) -> Int { int(v.rounded()) }

    /// The value if finite, else `fallback`.
    public static func finite(_ v: Double?, or fallback: Double) -> Double {
        guard let v = v, v.isFinite else { return fallback }
        return v
    }

    /// A Date from ms since 1970, or nil for one that is NaN, infinite or outside 1970 to 4000.
    public static func date(ms: Double?) -> Date? {
        guard let ms = ms, ms.isFinite, ms >= 0, ms < 64_092_211_200_000 else { return nil }
        return Date(timeIntervalSince1970: ms / 1000)
    }

    /// Seconds for a UNTimeIntervalNotificationTrigger, which raises an exception for 0 or less:
    /// at least 1, at most a year, 1 for NaN.
    public static func interval(_ seconds: Double) -> TimeInterval {
        guard !seconds.isNaN else { return 1 }
        return min(max(1, seconds), 365 * 86_400)
    }

    /// A range Text(timerInterval:) can take: `from...to`, or `to...to` when `from` lies after
    /// `to`, or now...now when either is not a real date (a ClosedRange the wrong way round traps).
    public static func timerRange(_ from: Date, _ to: Date, now: Date = Date()) -> ClosedRange<Date> {
        let f = from.timeIntervalSinceReferenceDate, t = to.timeIntervalSinceReferenceDate
        guard f.isFinite, t.isFinite else { return now...now }
        return from <= to ? from...to : to...to
    }
}

/// JSONSerialization.data raises an Objective-C exception (not a Swift error, so `try?` does not
/// help) for anything that is not JSON: NaN, infinity, a Date, a Data. Checked first here.
public enum SafeJSON {
    public static func data(_ object: Any) -> Data? {
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        return try? JSONSerialization.data(withJSONObject: object)
    }
}
