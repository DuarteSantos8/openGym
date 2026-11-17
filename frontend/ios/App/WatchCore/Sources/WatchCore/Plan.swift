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

    /// What is ready, with every routine when the file on the watch is the one the snapshot names
    /// (`hash`); else the snapshot's own list, which an older phone, a first launch before the file
    /// arrives and a file already out of date all fall back to.
    static func merged(_ ready: Ready?, hash: String?, file: RoutinesFile?) -> Ready? {
        guard var r = ready, let hash = hash, let f = file, f.h == hash else { return ready }
        r.others = f.others
        return r
    }

    /// The folder name to draw above the routine at `index`: where it differs from the routine
    /// before it (the phone sends them grouped), nil for no folder or a repeat.
    static func folderHeader(at index: Int, in others: [ReadySession]) -> String? {
        guard others.indices.contains(index),
              let f = others[index].folder?.trimmingCharacters(in: .whitespacesAndNewlines), !f.isEmpty else { return nil }
        return index > 0 && others[index - 1].folder == others[index].folder ? nil : f
    }
}

/// "#30d158" as three channels from 0 to 1, or nil for anything that is not a #rrggbb colour.
enum Hex {
    static func rgb(_ hex: String?) -> (r: Double, g: Double, b: Double)? {
        guard let h = hex, h.count == 7, h.hasPrefix("#"), let n = UInt32(h.dropFirst(), radix: 16) else { return nil }
        return (Double((n >> 16) & 0xff) / 255, Double((n >> 8) & 0xff) / 255, Double(n & 0xff) / 255)
    }
}
