import Foundation

/// A menu disc: on, off, locked (shown but not changeable) or not shown.
enum Disc: Equatable { case on, off, locked, hidden }

enum MarkKind: String, Codable { case warmup, failure, drop }

/// A set menu change made here, kept until the phone has applied it (`acked`) so an older snapshot
/// does not undo it. `w`, `r`, `done` are the set as the watch saw it: its identity.
struct PendingEdit: Codable, Equatable {
    var id: String
    var exId: String
    /// "mark", "add" or "remove"
    var op: String
    var setIdx: Int?
    var kind: MarkKind?
    var on: Bool?
    var w: Double?
    var r: Double?
    var done: Bool?
    /// Which of the workout's entries: an exercise can be in it twice (combined routines). Nil in states saved before.
    var entryIdx: Int? = nil

    /// Its entry in `w`: the one it was made on while that is still this exercise, else the first with its id.
    func entry(in w: ActiveWorkout) -> Int? {
        if let i = entryIdx, w.entries.indices.contains(i), w.entries[i].id == exId { return i }
        return w.entries.firstIndex { $0.id == exId }
    }
}

/// What the set menu offers for one set, mirroring the phone's menu (Workout.jsx, canBeWarmup,
/// applyWarmToggle).
struct MenuOffer: Equatable {
    var warmup: Disc
    var failure: Disc
    var drop: Disc
    /// The first drop's weight, for the "Drop 50" label.
    var dropWeight: Double?
    var canAdd: Bool
    var canRemove: Bool
}

enum SetMenu {
    static func offer(_ e: Entry, set si: Int) -> MenuOffer {
        guard e.sets.indices.contains(si) else {
            return MenuOffer(warmup: .hidden, failure: .hidden, drop: .hidden, dropWeight: nil, canAdd: false, canRemove: false)
        }
        let s = e.sets[si]
        let reps = e.mode == "reps"
        // `drops` alone: turned on here, the weight comes with the phone's snapshot
        let isDrop = s.drop != nil || s.drops != nil
        let rp = s.rp == true

        var warmup = Disc.hidden
        if reps {
            // a done set too, as the phone's own menu (Workout.jsx "Make it a warm-up set")
            if s.warmup { warmup = .on }
            else {
                // a straight set, and one work set must stay
                let otherWork = e.sets.indices.contains { $0 != si && !e.sets[$0].warmup }
                warmup = (isDrop || rp || !otherWork) ? .locked : .off
            }
        }

        var failure = Disc.hidden
        if !e.isCardio { failure = s.warmup ? .locked : (s.failure == true ? .on : .off) }

        var drop = Disc.hidden
        if reps && !rp {
            // with 2+ drops the phone has to edit them
            drop = s.warmup ? .locked : (!isDrop ? .off : ((s.drops ?? 1) > 1 ? .locked : .on))
        }

        // Half of a timed per-side pair: the phone adds and removes the pair, so the watch leaves those to it.
        let paired = partner(e.sets, si) != nil
        return MenuOffer(warmup: warmup, failure: failure, drop: drop, dropWeight: s.drop,
                         canAdd: !e.isCardio && !paired, canRemove: e.sets.count > 1 && !paired)
    }

    /// The other half of a timed per-side pair (the phone's setSpanAt), or nil.
    static func partner(_ sets: [SetRow], _ si: Int) -> Int? {
        guard sets.indices.contains(si) else { return nil }
        if sets[si].side == "L", sets.indices.contains(si + 1), sets[si + 1].side == "R" { return si + 1 }
        if sets[si].side == "R", si > 0, sets[si - 1].side == "L" { return si - 1 }
        return nil
    }

    /// The phone says it understands the set events.
    static func available(_ s: SessionState) -> Bool { s.settings.setMenu == true }

    /// A warm-up, failure or drop mark switched here, as the phone's set menu does it.
    static func mark(_ s: SessionState, entry ei: Int, set si: Int, _ kind: MarkKind, on: Bool, at: Double, id: String) -> (SessionState, Event?) {
        edit(s, entry: ei, set: si, op: "mark", kind: kind, on: on, at: at, id: id)
    }

    /// A copy of the last set at the end of the exercise, as the phone's addSet.
    static func addSet(_ s: SessionState, entry ei: Int, at: Double, id: String) -> (SessionState, Event?) {
        edit(s, entry: ei, set: nil, op: "add", kind: nil, on: nil, at: at, id: id)
    }

    /// The set taken out (the view sends it once its Undo has passed).
    static func removeSet(_ s: SessionState, entry ei: Int, set si: Int, at: Double, id: String) -> (SessionState, Event?) {
        edit(s, entry: ei, set: si, op: "remove", kind: nil, on: nil, at: at, id: id)
    }

    /// The watch's edits over a snapshot that may not have them yet.
    static func replay(_ edits: [PendingEdit], on w: ActiveWorkout) -> ActiveWorkout {
        edits.reduce(w) { apply($1, on: $0)?.0 ?? $0 }
    }

