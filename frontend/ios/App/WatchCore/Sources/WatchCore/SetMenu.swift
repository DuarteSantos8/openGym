import Foundation

/// A menu disc: on, off, locked (shown but not changeable) or not shown.
enum Disc: Equatable { case on, off, locked, hidden }

enum MarkKind: String, Codable { case warmup, failure, drop }

/// A set menu change made here: the event the phone gets (setMark, addSet or removeSet,
/// docs/WATCH_SYNC.md), kept until the phone has applied it (`acked`) and replayed over every
/// snapshot until then, so an older snapshot does not undo it. It names its set by the set's id
/// (`sid`, protocol 2), by its place only while the phone has sent none.
struct PendingEdit: Codable, Equatable {
    var id: String
    /// "setMark", "addSet" or "removeSet"
    var type: String
    var wid: String
    var exId: String
    /// Which of the workout's entries: an exercise can be in it twice (combined routines).
    var entryIdx: Int
    var setIdx: Int?
    /// The set's id; for an add, the one the watch made up for the new set ("w-<uuid>").
    var sid: String?
    var kind: MarkKind?
    var on: Bool?
    /// An add: the numbers of the set it copies.
    var w: Double?
    var r: Double?
    var sec: Double?
    var at: Double
    /// A removal still inside its Undo time, not sent yet; `row` is the set taken out, for Undo.
    var held: Bool?
    var row: SetRow?

    /// Its entry in `w`: the one it was made on while that is still this exercise, else the first with its id.
    func entry(in w: ActiveWorkout) -> Int? {
        if w.entries.indices.contains(entryIdx), w.entries[entryIdx].id == exId { return entryIdx }
        return w.entries.firstIndex { $0.id == exId }
    }

    /// The event for the phone.
    var event: Event {
        var e: Event = ["id": id, "type": type, "wid": wid, "exId": exId, "entryIdx": entryIdx, "at": at]
        if let si = setIdx { e["setIdx"] = si }
        if let sid = sid { e["sid"] = sid }
        if let kind = kind, let on = on { e[kind.rawValue] = on }
        if let v = w { e["w"] = v }
        if let v = r { e["r"] = v }
        if let v = sec { e["sec"] = v }
        return e
    }
}

/// What the set menu offers for one set, mirroring the phone's menu (Workout.jsx, canBeWarmup,
/// applyWarmToggle) and what the phone takes from a watch (removeWatchSet).
struct MenuOffer: Equatable {
    var warmup: Disc
    var failure: Disc
    var drop: Disc
    /// The first drop's weight, for the "Drop 50" label.
    var dropWeight: Double?
    var canAdd: Bool
    var canRemove: Bool

