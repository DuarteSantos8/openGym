import Foundation

/// What the phone tells the watch, parsed out of WatchConnectivity's untyped dictionaries on the
/// delegate's queue so only plain values cross over to the main actor.
enum PhoneMessage: Sendable, Equatable {
    case start(id: String, name: String, startedAt: Date)
    case end(id: String, discard: Bool, endedAt: Date)
    case rest(RestState?, at: Date)
    case set(SetState?, at: Date)

    /// Every message in a payload: the application context carries the rest and the current set
    /// side by side, a message or a userInfo transfer one start or end.
    static func parseAll(_ payload: [String: Any]) -> [PhoneMessage] {
        if payload["rest"] != nil || payload["set"] != nil {
            return [payload["rest"].flatMap(parseRest), payload["set"].flatMap(parseSet)].compactMap { $0 }
        }
        return parse(payload).map { [$0] } ?? []
    }

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
        let ready = rest["ready"] as? Bool ?? false
        if !paused && endsAt == nil { return .rest(nil, at: date(at)) }
        return .rest(RestState(endsAt: endsAt, total: total, paused: paused, left: left, ready: ready), at: date(at))
    }

    // The set to log on the wrist (lib/watch-set.js); `cleared` when nothing is open.
    private static func parseSet(_ value: Any) -> PhoneMessage? {
        guard let set = value as? [String: Any], let at = number(set["at"]) else { return nil }
        if set["cleared"] as? Bool == true { return .set(nil, at: date(at)) }
        guard let workoutId = set["id"] as? String, let entryId = set["entryId"] as? String,
              let idx = number(set["idx"]), let index = number(set["i"]) else { return nil }
        let state = SetState(
            workoutId: workoutId, entryId: entryId, name: set["name"] as? String ?? "",
            idx: Int(idx), i: Int(index),
            setNo: Int(number(set["setNo"]) ?? 1), setCount: Int(number(set["setCount"]) ?? 1),
            warmup: set["warmup"] as? Bool ?? false, mode: set["mode"] as? String ?? "reps",
            weight: number(set["w"]) ?? 0, reps: Int(number(set["r"]) ?? 0),
            unit: set["unit"] as? String ?? "kg", each: set["each"] as? Bool ?? false,
            step: max(number(set["inc"]) ?? 2.5, 0.25), nextName: set["nextName"] as? String
        )
        return .set(state, at: date(at))
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
    /// The heart rate came back down: the phone says the next set can start.
    let ready: Bool
}

/// The set the user is on in the phone's workout, as the phone sees it.
struct SetState: Sendable, Equatable {
    let workoutId: String
    let entryId: String
    let name: String
    let idx: Int
    let i: Int
    let setNo: Int
    let setCount: Int
    let warmup: Bool
    /// reps | time | cardio: only a reps set is logged on the wrist.
    let mode: String
    let weight: Double
    let reps: Int
    let unit: String
    /// A dumbbell load counted per hand.
    let each: Bool
    let step: Double
    let nextName: String?

    var isLast: Bool { !warmup && setNo >= setCount }
    func isSameSet(as other: SetState) -> Bool {
        workoutId == other.workoutId && entryId == other.entryId && idx == other.idx && i == other.i
    }
}

/// Milliseconds since 1970, the unit every timestamp on the wire uses.
extension Date {
    var millis: Double { (timeIntervalSince1970 * 1000).rounded() }
}