    /// "exerciseId#setIndex" keys of one exercise moved to the rows' new places; nil drops the key.
    static func remapKeys(_ s0: SessionState, exId: String, map: (Int) -> Int?) -> SessionState {
        let prefix = exId + "#"
        func move(_ k: String) -> String? {
            guard k.hasPrefix(prefix) else { return k }
            var parts = k.dropFirst(prefix.count).split(separator: "#", omittingEmptySubsequences: false).map(String.init)
            guard let si = Int(parts[0]) else { return k }
            guard let n = map(si) else { return nil }
            parts[0] = String(n)
            return prefix + parts.joined(separator: "#")
        }
        var s = s0
        s.pending = Dictionary(s0.pending.compactMap { k, v in move(k).map { ($0, v) } }) { a, _ in a }
        s.skipped = s0.skipped.map { $0.compactMap(move).sorted() }
        s.efforts = s0.efforts.map { Dictionary($0.compactMap { k, v in move(k).map { ($0, v) } }) { a, _ in a } }
        return s
    }

    private static func edit(_ s0: SessionState, entry ei: Int, set si: Int?, op: String, kind: MarkKind?, on: Bool?, at: Double, id: String) -> (SessionState, Event?) {
        guard let w = s0.workout, w.entries.indices.contains(ei) else { return (s0, nil) }
        let e = w.entries[ei]
        let row = si.flatMap { e.sets.indices.contains($0) ? e.sets[$0] : nil }
        if si != nil && row == nil { return (s0, nil) }
        let pe = PendingEdit(id: id, exId: e.id, op: op, setIdx: si, kind: kind, on: on, w: row?.w, r: row?.r, done: row?.done, entryIdx: ei)
        guard let (next, moved) = apply(pe, on: w, entry: ei) else { return (s0, nil) }
        var s = remapKeys(s0, exId: e.id) { moved.indices.contains($0) ? moved[$0] : $0 }
        s.workout = next
        s.edits = (s.edits ?? []) + [pe]
        var event: Event = ["id": id, "type": op == "mark" ? "setMark" : op == "add" ? "addSet" : "removeSet",
                            "wid": w.id ?? "", "exId": e.id, "entryIdx": ei, "at": at]
        if let si = si, let row = row {
            event["setIdx"] = si
            event["done"] = row.done
            if let v = row.w { event["w"] = v }
            if let v = row.r { event["r"] = v }
        }
        if let kind = kind, let on = on { event[kind.rawValue] = on }
        return (s, event)
    }

    /// One edit on a workout: the workout after it and where each old row went (nil: removed), or
    /// nil when its set is no longer the one it was made on, or the menu would not offer it.
    /// `sameSet: false` skips the check that the set is still the one the edit was made on: where the
    /// rows move to is all that is asked then (SessionCore's trial run).
    static func apply(_ pe: PendingEdit, on w0: ActiveWorkout, entry: Int? = nil, sameSet: Bool = true) -> (ActiveWorkout, [Int?])? {
        guard let ei = entry ?? pe.entry(in: w0) else { return nil }
        var w = w0
        var sets = w.entries[ei].sets
        let same: [Int?] = sets.indices.map { $0 }
        if pe.op == "add" {
            guard offer(w.entries[ei], set: sets.count - 1).canAdd, let last = sets.last else { return nil }
            var sides = last.sides
            sides?.L.done = false; sides?.R.done = false
            sets.append(SetRow(w: last.w, r: last.r, sec: last.sec, done: false, warmup: false, at: nil, sides: sides))
            w.entries[ei].sets = sets
            return (w, same)
        }
        guard let si = pe.setIdx, sets.indices.contains(si) else { return nil }
        let row = sets[si]
        guard !sameSet || (row.w == pe.w && row.r == pe.r && row.done == pe.done) else { return nil }
        let o = offer(w.entries[ei], set: si)
        if pe.op == "remove" {
            guard o.canRemove else { return nil }
            sets.remove(at: si)
            w.entries[ei].sets = sets
            return (w, same.indices.map { $0 < si ? $0 : $0 == si ? nil : $0 - 1 })
        }
        guard let kind = pe.kind, let on = pe.on else { return nil }
        let disc = kind == .warmup ? o.warmup : kind == .failure ? o.failure : o.drop
        guard disc == (on ? .off : .on) else { return nil }
        var n = row
        switch kind {
        case .failure:
            n.failure = on ? true : nil
            // the phone marks the whole pair (toggleFailureSpan)
            if let p = partner(sets, si) { sets[p].failure = on ? true : nil }
        case .drop: n.drop = nil; n.drops = on ? 1 : nil
        case .warmup:
            // the phone's makeWarmupAt / makeWorkAt: a warm-up keeps only weight, reps, tick and sides
            if on { n = SetRow(w: row.w, r: row.r, sec: nil, done: row.done, warmup: true, at: row.at, sides: row.sides) }
            else { n.warmup = false }
            // placeRow: out of its place, in where the work sets begin
            var order = Array(sets.indices).filter { $0 != si }
            let rest = order.map { sets[$0] }
            order.insert(si, at: rest.firstIndex { !$0.warmup } ?? rest.count)
            w.entries[ei].sets = order.map { $0 == si ? n : sets[$0] }
            return (w, sets.indices.map { old in order.firstIndex(of: old) })
        }
        sets[si] = n
        w.entries[ei].sets = sets
        return (w, same)
    }
}
