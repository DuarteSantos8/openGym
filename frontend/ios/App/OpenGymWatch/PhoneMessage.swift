import Foundation

/// What the phone tells the watch, parsed out of WatchConnectivity's untyped dictionaries on the
/// delegate's queue so only plain values cross over to the main actor.
enum PhoneMessage: Sendable, Equatable {
    case start(id: String, name: String, startedAt: Date)
    case end(id: String, discard: Bool, endedAt: Date)
    case rest(RestState?, at: Date)

    /// A message or a userInfo transfer (`type` start/end), or an application context (`rest`).
    static func parse(_ payload: [String: Any]) -> PhoneMessage? {
        if let rest = payload["rest"] { return parseRest(rest) }
        guard let type = payload["type"] as? String, let id = payload["id"] as? String, !id.isEmpty else { return nil }
        switch type {
        case "start":
            let name = payload["name"] as? String ?? ""
            guard let ms = number(payload["start"]), ms > 0 else { return nil }
            return .start(id: id, name: name, startedAt: date(ms))
        case "end":
            let endedAt = number(payload["end"]).map(date) ?? Date()
            return .end(id: id, discard: payload["discard"] as? Bool ?? false, endedAt: endedAt)
        default:
            return nil
        }
    }

    // NSNull is not a property-list type, so updateApplicationContext refuses it: a cleared rest
    // comes as `cleared: true` with its own `at`, which keeps "latest wins" working for clears too.
    private static func parseRest(_ value: Any) -> PhoneMessage? {
        guard let rest = value as? [String: Any], let at = number(rest["at"]) else { return nil }
        if rest["cleared"] as? Bool == true { return .rest(nil, at: date(at)) }
        let paused = rest["paused"] as? Bool ?? false
        let total = Int(number(rest["total"]) ?? 0)
        let left = Int(number(rest["left"]) ?? 0)
        let endsAt = number(rest["endsAt"]).map(date)
        if !paused && endsAt == nil { return .rest(nil, at: date(at)) }
        return .rest(RestState(endsAt: endsAt, total: total, paused: paused, left: left), at: date(at))
    }

    private static func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    private static func date(_ ms: Double) -> Date {
        Date(timeIntervalSince1970: ms / 1000)
    }
}

/// The phone's rest countdown: running until `endsAt`, or held at `left` seconds while paused.
struct RestState: Sendable, Equatable {
    let endsAt: Date?
    let total: Int
    let paused: Bool
    let left: Int
}

/// Milliseconds since 1970, the unit every timestamp on the wire uses.
extension Date {
    var millis: Double { (timeIntervalSince1970 * 1000).rounded() }
}
