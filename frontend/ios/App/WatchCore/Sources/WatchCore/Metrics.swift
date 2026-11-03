import Foundation

/// The Metrics page's own arithmetic. Volume and sets are SessionCore's (summary, progress), not repeated here.
enum Metrics {
    /// A heart-rate reading older than this is not "now" any more.
    static let staleAfter: TimeInterval = 15

    /// "7:05", "52:13", "1:05:13". `seconds: false` (the system only redraws once a minute): "52:––".
    static func clock(_ elapsed: Double, seconds: Bool = true) -> String {
        let t = elapsed.isFinite ? Int(min(max(elapsed, 0), 1e7)) : 0
        let h = t / 3600, m = t % 3600 / 60, s = t % 60
        let tail = seconds ? String(format: "%02d", s) : "––"
        return h > 0 ? String(format: "%d:%02d:", h, m) + tail : "\(m):" + tail
    }

    /// Whole bpm to show, or nil: no reading, a zero one, or one older than 15 s (paused session, loose strap).
    /// A reading stamped ahead of the clock counts as fresh.
    static func heart(_ bpm: Double?, at: Date?, now: Date) -> Int? {
        guard let bpm, bpm > 0, let at, now.timeIntervalSince(at) <= staleAfter else { return nil }
        return Int(bpm.rounded())
    }
}
