import Foundation

// Pure matching rules shared by the native bridge and its standalone safety tests.
struct HealthWorkoutDeletion {
    let id: String
    let start: Double
    let end: Double
    var externalID: String { "opengym-workout-\(id)" }

    init?(_ row: [String: Any]) {
        guard let id = row["id"] as? String, !id.isEmpty,
              let start = (row["start"] as? NSNumber)?.doubleValue,
              let end = (row["end"] as? NSNumber)?.doubleValue,
              start.isFinite, end.isFinite, start > 0, end > start,
              end <= 8640000000000000 else { return nil }
        self.id = id
        self.start = start
        self.end = end
    }

    func matches(source: String, appSource: String, externalID: String?, start: Date, end: Date) -> Bool {
        return source == appSource && externalID == self.externalID &&
            abs(start.timeIntervalSince1970 * 1000 - self.start) < 1 &&
            abs(end.timeIntervalSince1970 * 1000 - self.end) < 1
    }
}