    /// Whether switching `kind` to `on` is offered: its disc shows the other way and is not locked.
    func canMark(_ kind: MarkKind, _ on: Bool) -> Bool {
        (kind == .warmup ? warmup : kind == .failure ? failure : drop) == (on ? .off : .on)
    }
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
        // The phone never takes out a set that is done (or has a side done), nor an exercise's only
        // row (removeWatchSet); a set the phone has not named yet cannot be named in a removeSet.
        let removable = !s.done && s.sides?.L.done != true && s.sides?.R.done != true && e.sets.count > 1 && !paired && s.sid != nil
        return MenuOffer(warmup: warmup, failure: failure, drop: drop, dropWeight: s.drop,
                         canAdd: !e.isCardio && !paired, canRemove: removable)
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
        guard var pe = made(s, entry: ei, set: si, type: "setMark", at: at, id: id) else { return (s, nil) }
        pe.kind = kind
        pe.on = on
        guard let next = record(s, pe) else { return (s, nil) }
        return (next, pe.event)
    }

    /// A copy of the last set at the end of the exercise, with an id of the watch's own (addWatchSet).
    static func addSet(_ s: SessionState, entry ei: Int, at: Double, id: String, sid: String = "w-" + UUID().uuidString) -> (SessionState, Event?) {
        guard let w = s.workout, w.entries.indices.contains(ei), let last = w.entries[ei].sets.last,
              offer(w.entries[ei], set: w.entries[ei].sets.count - 1).canAdd else { return (s, nil) }
        let pe = PendingEdit(id: id, type: "addSet", wid: w.id ?? "", exId: w.entries[ei].id, entryIdx: ei, sid: sid,
                             w: last.w, r: last.r, sec: last.sec, at: at)
        guard let next = record(s, pe) else { return (s, nil) }
        return (next, pe.event)
    }

    /// The set taken out here at once; its event is held for Undo: `release` sends it, `undo` takes it back.
    static func removeSet(_ s: SessionState, entry ei: Int, set si: Int, at: Double, id: String) -> SessionState? {
        guard var pe = made(s, entry: ei, set: si, type: "removeSet", at: at, id: id),
              offer(s.workout!.entries[ei], set: si).canRemove else { return nil }
        pe.held = true
        pe.row = s.workout!.entries[ei].sets[si]
        return record(s, pe)
    }

    /// The held removals, oldest first (one at a time while the app runs; any left at a launch go out then).
    static func held(_ s: SessionState) -> [String] { (s.edits ?? []).filter { $0.held == true }.map(\.id) }

    /// A held removal's Undo time is over: its event, now on its way. It stays an edit until acked.
    static func release(_ s0: SessionState, id: String) -> (SessionState, Event?) {
        guard var edits = s0.edits, let i = edits.firstIndex(where: { $0.id == id && $0.held == true }) else { return (s0, nil) }
        edits[i].held = nil
        edits[i].row = nil
        var s = s0
        s.edits = edits
        return (s, edits[i].event)
    }

    /// Undo of a held removal: nothing is sent, and the set is back in its place.
    static func undo(_ s0: SessionState, id: String) -> SessionState {
        guard let pe = s0.edits?.first(where: { $0.id == id && $0.held == true }), let row = pe.row,
              let w0 = s0.workout, let ei = pe.entry(in: w0) else { return s0 }
        var s = s0
        let rest = (s0.edits ?? []).filter { $0.id != id }
        s.edits = rest.isEmpty ? nil : rest
        var w = w0
        let si = min(pe.setIdx ?? w.entries[ei].sets.count, w.entries[ei].sets.count)
        guard pe.sid.flatMap({ find(w, sid: $0) }) == nil else { return s }
        w.entries[ei].sets.insert(row, at: si)
        s.workout = w
        return remapKeys(s, exId: pe.exId, entry: ei) { $0 >= si ? $0 + 1 : $0 }
    }

    /// The watch's edits over a snapshot that may not have them yet, in the order they were made.
    static func replay(_ edits: [PendingEdit], on w: ActiveWorkout) -> ActiveWorkout {
        edits.reduce(w) { apply($1, on: $0)?.0 ?? $0 }
    }

    /// The place keys ("e<entry>:exerciseId#setIndex": skipped sets, efforts, pending ticks, or a
    /// pending tick's 1.4.4 form) of one exercise moved to the rows' new
    /// places; nil drops the key. Ticks keyed by the set's id ("s:<sid>") need no move.
    static func remapKeys(_ s0: SessionState, exId: String, entry: Int, map: (Int) -> Int?) -> SessionState {
        func move(_ k: String, _ prefix: String) -> String? {
            guard k.hasPrefix(prefix) else { return k }
            var parts = k.dropFirst(prefix.count).split(separator: "#", omittingEmptySubsequences: false).map(String.init)
            guard let si = Int(parts[0]) else { return k }
            guard let n = map(si) else { return nil }
            parts[0] = String(n)
            return prefix + parts.joined(separator: "#")
        }
        func placed(_ k: String) -> String? { move(k, "e\(entry):\(exId)#") }
        var s = s0
        s.skipped = s0.skipped.map { $0.compactMap(placed).sorted() }
        s.efforts = s0.efforts.map { Dictionary($0.compactMap { k, v in placed(k).map { ($0, v) } }) { a, _ in a } }
        s.pending = Dictionary(s0.pending.compactMap { k, v in (k.hasPrefix("e\(entry):") ? placed(k) : move(k, exId + "#")).map { ($0, v) } }) { a, _ in a }
        return s
    }

    /// One edit on a workout: the workout after it and where each of the exercise's old rows went
    /// (nil: removed), or nil when it does not apply (its set is gone, it is there already, or the
    /// phone would not take it).
    static func apply(_ pe: PendingEdit, on w0: ActiveWorkout) -> (ActiveWorkout, [Int?])? {
        var w = w0
        if pe.type == "addSet" {
            guard let sid = pe.sid, find(w, sid: sid) == nil, let ei = pe.entry(in: w) else { return nil }
            let sets = w.entries[ei].sets
            // The phone's rowLike: the last row's shape, not done, no marks, the watch's numbers.
            var sides = sets.last?.sides
            sides?.L.done = false; sides?.R.done = false
            w.entries[ei].sets.append(SetRow(w: pe.w, r: pe.r, sec: pe.sec, done: false, warmup: false, at: nil, sides: sides, sid: sid))
            return (w, sets.indices.map { $0 })
        }
        guard let (ei, si) = place(pe, in: w) else { return nil }
        var sets = w.entries[ei].sets
        let same: [Int?] = sets.indices.map { $0 }
        let row = sets[si]
        if pe.type == "removeSet" {
            // removeWatchSet's rule: never a set that is done, nor the exercise's only row
            guard !row.done, row.sides?.L.done != true, row.sides?.R.done != true, sets.count > 1 else { return nil }
            sets.remove(at: si)
            w.entries[ei].sets = sets
            return (w, same.indices.map { $0 < si ? $0 : $0 == si ? nil : $0 - 1 })
        }
        guard pe.type == "setMark", let kind = pe.kind, let on = pe.on,
              offer(w.entries[ei], set: si).canMark(kind, on) else { return nil }
        var n = row
        switch kind {
        case .failure:
            n.failure = on ? true : nil
            // the phone marks the whole pair (toggleFailureSpan)
            if let p = partner(sets, si) { sets[p].failure = on ? true : nil }
        case .drop: n.drop = nil; n.drops = on ? 1 : nil
        case .warmup:
            // the phone's makeWarmupAt / makeWorkAt: a warm-up keeps weight, reps, tick, sides and its id
            if on { n = SetRow(w: row.w, r: row.r, sec: nil, done: row.done, warmup: true, at: row.at, sides: row.sides, sid: row.sid) }
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

    /// The row an edit names: by its id, else (no id yet) by its place.
    private static func place(_ pe: PendingEdit, in w: ActiveWorkout) -> (Int, Int)? {
        if let sid = pe.sid { return find(w, sid: sid) }
        guard let ei = pe.entry(in: w), let si = pe.setIdx, w.entries[ei].sets.indices.contains(si) else { return nil }
        return (ei, si)
    }

    private static func find(_ w: ActiveWorkout, sid: String) -> (Int, Int)? {
        for (ei, e) in w.entries.enumerated() {
            if let si = e.sets.firstIndex(where: { $0.sid == sid }) { return (ei, si) }
        }
        return nil
    }

    /// The edit for set `si` of entry `ei`, before its own fields.
    private static func made(_ s: SessionState, entry ei: Int, set si: Int, type: String, at: Double, id: String) -> PendingEdit? {
        guard let w = s.workout, w.entries.indices.contains(ei), w.entries[ei].sets.indices.contains(si) else { return nil }
        let e = w.entries[ei]
        return PendingEdit(id: id, type: type, wid: w.id ?? "", exId: e.id, entryIdx: ei, setIdx: si, sid: e.sets[si].sid, at: at)
    }

    /// The edit on the watch's own state at once, kept until acked; nil when it does not apply.
    private static func record(_ s0: SessionState, _ pe: PendingEdit) -> SessionState? {
        guard let w = s0.workout, let (next, moved) = apply(pe, on: w) else { return nil }
        var s = remapKeys(s0, exId: pe.exId, entry: pe.entry(in: w) ?? pe.entryIdx) { moved.indices.contains($0) ? moved[$0] : $0 }
        s.workout = next
        s.edits = (s.edits ?? []) + [pe]
        return s
    }
}
