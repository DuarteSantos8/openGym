import Foundation

/*
 * The session as the watch keeps it, and every change to it, as pure functions: the watch app's
 * SessionStore only calls these, saves the state after each, and sends the events they return.
 * Tested with `swift test` (Tests/WatchCoreTests), no watch needed.
 *
 * The sync, case by case (the phone's side: frontend lib/watch-sync.js):
 *
 *   watch app never opened before the workout started on the phone
 *       the phone keeps its snapshot as the application context, which the watch reads when it
 *       launches (applySnapshot): it picks the running workout up where the phone has it.
 *   watch app killed and relaunched mid-workout
 *       the whole state is saved after every change and restored at launch; then the latest
 *       snapshot is applied over it, with the watch's own unconfirmed ticks kept (below).
 *   phone asleep, locked in a pocket, app killed, Bluetooth off, out of range
 *       the watch runs the session alone; each tick, start and finish is an event sent with
 *       transferUserInfo, which the system queues and delivers, in order, when it can; the phone
 *       applies each one once, by its id.
 *   a snapshot older than the watch's own ticks (sent before the phone applied them)
 *       a tick stays pending until a snapshot shows that set done at the tick's time or later;
 *       until then the snapshot's copy of that set is replaced by the watch's.
 *   the same set changed on both sides
 *       the later tick (`at`) wins, on both sides: here in applySnapshot, on the phone in the
 *       workout screen's watch handler.
 *   finished on the watch while the phone was away
 *       the workout leaves the watch at once; a snapshot that still shows it running (the phone
 *       has not heard yet) does not bring it back.
 *   finished on the phone while the watch was away
 *       a snapshot without it ends it here; ticks the watch made meanwhile are still sent, and
 *       the phone writes them into the saved workout.
 *   started on the watch while the phone was away
 *       kept until the phone reports it back running; a snapshot without it does not end it.
 */

struct PendingTick: Codable, Equatable {
    var w: Double?
    var r: Double?
    var at: Double
    /// A hold's seconds.
    var sec: Double?
}

struct SessionState: Codable, Equatable {
    var workout: ActiveWorkout?
    var ready: Ready?
    var settings = WatchSettings()
    var unit = "kg"
    var restSec: Double = 90
    /// A session started here that the phone has not reported back running yet.
    var startedHere: String?
    /// Sessions finished here that the phone may still report running for a while.
    var finishedHere: [String] = []
    /// Ticks made here, by "exerciseId#setIndex", until a snapshot shows them.
    var pending: [String: PendingTick] = [:]
    /// The exercise on screen.
    var entryIndex = 0
    /// Sets passed over here ("exerciseId#setIndex"), not done: the next one comes up instead.
    /// Optional, like every field added later, so a state saved by an older build still loads.
    var skipped: [String]?
}

typealias Event = [String: Any]

enum SessionCore {
    static func key(_ exId: String, _ si: Int, _ side: String? = nil) -> String {
        side.map { "\(exId)#\(si)#\($0)" } ?? "\(exId)#\(si)"
    }

