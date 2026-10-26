import Foundation

/// Supersets as SessionCore.next walks them: neighbours with the same `group`.
enum Superset {
    /// The runs of the entry list in order, singles included: [0...0, 1...2, 3...3].
    static func runs(_ entries: [Entry]) -> [ClosedRange<Int>] {
        var out: [ClosedRange<Int>] = []
        for (i, e) in entries.enumerated() {
            if let last = out.last, let g = e.group, entries[last.lowerBound].group == g {
                out[out.count - 1] = last.lowerBound...i
            } else {
                out.append(i...i)
            }
        }
        return out
    }

    /// Where Done takes the lifter next inside the run (the page's partner), or nil: no run, or
    /// every other member is done or skipped. Same order as `next`, minus `ei` itself.
    static func partner(_ s: SessionState, entry ei: Int) -> Int? {
        guard let w = s.workout, w.entries.indices.contains(ei),
              let run = runs(w.entries).first(where: { $0.contains(ei) }), run.count > 1 else { return nil }
        let turn = run.filter { $0 > ei } + run.filter { $0 < ei }
        return turn.first { SessionCore.setIndex(s, entry: $0) != nil }
    }
}
