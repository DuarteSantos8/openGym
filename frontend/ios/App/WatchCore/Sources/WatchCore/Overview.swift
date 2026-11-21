import Foundation

/*
 * The session screen's Overview (left of the set): every exercise with its work sets done, the
 * one on now marked, supersets under one heading. A tap on a row jumps there; that is a move on
 * the watch alone (the phone hears of it with the next set). Tested in OverviewTests.swift.
 */
struct OverviewRow: Equatable {
    var index: Int
    var id: String
    var name: String
    /// Work sets done and in all (warm-ups not counted, unless the exercise has nothing else).
    var done: Int
    var total: Int
    /// The exercise on the set page now.
    var current: Bool
    /// Every set of it done.
    var finished: Bool
    /// The first exercise of a superset (two or more neighbours sharing a group): the heading goes above it.
    var supersetStart: Bool
    /// Part of a superset.
    var inSuperset: Bool
}

enum Overview {
    static func rows(_ w: ActiveWorkout, current: Int) -> [OverviewRow] {
        let entries = w.entries
        return entries.enumerated().map { i, e in
            let work = e.sets.filter { !$0.warmup }
            let counted = work.isEmpty ? e.sets : work
            let grouped = inSuperset(entries, i)
            let first = grouped && (i == 0 || entries[i - 1].group != e.group)
            return OverviewRow(index: i, id: e.id, name: e.name,
                               done: counted.filter { $0.done }.count, total: counted.count,
                               current: i == current, finished: !e.sets.isEmpty && e.sets.allSatisfy { $0.done },
                               supersetStart: first, inSuperset: grouped)
        }
    }

    /// Whether exercise `i` is in a superset: a group shared with a neighbour (a group of one is not).
    static func inSuperset(_ entries: [Entry], _ i: Int) -> Bool {
        guard entries.indices.contains(i), let g = entries[i].group else { return false }
        return (i > 0 && entries[i - 1].group == g) || (i + 1 < entries.count && entries[i + 1].group == g)
    }

    /// The other exercises of `i`'s superset, in order: the set page names them.
    static func partners(_ entries: [Entry], _ i: Int) -> [String] {
        guard inSuperset(entries, i), let g = entries[i].group else { return [] }
        var lo = i, hi = i
        while lo > 0 && entries[lo - 1].group == g { lo -= 1 }
        while hi + 1 < entries.count && entries[hi + 1].group == g { hi += 1 }
        return (lo...hi).filter { $0 != i }.map { entries[$0].name }
    }

    /// Past the last exercise: every set is done or passed over, the Overview's Finish is next.
    static func atEnd(_ s: SessionState) -> Bool {
        guard let w = s.workout else { return false }
        return s.entryIndex >= w.entries.count
    }
}
