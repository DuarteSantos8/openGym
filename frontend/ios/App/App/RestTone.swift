import Foundation

/**
 * The end-of-rest sounds as 16-bit mono samples, number for number what Android renders
 * (android/.../RestTone.java) and the page plays through Web Audio (lib/sound.js chime(),
 * lib/rest-sounds.js REST_SOUNDS). iOS plays a notification's sound from a file, so the sounds are
 * written once as WAV files to Library/Sounds, where UNNotificationSound looks for them.
 */
enum RestTone {
    static let rate = 22050
    /** Silence after the tone, as on Android: Bluetooth earbuds still hold the last note. */
    static let tailSec = 0.6
    static let kinds = ["chime", "classic", "bell", "beep", "whistle", "soft"]

    private static let bright: [Double] = [1, 0.6, 0.35, 0.2]
    private static let bellTimbre: [Double] = [1, 0.25, 0.5, 0.1, 0.3]
    private static let sine: [Double] = [1]

    // {freq, dur, when} or {freq, dur, when, glideTo}
    private static let chime: [[Double]] = [[1319, 0.16, 0], [988, 0.16, 0.22], [1319, 0.5, 0.44]]
    private static let bellNotes: [[Double]] = [[1319, 0.9, 0], [1047, 1.3, 0.4]]
    private static let beepNotes: [[Double]] = [[1760, 0.08, 0], [1760, 0.08, 0.13], [1760, 0.08, 0.4], [1760, 0.08, 0.53]]
    private static let whistleNotes: [[Double]] = [[1300, 0.16, 0, 2100], [1500, 0.42, 0.22, 2500]]
    private static let softNotes: [[Double]] = [[659, 0.4, 0], [784, 0.4, 0.2], [988, 0.8, 0.4]]

    /** A name it does not know plays the chime, as everywhere else. */
    static func normalised(_ kind: String?) -> String {
        guard let k = kind, kinds.contains(k) else { return "chime" }
        return k
    }

    static func render(_ kind: String) -> [Int16] {
        switch normalised(kind) {
        case "classic": return withTail(renderBeeps())
        case "bell": return withTail(renderNotes(bellNotes, peak: 0.55, hold: 0, harmonics: bellTimbre))
        case "beep": return withTail(renderNotes(beepNotes, peak: 0.8, hold: 0.8, harmonics: bright))
        case "whistle": return withTail(renderNotes(whistleNotes, peak: 0.7, hold: 0.55, harmonics: sine))
        case "soft": return withTail(renderNotes(softNotes, peak: 0.3, hold: 0, harmonics: sine))
        default: return withTail(renderNotes(chime, peak: 0.9, hold: 0.6, harmonics: bright))
        }
    }

    static func renderNotes(_ notes: [[Double]], peak: Double, hold: Double, harmonics: [Double]) -> [Int16] {
        let end = notes.map { $0[2] + $0[1] }.max() ?? 0
        var mix = [Double](repeating: 0, count: Int((end * Double(rate)).rounded(.up)))
        let norm = wavePeak(harmonics)
        for n in notes {
            let freq = n[0], dur = n[1], to = n.count > 3 ? n[3] : n[0]
            let start = Int((n[2] * Double(rate)).rounded())
            let len = Int(dur * Double(rate))
            var s = 0
            while s < len && start + s < mix.count {
                let t = Double(s) / Double(rate)
                let cycles = freq * t + (to - freq) * t * t / (2 * dur)
                var wave = 0.0
                for (k, h) in harmonics.enumerated() { wave += h * sin(2 * Double.pi * cycles * Double(k + 1)) }
                mix[start + s] += wave / norm * gain(t, dur, peak, hold)
                s += 1
            }
        }
        return mix.map { Int16(max(-32767, min(32767, ($0 * 32767).rounded()))) }
    }

    static func gain(_ t: Double, _ dur: Double, _ peak: Double, _ hold: Double) -> Double {
        let floor = 0.001, attack = 0.02, holdEnd = max(attack, dur * hold)
        if t < 0 { return 0 }
        if t < attack { return floor * pow(peak / floor, t / attack) }
        if t < holdEnd { return peak }
        if t < dur { return peak * pow(floor / peak, (t - holdEnd) / (dur - holdEnd)) }
        return 0
    }

    private static func wavePeak(_ harmonics: [Double]) -> Double {
        var top = 0.0
        for i in 0..<4096 {
            let x = 2 * Double.pi * Double(i) / 4096
            var v = 0.0
            for (k, h) in harmonics.enumerated() { v += h * sin(Double(k + 1) * x) }
            top = max(top, abs(v))
        }
        return top
    }

    /** The classic beeps (880, 880, 1320), flat at 0.85 of full scale as on Android. */
    static func renderBeeps() -> [Int16] {
        let freq: [Double] = [880, 880, 1320], dur = [0.15, 0.15, 0.40], gap = [0.10, 0.10, 0]
        var out: [Int16] = []
        let fade = max(1, rate / 200)
        for i in 0..<freq.count {
            let n = Int(Double(rate) * dur[i])
            for s in 0..<n {
                var env = 1.0
                if s < fade { env = Double(s) / Double(fade) } else if s > n - fade { env = Double(n - s) / Double(fade) }
                let wave = sin(2 * Double.pi * freq[i] * Double(s) / Double(rate))
                out.append(Int16(max(-32767, min(32767, wave * env * 0.85 * 32767))))
            }
            out.append(contentsOf: [Int16](repeating: 0, count: Int(Double(rate) * gap[i])))
        }
        return out
    }

    static func withTail(_ tone: [Int16]) -> [Int16] {
        tone + [Int16](repeating: 0, count: Int(tailSec * Double(rate)))
    }

    static func wav(_ samples: [Int16]) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        let bytes = UInt32(samples.count * 2)
        d.append("RIFF".data(using: .ascii)!); u32(36 + bytes); d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(bytes)
        for s in samples { var x = s.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        return d
    }

    /**
     * "rest-chime-v1.wav" etc., written to Library/Sounds the first time it is asked for. The
     * version goes up with any change to the sounds above, so a phone never keeps an old file.
     */
    static func soundName(_ kind: String) -> String {
        "rest-\(normalised(kind))-v1.wav"
    }

    static func soundFile(_ kind: String) -> URL? {
        let k = normalised(kind)
        guard let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return nil }
        let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
        let url = dir.appendingPathComponent(soundName(k))
        if FileManager.default.fileExists(atPath: url.path) { return url }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try wav(render(k)).write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