    /// A snapshot from the phone, over what the watch has.
    static func applySnapshot(_ s0: SessionState, _ snap: Snapshot) -> SessionState {
        var s = s0
        s.ready = snap.ready
        if let u = snap.unit { s.unit = u }
        if let r = snap.restSec, r > 0 { s.restSec = r }
        if let st = snap.settings { s.settings = st }

        // A session started here that the phone has not reported back yet stays, whatever it sends.
        let unconfirmed = s.workout?.id != nil && s.workout?.id == s.startedHere
        guard var next = snap.active, !(next.id.map { s.finishedHere.contains($0) } ?? false) else {
            // No workout on the phone, or one the watch has finished already.
            if unconfirmed { return s }
            s.workout = nil
            s.pending = [:]
            return s
        }
        let same = next.id != nil && next.id == s.workout?.id
        if next.id != nil && next.id == s.startedHere { s.startedHere = nil }
        if !same && unconfirmed {
            // The phone runs a different workout than the one started here and not yet confirmed:
            // the watch keeps its own; the phone keeps its own (frontend: a start while another runs).
            return s
        }
        if !same {
            // Another workout (or the first one this watch sees): its own position, no old ticks.
            s.pending = [:]
            s.skipped = nil
            s.entryIndex = next.cur
        }
        // The watch's ticks the phone has not shown yet win; the later tick wins on a set both changed.
        for (ei, e) in next.entries.enumerated() {
            for (si, row) in e.sets.enumerated() {
                let k = key(e.id, si)
                if let p = s.pending[k] {
                    if row.done && (row.at ?? .infinity) >= p.at {
                        s.pending[k] = nil          // the phone has it (or a later change of its own)
                    } else {
                        next.entries[ei].sets[si].done = true
                        next.entries[ei].sets[si].w = p.w ?? row.w
                        next.entries[ei].sets[si].r = p.r ?? row.r
                        if let sec = p.sec { next.entries[ei].sets[si].sec = sec }
                        next.entries[ei].sets[si].at = p.at
                    }
                }
                // A per-side set: each side by itself, the same way.
                for side in ["L", "R"] {
                    let ks = key(e.id, si, side)
                    guard let p = s.pending[ks] else { continue }
                    let have = next.entries[ei].sets[si]
                    if have.sides?[side].done == true && (row.at ?? .infinity) >= p.at {
                        s.pending[ks] = nil
                    } else if have.sides != nil {
                        next.entries[ei].sets[si] = markSide(have, side, w: p.w, r: p.r, at: p.at)
                    } else {
                        s.pending[ks] = nil         // no longer a per-side set on the phone
                    }
                }
            }
        }
        s.entryIndex = min(max(0, s.entryIndex), next.entries.count)   // the last page is Finish
        s.workout = next
        return s
    }

    /// One side of a per-side set done, the row's own numbers following both sides (as the phone's
    /// syncSideAggregate: reps the sum, weight the heavier, done when both are).
    static func markSide(_ row0: SetRow, _ side: String, w: Double?, r: Double?, at: Double) -> SetRow {
        guard var sides = row0.sides else { return row0 }
        var row = row0
        var one = sides[side]
        one.done = true
        if let w = w { one.w = w }
        if let r = r { one.r = r }
        sides[side] = one
        row.sides = sides
        row.done = sides.L.done && sides.R.done
        row.r = (sides.L.r ?? 0) + (sides.R.r ?? 0)
        row.w = max(sides.L.w ?? 0, sides.R.w ?? 0)
        row.at = max(row0.at ?? 0, at)
        return row
    }

    /// A set ticked here: the state with it done, and the event for the phone. `side` ticks one
    /// side of a per-side set; `sec` is a hold's seconds; a cardio tick carries no numbers.
    static func tick(_ s0: SessionState, entry ei: Int, set si: Int, side: String? = nil, w: Double?, r: Double?, sec: Double? = nil,
                     at: Double, id: String, hr: [String: Double]? = nil, effort: Effort.Rating? = nil) -> (SessionState, Event?) {
        guard var workout = s0.workout, workout.entries.indices.contains(ei), workout.entries[ei].sets.indices.contains(si) else { return (s0, nil) }
        var s = s0
        let e = workout.entries[ei]
        let oneSide = side.flatMap { e.sets[si].sides != nil ? $0 : nil }
        if let side = oneSide {
            workout.entries[ei].sets[si] = markSide(e.sets[si], side, w: w, r: r, at: at)
        } else {
            workout.entries[ei].sets[si].done = true
            if let w = w { workout.entries[ei].sets[si].w = w }
            if let r = r { workout.entries[ei].sets[si].r = r }
            if let sec = sec { workout.entries[ei].sets[si].sec = sec }
            workout.entries[ei].sets[si].at = at
        }
        s.workout = workout
        s.pending[key(e.id, si, oneSide)] = PendingTick(w: w, r: r, at: at, sec: sec)
        var event: Event = [
            "id": id, "type": "setDone", "wid": workout.id ?? "", "exId": e.id,
            "entryIdx": ei, "setIdx": si, "at": at,
        ]
        if let w = w { event["w"] = w }
        if let r = r { event["r"] = r }
        if let sec = sec { event["sec"] = sec }
        if let side = oneSide { event["side"] = side }
        if let hr = hr { event["hr"] = hr }
        // "rpe": 8.5 or "rir": 2, never both; the phone puts it on the set (watch-sync.js effortFrom)
        if let e = effort, Effort.notches(e.kind) != nil { event[e.kind] = e.value }
        return (s, event)
    }

