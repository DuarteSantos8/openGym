import Foundation

/// The Pulse and Effort pages' arithmetic. Volume and sets are SessionCore's (summary, progress), not repeated here.
enum Metrics {
    typealias Sample = (Date, Double)

    /// The mean of the readings in whole bpm; nil without any (zeros are no reading).
    static func average(_ samples: [Sample]) -> Int? {
        let v = samples.map(\.1).filter { $0 > 0 }
        return v.isEmpty ? nil : Int((v.reduce(0, +) / Double(v.count)).rounded())
    }

    /// The lowest and highest reading in whole bpm; nil without any (zeros are no reading).
    static func range(_ samples: [Sample]) -> ClosedRange<Int>? {
        let v = samples.map(\.1).filter { $0 > 0 }
        guard let lo = v.min(), let hi = v.max() else { return nil }
        return Int(lo.rounded())...Int(hi.rounded())
    }

    /// Max heart rate from age (Tanaka: 208 − 0.7 × age).
    static func maxHeartRate(age: Int) -> Double { 208 - 0.7 * Double(age) }

    /// The zone of a reading, 1...5 for under 60, 60-70, 70-80, 80-90 and 90+ % of max; nil without a reading.
    /// Zone 1 takes everything under zone 2, as Apple's Workout does: a lifter between sets sits under 50 % (wrist 11-10).
    static func zone(_ bpm: Double, max: Double) -> Int? {
        guard bpm > 0, max > 0 else { return nil }
        let tenths = Int((bpm * 10 / max + 1e-9).rounded(.down)) // 1e-9: 126/180 is 7 tenths, not 6.999…
        return Swift.min(5, Swift.max(1, tenths - 4))
    }

    /// Each zone's band in whole bpm, as `zone` draws it (index 0 = zone 1): zone 1 has no floor, zone 5 no ceiling.
    static func zoneBands(max: Double) -> [(lo: Int?, hi: Int?)] {
        let floors = (2...5).map { Int((max * Double($0 + 4) / 10 - 1e-9).rounded(.up)) }
        return (1...5).map { (z: Int) -> (lo: Int?, hi: Int?) in
            let lo: Int? = z == 1 ? nil : floors[z - 2]
            let hi: Int? = z == 5 ? nil : floors[z - 1] - 1
            return (lo, hi)
        }
    }

    /// Seconds in each zone (index 0 = zone 1): each reading counts until the next, at most 30 s (a gap is no reading).
    static func timeInZones(_ samples: [Sample], max: Double) -> [TimeInterval] {
        var t = [TimeInterval](repeating: 0, count: 5)
        for (a, b) in zip(samples, samples.dropFirst()) {
            if let z = zone(a.1, max: max) { t[z - 1] += Swift.min(30, Swift.max(0, b.0.timeIntervalSince(a.0))) }
        }
        return t
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
    /// Sets done today per muscle, as the phone's live map counts them: each working set done adds the
    /// exercise's weight for that muscle. Most first; the name the phone sent, else its key.
    static func muscles(_ w: ActiveWorkout?) -> [(name: String, sets: Double)] {
        guard let w else { return [] }
        var tally: [String: Double] = [:]
        for e in w.entries {
            let done = Double(e.sets.filter { $0.done && !$0.warmup }.count)
            guard done > 0 else { continue }
            for (slug, weight) in e.muscles ?? [:] where weight > 0 { tally[slug, default: 0] += weight * done }
        }
        return tally.map { (name: w.muscleNames?[$0.key] ?? $0.key, sets: $0.value) }
            .sorted { $0.sets != $1.sets ? $0.sets > $1.sets : $0.name < $1.name }
    }

    static func effort(_ s: SessionState) -> [ExerciseEffort] {
        guard let w = s.workout, let efforts = s.efforts else { return [] }
        return w.entries.compactMap { e in
            let v = e.sets.indices.compactMap { efforts[SessionCore.key(e.id, $0)] }
            return v.isEmpty ? nil : ExerciseEffort(id: e.id, name: e.name, value: v.reduce(0, +) / Double(v.count))
        }
    }
}
