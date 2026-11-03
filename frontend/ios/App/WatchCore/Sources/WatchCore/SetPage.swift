import Foundation

func formatNumber(_ v: Double) -> String {
    v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}

/// What the set page says about the set up next, as text and numbers; the views only draw it.
enum SetPage {
    /// "Set n of m": working sets only, by place in the exercise (a warm-up has no number).
    struct Position: Equatable {
        var number: Int?
        var total: Int
        /// Working sets done (a per-side set once both sides are), as the Overview counts them.
        var done: Int
    }

    static func position(_ e: Entry, set si: Int) -> Position {
        let work = e.sets.indices.filter { !e.sets[$0].warmup }
        let isWork = e.sets.indices.contains(si) && !e.sets[si].warmup
        return Position(number: isWork ? work.filter { $0 <= si }.count : nil,
                        total: work.count, done: work.filter { e.sets[$0].done }.count)
    }

    /// The phone's last-time text is the work sets of the last session joined by ", ": this set's
    /// place, else the last one. A warm-up has none (the phone leaves warm-ups out of it too).
    static func lastTime(_ last: String?, _ p: Position) -> String? {
        let parts = (last ?? "").components(separatedBy: ", ").filter { !$0.isEmpty }
        guard !parts.isEmpty, let n = p.number else { return nil }
        return parts[min(max(n, 1), parts.count) - 1]
    }

    /// The plan still ahead: "62.5 kg × 8-8-7", the current set's reps in `now` (bold on screen).
    struct Planned: Equatable {
        var head = "", now = "", tail = ""
        var text: String { head + now + tail }
        var spoken: String { text.replacingOccurrences(of: "-", with: ", ") }
    }

    /// Work sets from `si` on that are not done or skipped (the one up counts even if skipped),
    /// equal weights run together: "60 kg × 10 · 70 kg × 8-8". Reps sets only.
    static func planned(_ e: Entry, set si: Int, unit: String, skipped: (Int) -> Bool) -> Planned? {
        guard e.mode == "reps", e.sets.indices.contains(si) else { return nil }
        let left = e.sets.indices.filter {
            $0 >= si && !e.sets[$0].done && !e.sets[$0].warmup && ($0 == si || !skipped($0))
        }
        guard !left.isEmpty else { return nil }
        var runs: [(w: Double, reps: [Double])] = []
        for i in left {
            let p = plan(e.sets[i])
            if let prev = runs.last, prev.w == p.w { runs[runs.count - 1].reps.append(p.r) } else { runs.append((p.w, [p.r])) }
        }
        func load(_ w: Double) -> String {
            e.isBodyweight ? (w > 0 ? "+\(formatNumber(w)) \(unit) × " : "") : "\(formatNumber(w)) \(unit) × "
        }
        let reps = runs[0].reps.map(formatNumber)
        let bold = !e.sets[si].warmup          // a warm-up bolds nothing
        var out = Planned(head: load(runs[0].w))
        if bold { out.now = reps[0]; out.tail = reps.dropFirst().map { "-" + $0 }.joined() }
        else { out.tail = reps.joined(separator: "-") }
        out.tail += runs.dropFirst().map { " · " + load($0.w) + $0.reps.map(formatNumber).joined(separator: "-") }.joined()
        return out
    }

    /// A per-side set plans by its side up next (as the boxes show it).
    static func plan(_ r: SetRow) -> (w: Double, r: Double) {
        let one = r.sideUp.flatMap { r.sides?[$0] } ?? r.sides?.L
        return (one?.w ?? r.w ?? 0, one?.r ?? r.r ?? 0)
    }
}