    /// A set passed over here: not done, the next one comes up (a tap on its dot brings it back).
    static func skip(_ s0: SessionState, entry ei: Int, set si: Int) -> SessionState {
        guard let w = s0.workout, w.entries.indices.contains(ei), w.entries[ei].sets.indices.contains(si) else { return s0 }
        var s = s0
        let k = key(w.entries[ei].id, si)
        s.skipped = Array(Set((s.skipped ?? []) + [k])).sorted()
        return s
    }

    static func isSkipped(_ s: SessionState, _ exId: String, _ si: Int) -> Bool {
        s.skipped?.contains(key(exId, si)) ?? false
    }

    /// Where to go after a set of exercise `ei` (set `si`) was done, and whether a rest comes first.
    ///   per-side set with a side to go   the same exercise, no rest (the other side now)
    ///   superset                          the next exercise of the group in turn; the rest only
    ///                                     after the last one of a round
    ///   otherwise                         this exercise while it has sets to do, then the next one
    ///                                     that has; after the last, the Finish page (index = count)
    static func next(after s: SessionState, entry ei: Int, set si: Int) -> (entry: Int, rest: Bool) {
        guard let w = s.workout, w.entries.indices.contains(ei) else { return (s.entryIndex, false) }
        let count = w.entries.count
        if w.entries[ei].sets.indices.contains(si), w.entries[ei].sets[si].sideUp != nil { return (ei, false) }
        let open: (Int) -> Bool = { setIndex(s, entry: $0) != nil }
        if let g = w.entries[ei].group {
            var lo = ei, hi = ei
            while lo > 0 && w.entries[lo - 1].group == g { lo -= 1 }
            while hi + 1 < count && w.entries[hi + 1].group == g { hi += 1 }
            if hi > lo {
                let members = Array(lo...hi)
                let inTurn = members.filter { $0 > ei } + members.filter { $0 <= ei }
                if let n = inTurn.first(where: open) { return (n, n <= ei) }
                if let n = ((hi + 1)..<count).first(where: open) ?? (0..<lo).first(where: open) { return (n, true) }
                return (count, true)
            }
        }
        if open(ei) { return (ei, true) }
        if let n = ((ei + 1)..<count).first(where: open) ?? (0..<ei).first(where: open) { return (n, true) }
        return (count, true)
    }

    /// Whether workout `wid`, gone from this snapshot, was discarded on the phone (not finished):
    /// then nothing of it is saved to Apple Health (#776). An older phone never says: saved, as before.
    static func discarded(_ wid: String?, in snap: Snapshot) -> Bool {
        guard let wid = wid else { return false }
        return snap.discarded?.contains(wid) ?? false
    }

    /// A set the phone ticked, which the watch did not: its heart rate is the watch's to work out
    /// (the phone has no sensor), from the watch session's readings up to `at`.
    struct PhoneTick: Equatable {
        var exId: String
        var entryIdx: Int
        var setIdx: Int
        /// When the phone ticked it (ms since 1970).
        var at: Double
    }

    /// The sets done in `after` and not in `before`, the same workout on both sides, oldest tick
    /// first. A set the watch ticked itself is done in `before` already (tick), so only the phone's
    /// show up here; a set without the phone's `at` is left out (no time to measure up to).
    /// One side of a per-side set counts too: the row's `at` is that side's tick.
    static func phoneTicks(_ before: ActiveWorkout?, _ after: ActiveWorkout?) -> [PhoneTick] {
        guard let b = before, let a = after, let wid = a.id, wid == b.id else { return [] }
        var out: [PhoneTick] = []
        for (ei, e) in a.entries.enumerated() {
            guard b.entries.indices.contains(ei), b.entries[ei].id == e.id else { continue }
            let old = b.entries[ei].sets
            for (si, row) in e.sets.enumerated() {
                guard let at = row.at, old.indices.contains(si) else { continue }
                let was = old[si]
                let newSide = ["L", "R"].contains { row.sides?[$0].done == true && was.sides?[$0].done != true }
                if (row.done && !was.done) || newSide { out.append(PhoneTick(exId: e.id, entryIdx: ei, setIdx: si, at: at)) }
            }
        }
        return out.sorted { $0.at < $1.at }
    }

