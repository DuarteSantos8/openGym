import Foundation

/// The rest between sets, as the rest layer shows it: ±15 s, how full the bar is, the set after it.
/// The views only draw these.
enum Rest {
    static let step: TimeInterval = 15

    /// The time left once `delta` is added. Under a second is 0: "ready now", the same as Skip (the clock
    /// counts whole seconds, so a rest of a fraction would only ring the alarm).
    static func adjusted(left: TimeInterval, by delta: TimeInterval) -> TimeInterval {
        let t = left + delta
        return t < 1 ? 0 : t
    }

    /// Whether a rest end from the phone replaces the rest running here: only an end not seen before,
    /// and not over the lifter's own ±15 unless the phone just ticked a set (that is a new rest).
    static func follows(_ end: Date, known: Date?, adjusted: Bool, phoneTicked: Bool) -> Bool {
        end != known && (!adjusted || phoneTicked)
    }

    /// How full the draining bar is, 0...1: the time left over the rest's whole length (start to end).
    static func progress(left: TimeInterval, total: TimeInterval) -> Double {
        total > 0 ? min(1, max(0, left / total)) : 0
    }

    /// The set the rest is before: the exercise, its place, the side up, and what is planned for it.
    struct Next: Equatable {
        var name: String
        var position: SetPage.Position
        /// "L" or "R" on a per-side set.
        var side: String?
        /// "62.5 kg × 8", "+5 kg × 6", "× 8" (bodyweight, nothing added: `bodyweight`), "45 s"; none for cardio.
        var load: String?
        var bodyweight = false
    }

    static func next(_ e: Entry, set si: Int, unit: String) -> Next? {
        guard e.sets.indices.contains(si) else { return nil }
        let row = e.sets[si]
        var n = Next(name: e.name, position: SetPage.position(e, set: si), side: row.sideUp)
        if e.isTimed {
            n.load = row.sec.map { formatNumber($0) + " s" }
        } else if e.mode == "reps" {
            let p = SetPage.plan(row)
            n.bodyweight = e.isBodyweight && p.w == 0
            n.load = (e.isBodyweight ? (p.w > 0 ? "+\(formatNumber(p.w)) \(unit) × " : "× ") : "\(formatNumber(p.w)) \(unit) × ") + formatNumber(p.r)
        }
        return n
    }
}
