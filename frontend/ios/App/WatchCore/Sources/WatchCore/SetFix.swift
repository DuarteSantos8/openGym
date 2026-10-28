import Foundation

/*
 * A logged set shown again on the set page to fix it (a rep miscounted, the wrong plate). Save sends
 * that set's setDone once more with a later time, which the phone already takes as the change that
 * counts, numbers and effort both (watch-sync.js). No new event or field. Nothing is un-logged:
 * moving away leaves the set as it was, and an effort can be changed but not taken off.
 */
struct SetFix: Equatable {
    /// What can change on one side (or on the whole set). A hold has only its seconds.
    struct Numbers: Equatable { var w: Double?, r: Double?, sec: Double?, effort: Double? }

    let entry: Int, set: Int, exId: String
    /// The set's time when it was opened: changed since (edited or un-logged on the phone), Save is refused.
    let at: Double?
    /// By side, "L" and "R" for a per-side set, "" for a whole one: as logged, and as changed here.
    let was: [String: Numbers]
    private(set) var now: [String: Numbers]
    /// The side on screen ("L" first), nil for a whole set.
    var side: String?

    static func open(_ s: SessionState, entry ei: Int, set si: Int) -> SetFix? {
        guard let w = s.workout, w.entries.indices.contains(ei), w.entries[ei].sets.indices.contains(si),
              !w.entries[ei].isCardio, w.entries[ei].sets[si].done else { return nil }
        let e = w.entries[ei], row = e.sets[si]
        var was: [String: Numbers] = [:]
        for side in row.sides == nil ? [""] : ["L", "R"] {
            let one = side.isEmpty ? nil : row.sides?[side]
            let effort = s.rated?[SessionCore.key(e.id, si, side.isEmpty ? nil : side)]
            was[side] = e.isTimed ? Numbers(sec: row.sec ?? 0, effort: effort)
                : Numbers(w: one?.w ?? row.w ?? 0, r: one?.r ?? row.r ?? 0, effort: effort)
        }
        return SetFix(entry: ei, set: si, exId: e.id, at: row.at, was: was, now: was, side: row.sides == nil ? nil : "L")
    }

    /// The set on screen, as the arm and the keypad know it (SessionCore.key).
    var key: String { SessionCore.key(exId, set, side) }

    func value(_ f: ValueField) -> Double {
        let n = now[side ?? ""]
        switch f { case .weight: return n?.w ?? 0; case .reps: return n?.r ?? 0; case .seconds: return n?.sec ?? 0 }
    }

    mutating func set(_ f: ValueField, _ v: Double) {
        switch f { case .weight: now[side ?? ""]?.w = v; case .reps: now[side ?? ""]?.r = v; case .seconds: now[side ?? ""]?.sec = v }
    }

    var effort: Double? {
        get { now[side ?? ""]?.effort }
        set { now[side ?? ""]?.effort = newValue }
    }

    /// Something differs from the set as logged, on either side: Save is on.
    var changed: Bool { now != was }

    /// The effort as logged, on the side on screen: once there is one, the editor stops above "none".
    var wasEffort: Double? { was[side ?? ""]?.effort }

    /// The set is still the one opened: same exercise, still done, not changed since.
    func still(_ s: SessionState) -> Bool {
        guard let w = s.workout, w.entries.indices.contains(entry), w.entries[entry].id == exId,
              w.entries[entry].sets.indices.contains(set) else { return false }
        let row = w.entries[entry].sets[set]
        return row.done && row.at == at
    }

    /// Each side that changed, ticked again (SessionCore.tick, so it stays pending like any tick) at a
    /// time after the set's own; nothing when nothing changed or the set is no longer the one opened.
    func save(_ s0: SessionState, at t: Double, id: () -> String, effort kind: String?) -> (SessionState, [Event]) {
        guard still(s0) else { return (s0, []) }
        var s = s0
        var out: [Event] = []
        let later = max(t, (at ?? 0) + 1)
        for k in now.keys.sorted() where now[k] != was[k] {
            guard let n = now[k] else { continue }
            let rating = kind.flatMap { kk in n.effort.map { Effort.Rating(kind: kk, value: $0) } }
            let (next, event) = SessionCore.tick(s, entry: entry, set: set, side: k.isEmpty ? nil : k,
                                                 w: n.w, r: n.r, sec: n.sec, at: later, id: id(), effort: rating)
            s = next
            if let event { out.append(event) }
        }
        return (s, out)
    }
}

/*
 * The ‹ › arrows on the set page: one set back or ahead in the exercise. A move only changes what is
 * on screen and sends nothing: a done set opens as a SetFix, a set not done comes up next (Done logs it
 * out of order, as a tap on its dot did), and home is the live set, the rest or "All sets done".
 */
enum SetNav {
    enum Move: Equatable { case fix(Int), pick(Int), home }

    /// ‹ (by -1) or › (by 1) from set `shown` (the set count: "All sets done"); nil: that arrow is off.
    /// `live`: a set not done may come up (the exercise is up, no rest runs); otherwise the arrows step
    /// over those to the done sets, and › past the last one is the way home.
    static func move(_ e: Entry, from shown: Int, by d: Int, fixing: Bool, live: Bool) -> Move? {
        var to = shown + d
        if !live { while e.sets.indices.contains(to), !e.sets[to].done { to += d } }
        guard to >= 0, to < e.sets.count || (fixing && d > 0) else { return nil }
        guard e.sets.indices.contains(to) else { return .home }
        return e.sets[to].done ? .fix(to) : .pick(to)
    }

    /// The set the rest's ‹ shows: the one logged last, in any exercise but cardio (no numbers on the watch).
    static func last(_ s: SessionState) -> (entry: Int, set: Int)? {
        var best: (entry: Int, set: Int, at: Double)?
        for (ei, e) in (s.workout?.entries ?? []).enumerated() where !e.isCardio {
            for (si, row) in e.sets.enumerated() where row.done && (row.at ?? 0) >= (best?.at ?? -1) {
                best = (ei, si, row.at ?? 0)
            }
        }
        return best.map { ($0.entry, $0.set) }
    }
}