    /// Of the deleted workouts the phone names, the ones this watch has not taken out of Apple Health
    /// yet (`done`: already removed, or found to have no copy of the watch's). Only workout ids.
    static func healthToDelete(gone: [String]?, done: [String]) -> [String] {
        let seen = Set(done)
        var out: [String] = []
        for id in gone ?? [] where id.hasPrefix("opengym-w-") && !seen.contains(id) && !out.contains(id) { out.append(id) }
        return out
    }

    /// `done` with these ids added, the newest kept (a few hundred is plenty: the phone names at
    /// most the last sixty deletions).
    static func healthDeleted(_ done: [String], adding ids: [String]) -> [String] {
        var out = done.filter { !ids.contains($0) }
        out.append(contentsOf: ids)
        return Array(out.suffix(300))
    }

    /// What the phone is told once they are out, so its own retries of them stop.
    static func healthDeletedEvent(_ ids: [String], id: String) -> Event? {
        ids.isEmpty ? nil : ["id": id, "type": "healthDeleted", "ids": ids]
    }

    /// The weigh-in before a workout started here, for the phone's body weight list.
    static func weighIn(_ w: Double, at: Double, id: String) -> Event? {
        guard w > 0, w < 700 else { return nil }
        return ["id": id, "type": "weighIn", "w": (w * 10).rounded() / 10, "at": at]
    }

    /// A ready session started here, with the body weight just weighed in (or none).
    static func start(_ s0: SessionState, _ session: ReadySession, wid: String, at: Double, id: String, bw: Double? = nil) -> (SessionState, Event) {
        var s = s0
        s.workout = ActiveWorkout(id: wid, name: session.name, unit: s.unit, cur: 0, restSec: s.restSec, rest: nil, entries: session.entries, start: at, healthType: session.healthType)
        s.startedHere = wid
        s.pending = [:]
        s.skipped = nil
        s.entryIndex = 0
        var event: Event = ["id": id, "type": "start", "routineIds": session.routineIds, "wid": wid, "at": at]
        if let bw = bw, bw > 0 { event["bw"] = (bw * 10).rounded() / 10 }
        return (s, event)
    }

    /// The session finished here, or discarded here (the phone drops it unsaved).
    static func finish(_ s0: SessionState, at: Double, id: String, discard: Bool = false) -> (SessionState, Event?) {
        guard let w = s0.workout else { return (s0, nil) }
        var s = s0
        s.workout = nil
        s.pending = [:]
        s.skipped = nil
        s.startedHere = nil
        if let wid = w.id { s.finishedHere = Array((s.finishedHere + [wid]).suffix(5)) }
        return (s, ["id": id, "type": discard ? "discard" : "finish", "wid": w.id ?? "", "at": at])
    }

    /// The set to do next in an exercise: the one picked, or the first not done.
    static func setIndex(_ s: SessionState, entry ei: Int, picked: Int? = nil) -> Int? {
        guard let w = s.workout, w.entries.indices.contains(ei) else { return nil }
        let sets = w.entries[ei].sets
        if let p = picked, sets.indices.contains(p), !sets[p].done { return p }
        let exId = w.entries[ei].id
        return sets.indices.first { !sets[$0].done && !isSkipped(s, exId, $0) }
    }

    /// Sets done and sets in all, for the complication's ring.
    static func progress(_ s: SessionState) -> (done: Int, total: Int) {
        guard let w = s.workout else { return (0, 0) }
        let all = w.entries.flatMap { $0.sets }.filter { !$0.warmup }
        return (all.filter { $0.done }.count, all.count)
    }

