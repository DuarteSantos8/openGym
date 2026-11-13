import Foundation

/*
 * What the start screen says about a routine before it starts, and the phone's accent colour as
 * the watch reads it. Plain functions, tested in PlanTests.swift.
 */
enum Plan {
    /// "5 exercises, 17 sets": the exercises with something to do, and their work sets. A warm-up
    /// is not a set you count, and a per-side set is one set (its two sides are one row).
    static func size(_ entries: [Entry]) -> (exercises: Int, sets: Int) {
        let real = entries.filter { !$0.sets.isEmpty }
        let sets = real.reduce(0) { $0 + $1.sets.filter { !$0.warmup }.count }
        return (real.count, sets)
    }
}

/// "#30d158" as three channels from 0 to 1, or nil for anything that is not a #rrggbb colour.
enum Hex {
    static func rgb(_ hex: String?) -> (r: Double, g: Double, b: Double)? {
        guard let h = hex, h.count == 7, h.hasPrefix("#"), let n = UInt32(h.dropFirst(), radix: 16) else { return nil }
        return (Double((n >> 16) & 0xff) / 255, Double((n >> 8) & 0xff) / 255, Double(n & 0xff) / 255)
    }
}
