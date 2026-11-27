import Foundation

/// The locked iPhone's rest end (#1393): the end tone, a short gap, then the spoken line, as one
/// run of samples for the notification's sound file. Plain Foundation, like CueAudioLedger.
public enum RestLineMix {
    /// Over `maxSec` the tone goes alone: a notification sound past 30 s is dropped by iOS, and a
    /// line is never cut mid-word. No tone (rest sound off) is the line alone; no line, the tone.
    public static func join(tone: [Int16], line: [Int16], rate: Int, gapSec: Double = 0.15, maxSec: Double = 29.5) -> [Int16] {
        if line.isEmpty { return tone }
        if tone.isEmpty { return line }
        let gap = max(0, Int((gapSec * Double(rate)).rounded()))
        if Double(tone.count + gap + line.count) > maxSec * Double(rate) { return tone }
        return tone + [Int16](repeating: 0, count: gap) + line
    }
}