    /// The workout as the summary shows it at its end (here, or on the phone).
    static func summary(_ w: ActiveWorkout, end: Double, startedAt: Double? = nil, endedOnPhone: Bool = false) -> WorkoutSummary {
        var sets = 0, volume = 0.0
        var prs: [String] = []
        for e in w.entries {
            let work = e.sets.filter { !$0.warmup }
            for row in work {
                if let sides = row.sides {
                    for one in [sides.L, sides.R] where one.done { volume += (one.w ?? 0) * (one.r ?? 0) }
                    if row.done { sets += 1 }
                } else if row.done {
                    sets += 1
                    if !e.isTimed && !e.isCardio { volume += (row.w ?? 0) * (row.r ?? 0) }
                }
            }
            if let best = e.best, beatsBest(e, work.filter { $0.done }, best) { prs.append(e.name) }
        }
        let from = w.start ?? startedAt
        return WorkoutSummary(name: w.name, unit: w.unit, duration: from.map { max(0, (end - $0) / 1000) },
                              sets: sets, volume: volume, prs: prs, endedOnPhone: endedOnPhone)
    }

    /// Whether one of these done sets beats the best before this workout: a heavier weight (a
    /// lighter one when assisted), or more reps at the same; a longer hold. No history, no PR.
    static func beatsBest(_ e: Entry, _ done: [SetRow], _ best: BestSet) -> Bool {
        if e.isTimed {
            guard let b = best.sec, b > 0 else { return false }
            return done.contains { ($0.sec ?? 0) > b }
        }
        guard !e.isCardio, let bw = best.w, let br = best.r, bw > 0 || br > 0 else { return false }
        let assisted = e.assisted == true
        return done.contains { row in
            let w = row.w ?? 0, r = row.r ?? 0
            if w != bw { return w > 0 && (assisted ? w < bw : w > bw) }
            return r > br
        }
    }
}

/// The end of a workout, on one screen: how long, how much, and what was a first.
struct WorkoutSummary: Codable, Equatable {
    var name: String
    var unit: String
    /// Seconds.
    var duration: Double?
    /// Work sets done (a per-side set once both sides are).
    var sets: Int
    var volume: Double
    /// The exercises with a personal record in this workout.
    var prs: [String]
    var hrAvg: Double?
    var hrMax: Double?
    /// Active kilocalories, from the Apple Health workout.
    var calories: Double?
    /// The phone ended it (finished or discarded there) while the watch had it running.
    var endedOnPhone: Bool
}

/// After the watch turns the page by itself (a superset's partner, the next exercise, the end of a
/// rest), taps are ignored for a second: a second Done meant for the page that just left would
/// otherwise land on the new one and log a set nobody did. A swipe by hand unlocks it at once.
struct TouchLock: Equatable {
    static let seconds: TimeInterval = 1
    private(set) var until = Date.distantPast

    mutating func lock(at t: Date) { until = t.addingTimeInterval(TouchLock.seconds) }
    mutating func unlock() { until = .distantPast }
    func allows(at t: Date) -> Bool { t >= until }
}

/// The 3-2-1 before a workout started on the watch: the heart-rate sensor warms up meanwhile (it
/// needs a few seconds to lock on), so the first set has its heart rate. One second a number.
enum Countdown {
    static let seconds = 3

    /// The number up `elapsed` seconds after the countdown began: 3, 2, 1, then 0 (go).
    static func number(at elapsed: Double) -> Int {
        max(seconds - Int(max(elapsed, 0).rounded(.down)), 0)
    }
}

/// A workout left running (the lifter walked out without Finish): "All done?" after 20 minutes
/// without a logged set, ended and saved on its own after 45, at the time of its last set. Without
/// it the Apple Health session goes on counting minutes and calories for hours. Times in ms.
enum Idle: Equatable {
    case active, ask, end

    static let askAfter: Double = 20 * 60 * 1000
    static let endAfter: Double = 45 * 60 * 1000

