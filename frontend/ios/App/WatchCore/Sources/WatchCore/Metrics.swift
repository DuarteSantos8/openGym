import Foundation

/// The Pulse and Effort pages' arithmetic. Volume and sets are SessionCore's (summary, progress), not repeated here.
enum Metrics {
    typealias Sample = (Date, Double)

    /// The mean of the readings in whole bpm; nil without any (zeros are no reading).
    static func average(_ samples: [Sample]) -> Int? {
        let v = samples.map(\.1).filter { $0 > 0 }
        return v.isEmpty ? nil : Int((v.reduce(0, +) / Double(v.count)).rounded())
    }

    /// At most `n` points for drawing: buckets of consecutive samples, each averaged in time and value.
    static func downsample(_ samples: [Sample], to n: Int) -> [Sample] {
        guard n > 0 else { return [] }
        guard samples.count > n else { return samples }
        return (0..<n).map { i in
            let chunk = samples[(i * samples.count / n)..<((i + 1) * samples.count / n)]
            let t = chunk.map { $0.0.timeIntervalSince1970 }.reduce(0, +) / Double(chunk.count)
            return (Date(timeIntervalSince1970: t), chunk.map(\.1).reduce(0, +) / Double(chunk.count))
        }
    }

    /// One exercise's mean effort today.
    struct ExerciseEffort: Equatable {
        var id: String
        var name: String
        var value: Double
    }

    /// Today's effort: one row per exercise with a rating, the mean of its rated sets, in workout order.
    /// Exercises without a rating are left out.
    static func effort(_ s: SessionState) -> [ExerciseEffort] {
        guard let w = s.workout, let efforts = s.efforts else { return [] }
        return w.entries.compactMap { e in
            let v = e.sets.indices.compactMap { efforts[SessionCore.key(e.id, $0)] }
            return v.isEmpty ? nil : ExerciseEffort(id: e.id, name: e.name, value: v.reduce(0, +) / Double(v.count))
        }
    }
}
