import Foundation

/*
 * The set page's moves and fixes, as plain functions (tested in SetNavTests.swift):
 *
 *   place    "Set 2 of 4": a work set among the work sets, a warm-up among the warm-ups
 *   step     ‹ and ›: the set before or after, inside the exercise
 *   fix      a set already logged, with other numbers: the same setDone again with a later `at`,
 *            which the phone already takes as an overwrite (Workout.jsx setDone: the later tick
 *            wins). No heart rate goes with it, so the phone keeps the set's own.
 *   keypad   an odd value typed in (62.25 kg), when the crown's steps don't land on it
 */

/// One set of the workout: its exercise and its row.
struct SetRef: Hashable {
    var entry: Int
    var set: Int
}

enum SetNav {
    /// The set's number and how many of its kind there are.
    static func place(_ e: Entry, _ si: Int) -> (n: Int, of: Int) {
        guard e.sets.indices.contains(si) else { return (0, 0) }
        let warm = e.sets[si].warmup
        let same = e.sets.indices.filter { e.sets[$0].warmup == warm }
        return ((same.firstIndex(of: si) ?? 0) + 1, same.count)
    }

    /// The set `by` rows away from `si` in the exercise, or nil past either end.
    static func step(_ e: Entry, from si: Int, by d: Int) -> Int? {
        let to = si + d
        return e.sets.indices.contains(to) ? to : nil
    }
}

enum SetFix {
    struct Numbers: Equatable {
        var w: Double?
        var r: Double?
        var sec: Double?
    }

    /// What was logged on a done set (one side's numbers on a per-side set), or nil when that set
    /// (or that side) is not done.
    static func logged(_ row: SetRow, side: String?) -> Numbers? {
        if let side = side, let sides = row.sides {
            let one = sides[side]
            return one.done ? Numbers(w: one.w, r: one.r, sec: nil) : nil
        }
        return row.done ? Numbers(w: row.w, r: row.r, sec: row.sec) : nil
    }

    /// A done set with new numbers: the state with them and the event for the phone, the setDone
    /// it already knows, a moment later than the set's own tick so it wins there. Nil for a set
    /// that is not done, cardio (logged on the phone), or a row that is gone.
    static func correct(_ s: SessionState, entry ei: Int, set si: Int, side: String?, to n: Numbers,
                        effort: Effort.Rating? = nil, now: Double, id: String) -> (SessionState, Event?) {
        guard let w = s.workout, w.entries.indices.contains(ei), w.entries[ei].sets.indices.contains(si) else { return (s, nil) }
        let e = w.entries[ei]
        let row = e.sets[si]
        let oneSide = side.flatMap { row.sides != nil ? $0 : nil }
        guard !e.isCardio, logged(row, side: oneSide) != nil else { return (s, nil) }
        let at = max(now, (row.at ?? 0) + 1)
        var weight = n.w, reps = n.r, sec = n.sec
        if e.isTimed {
            reps = nil
            if (row.w ?? 0) <= 0 { weight = nil }      // a hold without weight stays without
        } else {
            sec = nil
        }
        return SessionCore.tick(s, entry: ei, set: si, side: oneSide, w: weight, r: reps, sec: sec, at: at, id: id, effort: effort)
    }
}

/// A number typed on the watch's own keypad: whole digits, a point, `decimals` after it.
/// The Crown wheel's values (Coaich G122): every step of the grid from the bottom of the range to the top, plus
/// the value now if it is off the grid (a keypad's 62.25), so the wheel opens on what the box shows.
enum CrownWheel {
    static func choices(step: Double, range: ClosedRange<Double>, current: Double) -> [Double] {
        guard step > 0 else { return [current] }
        let n = Int(((range.upperBound - range.lowerBound) / step).rounded(.down))
        // On the hundredth's grid: no 7.500000001 that would never equal the box's 7.5.
        var all = (0...n).map { ((range.lowerBound + Double($0) * step) * 100).rounded() / 100 }
        if range.contains(current), !all.contains(current) { all.append(current); all.sort() }
        return all
    }
}

struct Keypad: Equatable {
    private(set) var text = ""
    let decimals: Int
    static let maxWhole = 4

    init(decimals: Int) { self.decimals = decimals }

    mutating func press(_ key: String) {
        if key == "." {
            guard decimals > 0, !text.contains(".") else { return }
            text = (text.isEmpty ? "0" : text) + "."
            return
        }
        guard key.count == 1, let c = key.first, c.isASCII, c.isNumber else { return }
        if let dot = text.firstIndex(of: ".") {
            guard text.distance(from: dot, to: text.endIndex) - 1 < decimals else { return }
            text += key
        } else if text == "0" {
            text = key                                  // no leading zeros
        } else if text.count < Keypad.maxWhole {
            text += key
        }
    }

    mutating func back() {
        if !text.isEmpty { text.removeLast() }
    }

    /// The number typed, nil while nothing is ("62." is 62).
    var value: Double? {
        guard !text.isEmpty else { return nil }
        return Double(text.hasSuffix(".") ? String(text.dropLast()) : text)
    }

    /// Whether it may be saved: something typed, inside the field's range.
    func fits(_ range: ClosedRange<Double>) -> Bool {
        value.map { range.contains($0) } ?? false
    }
}

/// The phone's "Last time" line, made to fit a watch: one load, then the reps of each set
/// ("60 kg × 8, 60 kg × 8, 60 kg × 7" → "60 kg × 8, 8, 7"). Mixed loads, and anything but plain sets, stay as sent.
public enum LastTime {
    public static func compact(_ s: String) -> String {
        let sets = s.components(separatedBy: ", ")
        guard sets.count > 1 else { return s }
        let parts = sets.map { set in set.range(of: "×", options: .backwards).map { (set[..<$0.upperBound], set[$0.upperBound...]) } }
        // Only plain sets: a drop ("100×8 ↘ 80×6"), an "F", bursts ("10+4+2") or two sides stay as sent.
        func plain(_ p: (Substring, Substring)?) -> Bool {
            guard let p = p, !p.0.contains("↘"), !p.0.contains("/") else { return false }
            let reps = p.1.trimmingCharacters(in: .whitespaces)
            return !reps.isEmpty && reps.allSatisfy(\.isNumber)
        }
        guard let first = parts[0], parts.allSatisfy({ plain($0) && $0?.0 == first.0 }) else { return s }
        let gap = first.1.hasPrefix(" ") ? " " : ""
        return first.0 + gap + parts.map { $0!.1.trimmingCharacters(in: .whitespaces) }.joined(separator: ", ")
    }
}