    /// When the last set was logged, here or on the phone (one side of a per-side set counts),
    /// else when the workout started; nil when it says neither.
    static func lastSet(_ w: ActiveWorkout) -> Double? {
        let ticks = w.entries.flatMap { $0.sets }.compactMap { $0.at }.filter { $0 > 0 }
        return ticks.max() ?? w.start.flatMap { $0 > 0 ? $0 : nil }
    }

    /// What idle time counts from: the newest of the last set, when this watch picked the workout
    /// up, the last change to it from either side (SessionStore's activityAt, the same one
    /// SensorPlan uses) and a "keep going" answered.
    static func since(lastSet: Double, seen: Double?, activity: Double?, snooze: Double?) -> Double {
        [lastSet, seen ?? 0, activity ?? 0, snooze ?? 0].max() ?? lastSet
    }

    /// `since`: the last thing that counts (the last set, or a "keep going" answered since).
    static func state(since: Double, now: Double) -> Idle {
        let idle = now - since
        return idle >= endAfter ? .end : idle >= askAfter ? .ask : .active
    }
}

/*
 * RPE or RIR on a set, in the scale the phone's profile logs (lib/history.js EFFORT). Empty by
 * default: a set nobody rated sends no effort. The crown walks notches from "not rated" through
 * the scale from easy to hard, so turning up always means harder, whichever the scale:
 *   RPE   –, 6, 6.5, … 10      (half points, as on the phone)
 *   RIR   –, 5, 4, 3, 2, 1, 0  (whole reps left; 0 = failure, the far end of the crown)
 */
enum Effort {
    struct Rating: Equatable {
        var kind: String
        var value: Double
    }

    /// The scale's values from easy to hard, nil for a scale the watch does not know.
    static func notches(_ kind: String?) -> [Double]? {
        switch kind {
        case "rpe": return stride(from: 6.0, through: 10.0, by: 0.5).map { $0 }
        case "rir": return [5, 4, 3, 2, 1, 0]
        default: return nil
        }
    }

    /// "RPE" / "RIR": the phone's own column heading, the same word in every language.
    static func name(_ kind: String) -> String { kind == "rpe" ? "RPE" : "RIR" }

    /// The value at a crown position: 0 is not rated, 1… the scale; past either end it stops there.
    static func value(_ kind: String, at position: Int) -> Double? {
        guard let n = notches(kind), position > 0 else { return nil }
        return n[min(position, n.count) - 1]
    }

    /// Where a value sits on the crown (the nearest notch); 0 for not rated.
    static func position(_ kind: String, of value: Double?) -> Int {
        guard let n = notches(kind), let v = value else { return 0 }
        var best = 0
        for i in n.indices where abs(n[i] - v) < abs(n[best] - v) { best = i }
        return best + 1
    }

    /// Where the editor opens on a set not rated yet: a hard working set, RPE 8 / RIR 2.
    static func start(_ kind: String) -> Double { kind == "rpe" ? 8 : 2 }

    /// The phone's colour band (lib/effort.js EFFORT_BANDS), by RIR: 0 nothing left … 5 easy.
    static func band(_ kind: String, _ value: Double) -> Int {
        let rir = kind == "rpe" ? 10 - value : value
        let tops: [Double] = [0.25, 0.75, 1.5, 2.5, 3.5]
        return tops.firstIndex { rir <= $0 } ?? tops.count
    }
}

/*
 * The weigh-in's crown, in two parts: the whole kilos (or pounds) and the tenth after the point.
 * One crown in tenths moved a whole kilo in a flick and was fiddly to stop on the right one.
 */
enum WeighIn {
    /// 79.4 → (79, 4). Rounded to the tenth first, so 79.95 is (80, 0), never (79, 10).
    static func parts(_ v: Double) -> (whole: Double, tenth: Double) {
        let tenths = (max(0, v) * 10).rounded()
        return ((tenths / 10).rounded(.down), tenths.truncatingRemainder(dividingBy: 10))
    }

    /// (79, 4) → 79.4, on the tenth's grid (no 79.40000001 to send to the phone).
    static func join(whole: Double, tenth: Double) -> Double {
        let t = min(9, max(0, tenth.rounded()))
        return (whole.rounded() * 10 + t) / 10
    }
}
