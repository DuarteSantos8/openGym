import Foundation

// Pure decisions shared with the phone's HealthKit exporter and exercised without Health data.
public enum HealthExportCore {
    public static let energyKeys = ["activeKcal", "basalKcal"]
    public struct Energy: Equatable {
        public let key: String
        public let kcal: Double
    }
    public static func energy(_ metrics: [String: Any]?, allowed: Set<String>) -> [Energy] {
        guard metrics?["final"] as? Bool == true,
              let stamp = (metrics?["sampledAt"] as? NSNumber)?.doubleValue,
              stamp.isFinite, stamp > 0, stamp <= 9007199254740991 else { return [] }
        return energyKeys.compactMap { key in
            guard allowed.contains(key), let kcal = (metrics?[key] as? NSNumber)?.doubleValue,
                  kcal.isFinite, kcal >= 0 else { return nil }
            return Energy(key: key, kcal: kcal)
        }
    }
    public static func energyIDs(_ sessions: [String], keys: [String] = energyKeys) -> [String] {
        sessions.flatMap { id in keys.map { id + "-" + $0 } }
    }
    public static func version(now: Double, previous: Double = 0) -> Int64 {
        let clock = now.isFinite && now > 0 ? min(now, 9007199254740990) : 1
        let old = previous.isFinite && previous > 0 ? min(previous, 9007199254740990) : 0
        return Int64(max(clock.rounded(.down), old.rounded(.down) + 1))
    }
}
