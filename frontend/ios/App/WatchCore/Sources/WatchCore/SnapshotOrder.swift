import Foundation

/*
 * Which of the phone's snapshots the watch applies (REDDIT-146, "progress not always syncing").
 * Each snapshot comes twice, as a message while the watch is in reach and as the application
 * context, and the two travel apart: a context that was on its way can land after a newer
 * message and turn a set the phone just ticked back to not done. The phone stamps each one
 * (`at`, its clock in seconds, WatchBridgePlugin.sendSnapshot); an older stamp than the newest
 * applied is skipped. A phone whose clock jumped back a long way starts the count afresh.
 */
enum SnapshotOrder {
    /// A stamp this much older than the newest is a clock that went back, not a late snapshot.
    static let clockJump: Double = 6 * 3600

    /// Whether a snapshot stamped `at` goes on. No stamp (an older phone app) always does.
    static func accept(_ at: Double?, after last: Double?) -> Bool {
        guard let at = at, at.isFinite, at > 0 else { return true }
        guard let last = last, last.isFinite else { return true }
        return at >= last || last - at > clockJump
    }

    /// The stamp to remember once a snapshot was accepted.
    static func next(_ at: Double?, after last: Double?) -> Double? {
        guard let at = at, at.isFinite, at > 0 else { return last }
        return at
    }

    /// The stamp from a payload, as a Double whatever number type it arrived as.
    static func stamp(_ payload: [String: Any]) -> Double? {
        if let d = payload["at"] as? Double { return d }
        if let n = payload["at"] as? NSNumber { return n.doubleValue }
        if let i = payload["at"] as? Int { return Double(i) }
        return nil
    }
}
