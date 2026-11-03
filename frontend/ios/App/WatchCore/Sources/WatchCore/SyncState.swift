import Foundation

/// What the watch can truthfully say about the sets it logged: whether they reached the iPhone.
/// Only what WatchConnectivity knows. There is no server ack, so no "sent" or "rejected".
enum SyncState: Equatable {
    case none               // nothing to say
    case onPhone            // every set logged here has reached the iPhone
    case waiting(Int)       // n sets the iPhone has not got yet
    case away               // iPhone out of reach, nothing waiting yet

    /// The count every face shows. With the phone in reach the transfers finish in a second, so 0 (no blink of 1).
    /// The complication uses this too, so the two never disagree.
    static func count(reachable: Bool, unsent: Int) -> Int { reachable ? 0 : unsent }

    /// `logged`: whether the shown workout has a set done; nil when no workout is shown (home).
    static func state(reachable: Bool, unsent: Int, logged: Bool?) -> SyncState {
        let n = count(reachable: reachable, unsent: unsent)
        if n > 0 { return .waiting(n) }
        guard let logged = logged else { return .none }
        if logged { return .onPhone }
        return reachable ? .none : .away
    }

    var unsent: Int { if case .waiting(let n) = self { return n }; return 0 }
    /// "99+" past two digits, so the number never outgrows its place.
    var countText: String { unsent > 99 ? "99+" : "\(unsent)" }

    /// A set done, warm-ups and one side of a per-side set included (each sent a setDone).
    static func anySet(_ w: ActiveWorkout) -> Bool {
        w.entries.contains { e in
            e.sets.contains { $0.done || ($0.sides.map { $0.L.done || $0.R.done } ?? false) }
        }
    }
}
