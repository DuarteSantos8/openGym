import Foundation

/*
 * The rest screen's rules (tested in RestMathTests.swift):
 *
 *   minus     −15 s; with 15 s or less left it is a Skip, as on the phone
 *   follows   a rest end from the phone's snapshot is followed only when it is a new one: the same
 *             end sent again (with an unrelated change) no longer undoes a ±15 or brings a skipped
 *             rest back
 *   left      how much of the rest is left, 1 at its start, 0 at its end (the bar under the time)
 *   chips     the four quick effort ratings during the rest: RIR 0, 1, 2, 3+ or RPE 10, 9, 8, ≤7
 */
enum RestMath {
    static let step: TimeInterval = 15

    /// The rest's end after −15 s, or nil when that is the end of it.
    static func minus(end: Date, now: Date, by s: TimeInterval = step) -> Date? {
        let to = end.addingTimeInterval(-s)
        return to.timeIntervalSince(now) >= 1 ? to : nil
    }

    static func follows(_ phoneEnd: Double, last: Double?) -> Bool {
        phoneEnd != last
    }

    /// What the watch does with the rest end in a phone snapshot (the Wear and Garmin twin):
    /// `last` is the end to remember, `start` whether the watch's rest jumps to it. Only an end
    /// it has not followed before counts, and the `echo` (the first snapshot that applied the
    /// watch's own latest tick) carries the phone's copy of the rest the watch already runs: it
    /// is remembered, never started, so a +15 or Skip pressed right after Done stands.
    static func phoneRest(_ end: Double?, last: Double?, echo: Bool) -> (last: Double?, start: Bool) {
        guard let end = end else { return (nil, false) }
        guard follows(end, last: last) else { return (last, false) }
        return (end, !echo)
    }

    /// What the watch does with its rest when a snapshot of its own workout carries the phone's
    /// rest stamp (protocol 2, docs/WATCH_SYNC.md rule 3).
    enum Follow: Equatable {
        /// The snapshot's rest is not newer than the watch's own last change: nothing changes.
        case ignore
        /// The same end as the watch's own, within 250 ms: the countdown is left alone.
        case keep
        /// The rest ends then (ms, the watch's clock): the countdown starts or moves there.
        case run(end: Double)
        /// Paused on the phone with this much left (seconds, the snapshot's `restLeft`): the countdown stands, no alarm.
        case pause(left: Double)
        /// No rest any more (a Skip, −15 to nothing, or it ran out there): ended as a Skip here.
        case end
    }

    /// Rule 3: a rest change the phone made after the watch's newest (`mine`, the phone's clock) is
    /// followed, whatever it is; an older or the same one never, so opening the phone, a late
    /// snapshot or a relaunch never restarts a rest. `restAt` nil (an older phone): nil, and the
    /// old rules (phoneRest and the echo) decide. `off`: the watch's clock minus the phone's,
    /// `current`: the watch's rest end now (its clock), `now`: the watch's clock.
    static func follow(restAt: Double?, mine: Double, rest: RestInfo?, paused: Bool?, left: Double?,
                       off: Double, current: Double?, now: Double) -> (restAt: Double, action: Follow)? {
        guard let at = restAt, at.isFinite else { return nil }
        guard at > mine else { return (mine, .ignore) }
        if let r = rest, r.endsAt.isFinite {
            let end = r.endsAt + off
            guard end > now else { return (at, .end) }
            if let c = current, abs(c - end) <= 250 { return (at, .keep) }
            return (at, .run(end: end))
        }
        if paused == true { return (at, .pause(left: max(0, SafeNum.finite(left ?? 0, or: 0)))) }
        return (at, .end)
    }

    /// A rest's time left as the countdown shows it, "1:05" (a paused rest, which stands still and
    /// so is no running timer): whole seconds rounded up, as a countdown shows them; never below 0.
    static func clock(_ seconds: TimeInterval) -> String {
        let total = SafeNum.int(max(0, SafeNum.finite(seconds, or: 0)).rounded(.up))
        return String(format: "%d:%02d", total / 60, total % 60)
    }

    static func left(start: Date, end: Date, now: Date) -> Double {
        let total = end.timeIntervalSince(start)
        guard total > 0 else { return 0 }
        return min(1, max(0, end.timeIntervalSince(now) / total))
    }
}

extension Effort {
    /// The quick ratings, hardest first.
    static func chips(_ kind: String) -> [Double] {
        kind == "rpe" ? [10, 9, 8, 7] : [0, 1, 2, 3]
    }

    /// "3+" and "≤7" for the open ends, the number itself otherwise.
    static func chipLabel(_ kind: String, _ v: Double) -> String {
        if kind == "rpe" && v <= 7 { return "≤7" }
        if kind == "rir" && v >= 3 { return "3+" }
        return v.rounded() == v ? String(SafeNum.int(v)) : String(v)
    }
}

/*
 * How far the watch's clock is off the phone's (protocol 2, rule 1), in ms: watch − phone. Each
 * snapshot that came as a message gives one sample, the watch's clock when it arrived minus the
 * phone's `now` in it; a late message only makes a sample bigger, so the smallest of the last five
 * minutes is the best guess (the newest alone when none is that recent, 0 without any). Never from
 * the application context, which can wait for minutes before it is read.
 */
struct ClockSample: Codable, Equatable {
    /// Watch clock minus the snapshot's `now` (ms).
    var gap: Double
    /// The watch's clock when it arrived (ms).
    var at: Double
}

enum ClockOffset {
    static let keep = 8
    static let window: Double = 5 * 60 * 1000

    /// The samples with one more, the last `keep` kept. A sample that makes no sense (a phone with
    /// no clock in its snapshot, NaN) is not added.
    static func add(_ samples: [ClockSample], phoneNow: Double?, watchNow: Double) -> [ClockSample] {
        guard let p = phoneNow, p > 0, p.isFinite, watchNow.isFinite else { return samples }
        return Array((samples + [ClockSample(gap: watchNow - p, at: watchNow)]).suffix(keep))
    }

    static func offset(_ samples: [ClockSample], now: Double) -> Double {
        guard let newest = samples.last else { return 0 }
        let recent = samples.filter { now - $0.at <= window }
        return recent.map { $0.gap }.min() ?? newest.gap
    }
}
