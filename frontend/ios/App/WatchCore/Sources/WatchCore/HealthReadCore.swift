import Foundation

/// What AppleHealthPlugin hands to JS when it reads (openGym v1.4.3): plain values, no HealthKit,
/// so `swift test` covers it on the Mac (HealthReadCoreTests). Compiled straight into the iPhone
/// app next to the plugin (like ClipCodec). Heart rate as [ms, bpm] pairs inside the window asked
/// for; weigh-ins as { t, kg, id, origin, clientId }. Which of them openGym takes, and how, is
/// decided in JS (lib/health-read.js).
public enum HealthReadCore {
    /// Beyond this no reading is plausible; lib/heart-rate.js applies the same bounds again.
    public static let bpmRange: ClosedRange<Double> = 25...250
    /// A workout of a few hours at one sample a second is well under this.
    public static let maxSamples = 50_000
    /// The bundle ids that are openGym: the iPhone app, its Apple Watch app and widgets.
    public static let ownPrefix = "ch.duartesantos.opengym"

    public struct HeartSample: Equatable {
        public let ms: Double
        public let bpm: Double
        public init(ms: Double, bpm: Double) { self.ms = ms; self.bpm = bpm }
    }

    public struct WeighIn: Equatable {
        public let ms: Double
        public let kg: Double
        public let id: String
        public let source: String
        public let syncId: String?
        public init(ms: Double, kg: Double, id: String, source: String, syncId: String?) {
            self.ms = ms; self.kg = kg; self.id = id; self.source = source; self.syncId = syncId
        }
    }

    /// The samples in [from, to] with a plausible rate, oldest first, as [[ms, bpm]]. The rate is
    /// rounded first, as Health Connect's whole beats and lib/heart-rate.js have it: 250.4 is 250.
    public static func samples(_ all: [HeartSample], from: Double, to: Double) -> [[Double]] {
        let kept = all.filter { $0.ms >= from && $0.ms <= to && bpmRange.contains($0.bpm.rounded()) }
            .sorted { $0.ms < $1.ms }
            .prefix(maxSamples)
        return kept.map { [$0.ms.rounded(), $0.bpm.rounded()] }
    }

    /// Whether openGym wrote this one itself (by its sync identifier or its source).
    public static func isOwn(source: String, syncId: String?) -> Bool {
        if let id = syncId, id.hasPrefix("opengym-") { return true }
        return source == ownPrefix || source.hasPrefix(ownPrefix + ".")
    }

    /// Weigh-ins as JS takes them, openGym's own left out.
    public static func weights(_ all: [WeighIn]) -> [[String: Any]] {
        all.filter { $0.kg > 0 && !isOwn(source: $0.source, syncId: $0.syncId) }
            .sorted { $0.ms < $1.ms }
            .map { w in
                var o: [String: Any] = ["t": w.ms.rounded(), "kg": w.kg, "id": w.id, "origin": w.source]
                if let s = w.syncId { o["clientId"] = s }
                return o
            }
    }
}
