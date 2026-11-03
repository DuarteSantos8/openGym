import Foundation

enum ValueField: String { case weight, reps, seconds }

/// The bounds, the step and the keypad rules of one number, in one place (Crown, keypad and VoiceOver all use it).
struct ValueSpec: Equatable {
    var lo: Double, hi: Double, step: Double, decimals: Int

    static func of(_ f: ValueField, step: Double?, unit: String) -> ValueSpec {
        switch f {
        case .weight: return ValueSpec(lo: 0, hi: unit == "lb" ? 1500 : 700,
                                       step: (step ?? 0) > 0 ? step! : (unit == "lb" ? 5 : 2.5), decimals: 2)
        case .reps: return ValueSpec(lo: 0, hi: 200, step: 1, decimals: 0)
        case .seconds: return ValueSpec(lo: 5, hi: 3600, step: 5, decimals: 0)
        }
    }

    func clamp(_ v: Double) -> Double { min(max(v, lo), hi) }

    /// `n` detents from `v`. An off-grid value (typed, or the phone's) first goes to the nearest grid value in the turn's direction.
    func turned(_ v: Double, by n: Int) -> Double {
        guard n != 0 else { return v }
        let g = v / step
        let base = n > 0 ? (g + 1e-6).rounded(.down) : (g - 1e-6).rounded(.up)
        return clamp(((base + Double(n)) * step * 1000).rounded() / 1000)   // 0.1 steps drift without the rounding
    }

    private var maxDigits: Int { String(Int(hi)).count }
    private func fraction(_ t: String) -> Int? { t.contains(".") ? t.split(separator: ".", omittingEmptySubsequences: false)[1].count : nil }

    /// The text after a key: a digit, ".", or "⌫". A key that cannot be typed leaves it as it is.
    func typed(_ text: String, adding key: Character) -> String {
        if key == "⌫" { return String(text.dropLast()) }
        if key == "." { return decimals == 0 || text.contains(".") ? text : (text.isEmpty ? "0." : text + ".") }
        guard key.isASCII, key.isNumber else { return text }
        if let f = fraction(text) { return f < decimals ? text + String(key) : text }
        if text == "0" { return String(key) }                       // no leading zeros
        return text.count < maxDigits ? text + String(key) : text
    }

    /// What ✓ accepts: digits and at most one ".", inside the bounds, saved exactly as typed. "62." is 62.
    func value(of text: String) -> Double? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, let whole = parts.first, !whole.isEmpty,
              parts.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
              (parts.count == 2 ? parts[1].count : 0) <= decimals,
              let v = Double(text.hasSuffix(".") ? text + "0" : text), (lo...hi).contains(v) else { return nil }
        return v
    }

    /// Above the top (more digits cannot fix it): the keypad turns red and says the range. Under the bottom it only waits.
    func tooHigh(_ text: String) -> Bool { Double(text.hasSuffix(".") ? text + "0" : text).map { $0 > hi } ?? false }
}

/// A Crown turn as whole steps: one detent, one step; a fast spin is capped and the rest dropped, not banked.
struct CrownGate: Equatable {
    static let spinSteps = 2, spinWindow: TimeInterval = 0.1
    private(set) var last = 0.0                    // the binding's value; the view reads and writes it
    private var windowFrom = Date.distantPast, used = 0

    mutating func steps(to total: Double, at t: Date, allowed: Bool) -> Int {
        let whole = Int((total - last).rounded())
        last = total                               // always: what was swallowed is not owed later
        guard allowed, whole != 0 else { return 0 }
        if t.timeIntervalSince(windowFrom) >= CrownGate.spinWindow { windowFrom = t; used = 0 }
        let n = min(abs(whole), max(CrownGate.spinSteps - used, 0))
        used += n
        return whole < 0 ? -n : n
    }
}

/// Which box the Crown turns: armed by a tap, for one set, until a few seconds pass without a tap or a turn.
struct CrownArm: Equatable {
    var idle: TimeInterval = 4                     // CI's demo passes .infinity
    private(set) var field: ValueField?
    private var key: String?
    private var last = Date.distantPast
    init(idle: TimeInterval = 4) { self.idle = idle }        // spelled out: older Swift keeps the memberwise one private

    enum Tap { case armed, keypad }
    mutating func tap(_ f: ValueField, key k: String, at t: Date) -> Tap {
        let again = armed(at: t, key: k) == f
        field = f; key = k; last = t
        return again ? .keypad : .armed
    }
    mutating func touch(at t: Date) { if field != nil { last = t } }
    func armed(at t: Date, key k: String?) -> ValueField? {
        guard let f = field, k != nil, key == k, t.timeIntervalSince(last) < idle else { return nil }
        return f
    }
    mutating func disarm() { field = nil; key = nil }
}

/// The numbers the lifter touched on the set up next: a snapshot sets the untouched ones back to the plan, never these.
struct SetDraft: Equatable {
    private var key: String?
    private var touched: Set<ValueField> = []
    mutating func follow(_ k: String?) { if k != key { key = k; touched = [] } }   // another set: a clean draft
    mutating func touch(_ f: ValueField, key k: String?) -> Bool { guard k == key else { return false }; touched.insert(f); return true }
    func keeps(_ f: ValueField) -> Bool { touched.contains(f) }
}
