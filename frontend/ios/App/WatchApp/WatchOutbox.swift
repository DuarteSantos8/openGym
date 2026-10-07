import Foundation

// Keep completed payloads until the matching phone profile acknowledges them.
// The currently displayed workout can then be cleared without losing offline history.
enum WatchOutbox {
    static func adding(_ workout: [String: Any], to records: [[String: Any]]) -> [[String: Any]] {
        guard let id = workout["id"] as? String, let profile = workout["profile"] as? String else { return records }
        return records.filter { !($0["id"] as? String == id && $0["profile"] as? String == profile) } + [workout]
    }
    static func acknowledging(_ ids: [String], profile: String, in records: [[String: Any]]) -> [[String: Any]] {
        let acknowledged = Set(ids)
        return records.filter { !($0["profile"] as? String == profile && acknowledged.contains($0["id"] as? String ?? "")) }
    }
}
