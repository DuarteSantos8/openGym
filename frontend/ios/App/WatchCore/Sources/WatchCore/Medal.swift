import Foundation

/// The end of a workout as a struck medal (the Apple Watch summary, #1309): what goes where on it,
/// when each beat of its entrance lands, and how the Crown's stops move it. The view only draws.
/// Lengths are face units, 200 across the medal; angles are degrees clockwise from 3 o'clock.
enum Medal {
    /* ---------- the face ---------- */

    /// One notch on the rim per work set, up to this many; more would touch, and the legend still
    /// gives the true count.
    static let maxNotches = 48

    /// Each notch's angle, the first at 12 o'clock.
    static func notchAngles(sets: Int) -> [Double] {
        let n = min(max(sets, 0), maxNotches)
        return (0..<n).map { -90 + Double($0) * 360 / Double(n) }
    }

    /// The circle the diamonds sit on, under the time.
    static let gemRing = 50.0

    /// One diamond per record, 7 at most (the legend says how many), centred under the time; past
    /// 5 they are smaller and closer so they keep clear of the minutes' label.
    static func gems(records: Int) -> (angles: [Double], size: Double) {
        let shown = min(max(records, 0), 7)
        let step: Double = shown <= 5 ? 27 : 21
        return ((0..<shown).map { 90 + (Double($0) - Double(shown - 1) / 2) * step }, shown <= 5 ? 8.6 : 7)
    }

    /// The time stamped in the middle: minutes under an hour ("52"), else hours and minutes ("1:05").
    static func time(_ seconds: Double) -> (text: String, hours: Bool) {
        let m = SafeNum.rounded(SafeNum.finite(seconds, or: 0) / 60)
        guard m >= 60 else { return ("\(max(m, 0))", false) }
        return ("\(m / 60):" + String(format: "%02d", m % 60), true)
    }

    /// Whether a name can be set one letter at a time round the rim. Scripts whose letters join or
    /// stack (Arabic, Hebrew, Indic, Thai) or run right to left would break apart, so they go straight.
    static func arcable(_ s: String) -> Bool {
        s.unicodeScalars.allSatisfy { u in
            switch u.value {
            case 0x20...0x24F, 0x300...0x36F, 0x370...0x52F, 0x1E00...0x1FFF, 0x2000...0x206F, 0x20A0...0x20CF,
                 0x2100...0x27BF, 0x3000...0x30FF, 0x3400...0x9FFF, 0xAC00...0xD7AF, 0x1100...0x11FF,
                 0xFE00...0xFE0F, 0xFF00...0xFFEF, 0x1F000...0x1FAFF: return true
            default: return false
            }
        }
    }

    /// "62.5" in the app's language ("62,5" in German), at most two decimals.
    static func number(_ v: Double, locale: Locale) -> String {
        SafeNum.finite(v, or: 0).formatted(.number.precision(.fractionLength(0...2)).locale(locale))
    }

    /// A hold's seconds as "1:15".
    static func clock(_ seconds: Double) -> String {
        let s = max(SafeNum.rounded(SafeNum.finite(seconds, or: 0)), 0)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    /* ---------- the entrance, in seconds from the moment it shows ---------- */

    /// The blank disc lands and the strike stamps the workout in.
    static let strikeAt = 0.3
    /// It has rocked to rest (the no-records day's "saved" beat).
    static let settledAt = 1.15

    /// When each diamond drops into its setting.
    static func gemTimes(records: Int) -> [Double] {
        Array([1.55, 1.9, 2.25, 2.33, 2.41, 2.49, 2.57].prefix(min(max(records, 0), 7)))
    }

    /// When the glint crosses the face; the turn that hints at the Crown follows 0.95 s later.
    static func glintAt(records: Int) -> Double { records > 0 ? 2.45 : 1.35 }

    /// Everything has landed: the entrance stops drawing frames.
    static func entranceEnds(records: Int) -> Double { glintAt(records: records) + 0.95 + 0.7 }

    enum Beat: Equatable { case strike, settled, record }

    /// The haptics of the entrance, on its own beats, in place of the old finish taps: the strike's
    /// thud, then a success on a no-records day, or a rising tap per diamond (3 at most) on a
    /// records day, where the strike already said "saved". 2 or at most 4 taps, 0.35 s apart.
    static func beats(records: Int) -> [(at: Double, beat: Beat)] {
        let rest: [(at: Double, beat: Beat)] = records > 0
            ? gemTimes(records: records).prefix(3).map { ($0, .record) }
            : [(settledAt, .settled)]
        return [(strikeAt, .strike)] + rest
    }

    /* ---------- size and the Crown ---------- */

    /// The medal's width: 140 pt on 41 mm, 150 on 42, 160 on 46, 168 on 49, in between by height.
    static func diameter(width: Double, height: Double) -> Double {
        let table: [(h: Double, d: Double)] = [(215, 140), (223, 150), (248, 160), (251, 168)]
        let d: Double
        if height <= table[0].h {
            d = table[0].d * height / table[0].h
        } else if let i = table.indices.dropFirst().first(where: { height <= table[$0].h }) {
            let a = table[i - 1], b = table[i]
            d = a.d + (b.d - a.d) * (height - a.h) / (b.h - a.h)
        } else {
            d = table[table.count - 1].d
        }
        return min(d, width - 24)
    }

    /// How small the medal gets at the end stop, to leave room for the records and Done.
    static func endScale(records: Int) -> Double { records > 0 ? 0.46 : 0.6 }

    /// The Crown's stops: 0 the front, 1 the back, 2 the end (the medal small at the top), then one
    /// more per page of record bars and Done that runs past the bottom of the screen.
    static func endStops(overflow: Double) -> Int {
        overflow > 1 ? Int((overflow / 60).rounded(.up)) : 0
    }

    /// Points scrolled at Crown value `c`: none before the end stop, then evenly to the bottom.
    static func scroll(c: Double, overflow: Double) -> Double {
        let n = endStops(overflow: overflow)
        guard n > 0 else { return 0 }
        return min(overflow, max(0, c - 2) * overflow / Double(n))
    }

    /// Which of the three marks by the Crown is lit: the front, the back, or the end.
    static func mark(_ c: Double) -> Int { c < 0.5 ? 0 : c < 1.5 ? 1 : 2 }

    /// A tap on the medal: on to the next stop, and from the end back to the front.
    static func nextStop(_ c: Double) -> Double { c >= 1.999 ? 0 : min(2, (c + 0.001).rounded(.down) + 1) }
}
