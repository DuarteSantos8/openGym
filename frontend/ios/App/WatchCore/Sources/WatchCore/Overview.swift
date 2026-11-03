import Foundation

/// The Overview page: every exercise of the running workout with its working sets done, and which
/// one the lifter is on. Plain data from the session, no message of its own.
enum Overview {
    enum State: Equatable { case done, current, todo }

    struct Row: Equatable, Identifiable {
        var index: Int
        var name: String
        /// Working sets only: warm-ups are not counted (as SessionCore.progress).
        var done: Int
        var total: Int
        var state: State
        var id: Int { index }
    }

    static func rows(_ s: SessionState) -> [Row] {
        guard let w = s.workout else { return [] }
        return w.entries.enumerated().map { i, e in
            let work = e.sets.filter { !$0.warmup }
            let done = work.filter(\.done).count
            // An exercise of only warm-ups is done when they are.
            let finished = work.isEmpty ? (!e.sets.isEmpty && e.sets.allSatisfy(\.done)) : done == work.count
            return Row(index: i, name: e.name, done: done, total: work.count,
                       state: finished ? .done : (i == s.entryIndex ? .current : .todo))
        }
    }

    /// A superset's members together; every other exercise is a block of its own.
    struct Block: Equatable, Identifiable {
        var rows: [Row]
        var isSuperset: Bool { rows.count > 1 }
        var id: Int { rows[0].index }
    }

    static func blocks(_ s: SessionState) -> [Block] {
        guard let w = s.workout else { return [] }
        let all = rows(s)
        return Superset.runs(w.entries).map { Block(rows: Array(all[$0])) }
    }
}
