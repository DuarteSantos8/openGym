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
