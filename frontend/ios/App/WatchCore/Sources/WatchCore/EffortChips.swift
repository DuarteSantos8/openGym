import Foundation

/*
 * Rating a set from the rest that follows it: four chips, hardest first. A chip re-sends the
 * set's own setDone with a later `at` and the effort; the phone writes it on the row it has
 * (frontend Workout.jsx bindWatchActions, watch-sync.js patchSetIn), so no new event is needed.
 * There is no way to clear a rating that way, so there is no "clear" chip.
 */
extension Effort {
    /// The chips on the profile's scale, hardest first: RIR 0, 1, 2, 3 / RPE 10, 9, 8, 7.
    static func chips(_ kind: String) -> [Double]? {
        switch kind {
        case "rir": return [0, 1, 2, 3]
        case "rpe": return [10, 9, 8, 7]
        default: return nil
        }
    }

    /// The chip's face; U+200E keeps "3+" and "≤7" in order in a right-to-left language.
    static func chipLabel(_ kind: String, _ i: Int) -> String {
        guard let v = chips(kind)?[i] else { return "" }
        return i == 3 ? "\u{200E}" + (kind == "rir" ? "3+" : "≤7") : formatNumber(v)
    }

    /// The phone's own sentence for chip `i` (its locale key): VoiceOver's hint.
    static func feel(_ i: Int) -> String {
        ["Nothing left, went to failure", "One more rep in the tank", "Two more reps", "Three more reps"][i]
    }

    /// The set the chips rate: the one just done here, until its rest is over.
    struct Target: Equatable {
        var wid: String, exId: String, entryIdx: Int, setIdx: Int
        /// The set's own tick (ms): every re-send is this + 1, + 2, … so it stays the set's time
        /// (the phone works out set lengths and the session's end from it) and still comes later.
        var at: Double
        /// setDone re-sent so far.
        var sent = 0
        /// The chip last tapped, nil until one is.
        var value: Double?
    }

    /// nil unless the scale is known and the row is a done working set, ticked here at a known time
    /// (a per-side set: both sides done), and not cardio.
    static func target(_ s: SessionState, entry ei: Int, set si: Int, kind: String?) -> Target? {
        guard let kind = kind, chips(kind) != nil, let w = s.workout, w.entries.indices.contains(ei),
              w.entries[ei].sets.indices.contains(si), !w.entries[ei].isCardio else { return nil }
        let e = w.entries[ei], row = e.sets[si]
        guard row.done, !row.warmup, row.sideUp == nil, let at = row.at else { return nil }
        return Target(wid: w.id ?? "", exId: e.id, entryIdx: ei, setIdx: si, at: at)
    }

    /// The setDone events that rate the target with chip value `v`, built from the row as it is, in the
    /// exercise's own unit. [] when `v` is no chip or is the one already chosen. A per-side set is
    /// re-sent once per side, the same value on both.
    static func rate(_ t: Target, _ v: Double, kind: String, in s: SessionState, id: () -> String) -> (Target, [Event]) {
        guard chips(kind)?.contains(v) == true, v != t.value, let w = s.workout, w.entries.indices.contains(t.entryIdx),
              w.entries[t.entryIdx].sets.indices.contains(t.setIdx) else { return (t, []) }
        let e = w.entries[t.entryIdx], row = e.sets[t.setIdx]
        func event(_ n: Int, w: Double?, r: Double?, sec: Double?, side: String?) -> Event {
            var ev: Event = ["id": id(), "type": "setDone", "wid": t.wid, "exId": t.exId,
                             "entryIdx": t.entryIdx, "setIdx": t.setIdx, "at": t.at + Double(t.sent + n), kind: v]
            if let w = w { ev["w"] = w }
            if let r = r { ev["r"] = r }
            if let sec = sec { ev["sec"] = sec }
            if let side = side { ev["side"] = side }
            return ev
        }
        let events: [Event] = row.sides.map { sides in
            [("L", sides.L), ("R", sides.R)].enumerated().map { event($0 + 1, w: $1.1.w, r: $1.1.r, sec: nil, side: $1.0) }
        } ?? [event(1, w: row.w, r: row.r, sec: e.isTimed ? row.sec : nil, side: nil)]
        var next = t
        next.value = v
        next.sent += events.count
        return (next, events)
    }

    /// Whether the set up can be rated before Done (the Done pill's disc): no rest follows it, so
    /// the chips never show, and it is not the first side of a per-side set (that is not the set's end).
    static func ratesBeforeDone(_ s: SessionState, entry ei: Int, set si: Int) -> Bool {
        guard let w = s.workout, w.entries.indices.contains(ei), w.entries[ei].sets.indices.contains(si) else { return false }
        let side = w.entries[ei].sets[si].sideUp
        guard side != "L" else { return false }
        let done = SessionCore.tick(s, entry: ei, set: si, side: side, w: nil, r: nil, at: 0, id: "").0
        return SessionCore.restSeconds(after: done, entry: ei, set: si) == nil
    }
}
