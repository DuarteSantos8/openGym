import Foundation

/**
 * The shape the iPhone's audio session takes while a rest alert sounds (RestAlertPlugin.swift
 * maps it onto AVAudioSession). Every shape mixes with other audio: .ambient always does, and
 * .playback only ever comes with mixWithOthers, so the user's music is turned down for a cue at
 * most and never stopped.
 */
public struct CueSessionShape: Equatable {
    public enum Category: String { case ambient, playback }
    public enum Mode: String { case standard, voicePrompt }

    public let category: Category
    public let mode: Mode
    public let mixWithOthers: Bool
    public let duckOthers: Bool

    public init(category: Category, mode: Mode, mixWithOthers: Bool, duckOthers: Bool) {
        self.category = category
        self.mode = mode
        self.mixWithOthers = mixWithOthers
        self.duckOthers = duckOthers
    }

    /// Between cues: mixes, keeps to the ring/silent switch, turns nobody down.
    public static let resting = CueSessionShape(category: .ambient, mode: .standard, mixWithOthers: false, duckOthers: false)

    /// While something sounds. `onSilent` (Settings → "Play even on silent") rings through the
    /// switch; `speechOnly` picks the spoken-prompt mode, which only .playback offers.
    public static func sounding(onSilent: Bool, speechOnly: Bool) -> CueSessionShape {
        if onSilent {
            return CueSessionShape(category: .playback, mode: speechOnly ? .voicePrompt : .standard, mixWithOthers: true, duckOthers: true)
        }
        return CueSessionShape(category: .ambient, mode: .standard, mixWithOthers: false, duckOthers: true)
    }

    /// True for every shape that leaves other apps playing (the whole point of this file).
    public var mixes: Bool { category == .ambient || mixWithOthers }
}

/** What the plugin should do to the session after a cue began or ended. */
public enum CueSessionStep: Equatable {
    case none
    /// Set the category to this shape and make the session active.
    case activate(CueSessionShape)
    /// Nothing sounds any more: after `grace` seconds, if still nothing sounds, deactivate with
    /// notifyOthersOnDeactivation (the music comes back up) and go back to `resting`.
    case deactivate(grace: TimeInterval)
}

/**
 * Which of the app's own sounds are playing (end tones, own clips, spoken lines), so the session
 * is let go only once the last one ended, whichever order they end in, and is never left active
 * (music ducked for good) because one ending was missed.
 */
public struct CueAudioLedger {
    public enum Kind: Equatable { case tone, speech }

    private struct Open: Equatable {
        let kind: Kind
        let onSilent: Bool
    }

    private var open: [Int: Open] = [:]
    private var nextId = 0
    /// The shape the session was last made active in, nil while it is not active.
    public private(set) var activeShape: CueSessionShape?

    /// A short gap between two cues (a tone, then the line after it) keeps the music down instead
    /// of letting it jump up and back.
    public static let grace: TimeInterval = 0.25

    public init() {}

    public var isIdle: Bool { open.isEmpty }
    public var count: Int { open.count }

    /// The shape the open sounds need together: through the switch if any of them asked for it.
    public var wantedShape: CueSessionShape? {
        guard !open.isEmpty else { return nil }
        let onSilent = open.values.contains { $0.onSilent }
        let speechOnly = open.values.allSatisfy { $0.kind == .speech }
        return CueSessionShape.sounding(onSilent: onSilent, speechOnly: speechOnly)
    }

    /// A sound starts. Answers its id (for `end`) and what to do to the session first.
    public mutating func begin(_ kind: Kind, onSilent: Bool) -> (id: Int, step: CueSessionStep) {
        nextId += 1
        let id = nextId
        open[id] = Open(kind: kind, onSilent: onSilent)
        guard let wanted = wantedShape else { return (id, .none) }
        if activeShape == wanted { return (id, .none) }
        // Already ringing through the switch: a quieter sound joining it changes nothing.
        if let now = activeShape, now.category == .playback, wanted.category == .ambient { return (id, .none) }
        return (id, .activate(wanted))
    }

    /// A sound ended (or was cut off). Unknown or already-ended ids change nothing.
    public mutating func end(_ id: Int) -> CueSessionStep {
        guard open.removeValue(forKey: id) != nil else { return .none }
        return open.isEmpty && activeShape != nil ? .deactivate(grace: CueAudioLedger.grace) : .none
    }

    /// Every sound of one kind ended at once (hush, a flush that cut the lines off).
    public mutating func endAll(_ kind: Kind? = nil) -> CueSessionStep {
        let before = open.count
        open = open.filter { kind != nil && $0.value.kind != kind }
        guard open.count != before else { return .none }
        return open.isEmpty && activeShape != nil ? .deactivate(grace: CueAudioLedger.grace) : .none
    }

    /// The session went active in this shape (setActive(true) succeeded).
    public mutating func didActivate(_ shape: CueSessionShape) { activeShape = shape }

    /// The session is not active any more: deactivated by us, or by the system (an interruption,
    /// the app leaving the screen). Sounds still open stay open and reactivate on the next begin.
    public mutating func didDeactivate() { activeShape = nil }

    /// Everything forgotten: the system took the session (a call), nothing of ours plays now.
    public mutating func reset() {
        open = [:]
        activeShape = nil
    }

    /// A deactivation can fail while some audio is still rendering (busy). Try again after these
    /// waits, then give up and call it inactive: better than a duck that never ends.
    public static func retryDelay(attempt: Int) -> TimeInterval? {
        let waits: [TimeInterval] = [0.3, 0.6, 1.2, 2.4]
        return attempt >= 0 && attempt < waits.count ? waits[attempt] : nil
    }

    /// The longest a spoken line may hold the music down if the synthesizer never says it is done
    /// (it skips its delegate now and then): about 12 characters a second at rate 1, plus slack.
    public static func speechCap(text: String, rate: Double) -> TimeInterval {
        let r = rate.isFinite && rate > 0 ? min(2, max(0.5, rate)) : 1
        let secs = Double(text.count) / (12 * r) + 3
        return min(60, max(3, secs))
    }
}
