import AVFoundation
import AudioToolbox
import Capacitor
import Foundation
import UIKit
import UserNotifications

/**
 * The rest-over alert on the iPhone (lib/rest-alert.js, the same calls as RestAlertPlugin.java).
 *
 * iOS stops the page's countdown as soon as the app leaves the screen, so the end of a rest is a
 * local notification scheduled for the moment it ends, with the end tone Settings → Sound picked
 * (RestTone.swift). With the app in front the page rings the end itself, so the notification is
 * only pending while the app is in the background: it is taken back when the app comes to the
 * front and put back for the same moment when the app leaves it. A paused rest has no end, so
 * hold() calls the notification off; resuming schedules it again.
 *
 * tone() plays the end tone with the app in front through the audio session, which turns music
 * down for it and back up after (a page's Web Audio cannot). buzz() stands in for the page's
 * navigator.vibrate, which iOS does not have.
 */
@objc(RestAlertPlugin)
public class RestAlertPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "RestAlertPlugin"
    public let jsName = "RestAlert"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buzz", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAccent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
    ]

    static let requestId = "opengym.rest"
    /// Timed holds that run themselves (lib/auto-holds.js): the alerts after the rest's, each its own
    /// notification. At most this many, and all of them taken back with the rest's.
    static let maxCues = 16
    static let cueIds: [String] = (1...RestAlertPlugin.maxCues).map { "\(RestAlertPlugin.requestId).c\($0)" }

    /** One alert after the first: `dt` seconds after it. */
    private struct Cue {
        let dt: TimeInterval
        let title: String
    }

    /** The rest waiting to be rung, kept so it can go back in when the app leaves the screen. */
    private struct Pending {
        let at: Date
        let title: String
        let sound: Bool
        let tone: String
        var cues: [Cue] = []
    }
    private var pending: Pending?
    /// The tones playing now, by their CueAudioLedger id (an end tone, an own clip, a hype clip).
    private var players: [Int: AVAudioPlayer] = [:]
    /// The spoken lines not finished yet, to their CueAudioLedger id.
    private var lines: [ObjectIdentifier: Int] = [:]
    /// Which of our sounds play now, and whether the session is held for them.
    private var ledger = CueAudioLedger()
    /// Whether a spoken cue is talking, without making the synthesizer just to ask.
    private var speechMade = false
    /// Spoken cues (lib/spoken-cues.js): made the first time something is said.
    private lazy var speech: AVSpeechSynthesizer = {
        let synth = AVSpeechSynthesizer()
        synth.delegate = self
        // Our session (the mixing one above), never one of its own that could stop the music.
        synth.usesApplicationAudioSession = true
        speechMade = true
        return synth
    }()

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(cameToFront), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(leftFront), name: UIApplication.didEnterBackgroundNotification, object: nil)
        // The Live Activity's Skip rest (WorkoutActivity.swift): this rest's alert is not posted later.
        nc.addObserver(self, selector: #selector(restSkipped), name: LiveActivityQueue.restSkipped, object: nil)
        // The Live Activity's Stop auto: the chain's alerts after this one are not rung.
        nc.addObserver(self, selector: #selector(autoStopped), name: LiveActivityQueue.autoStopped, object: nil)
        nc.addObserver(self, selector: #selector(audioInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        // Written ahead, off the main thread: the first rest then finds its sound file there.
        DispatchQueue.global(qos: .utility).async { RestTone.kinds.forEach { _ = RestTone.soundFile($0) } }
        // An app's session starts as .soloAmbient, which stops the music the moment anything in
        // the app makes a sound (Discord: "the app pauses my music"). .ambient mixes with it and
        // keeps to the ring/silent switch; not activated here, only the kind it will be.
        RestAlertPlugin.mixWithMusic()
    }

    /** The app's resting audio session: mixes with other audio, never interrupts it. */
    static func mixWithMusic() {
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [])
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let atMs = call.getDouble("at") else {
            call.reject("at is required")
            return
        }
        let at = Date(timeIntervalSince1970: atMs / 1000)
        // Finite and within a day: a rest end of 1e300 or NaN never reaches the notification trigger.
        guard atMs.isFinite, at > Date(), at.timeIntervalSinceNow < 86_400 else {
            call.reject("at must be in the future")
            return
        }
        let given: [JSObject] = call.getArray("cues", JSObject.self) ?? []
        let cues: [Cue] = given.prefix(RestAlertPlugin.maxCues).compactMap { c in
            let raw = c["dt"]
            guard let dt = (raw as? Double) ?? (raw as? NSNumber)?.doubleValue ?? (raw as? Int).map(Double.init), dt.isFinite, dt >= 0, dt < 86_400_000,
                  let title = c["title"] as? String else { return nil }
            return Cue(dt: dt / 1000, title: title)
        }
        pending = Pending(
            at: at,
            title: call.getString("title") ?? "Rest’s over. Next set!",
            sound: call.getBool("sound") ?? true,
            tone: RestTone.normalised(call.getString("tone") ?? ((call.getBool("classic") ?? false) ? "classic" : "chime")),
            cues: cues
        )
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState != .active {
                self.withdraw()
                self.post()
            }
            call.resolve()
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        pending = nil
        withdraw()
        call.resolve()
    }

    @objc func hold(_ call: CAPPluginCall) {
        pending = nil
        withdraw()
        call.resolve()
    }

    @objc func setAccent(_ call: CAPPluginCall) {
        call.resolve()
    }

    /**
     * The page's vibration pattern (on, off, on, … in milliseconds). iOS has one vibration of its
     * own length and no patterns, so each pulse of 100 ms or more is that vibration at its moment
     * in the pattern, and a shorter one (a set tick) is a tap of the haptic engine.
     */
    @objc func buzz(_ call: CAPPluginCall) {
        let pattern = (call.getArray("pattern") as? [NSNumber])?.map { $0.doubleValue } ?? [400]
        DispatchQueue.main.async {
            var at = 0.0
            for (i, ms) in pattern.enumerated() {
                if i % 2 == 0 && ms > 0 {
                    let long = ms >= 100
                    DispatchQueue.main.asyncAfter(deadline: .now() + at / 1000) {
                        if long {
                            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                        } else {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        }
                    }
                }
                at += ms
            }
            call.resolve()
        }
    }

    @objc func tone(_ call: CAPPluginCall) {
        let kind = RestTone.normalised(call.getString("kind"))
        // Settings → "Play even on silent": .playback rings through the switch, and mixing plus
        // ducking keeps it from stopping the music, which only turns down for the tone.
        let onSilent = call.getBool("onSilent") ?? false
        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = RestTone.soundFile(kind) ?? RestTone.soundFile("chime") else {
                call.reject("no sound file")
                return
            }
            DispatchQueue.main.async {
                let p: AVAudioPlayer
                do { p = try AVAudioPlayer(contentsOf: url) } catch {
                    call.reject("could not play the tone")
                    return
                }
                // Plays over the user's music, which ducks for it and never stops (CueAudioLedger).
                let id = self.beginSound(.tone, onSilent: onSilent)
                self.players[id] = p
                p.play()
                DispatchQueue.main.asyncAfter(deadline: .now() + p.duration + 0.1) {
                    self.players[id] = nil
                    self.endSound(id)
                }
                call.resolve()
            }
        }
    }

    /**
     * A spoken cue (Settings → Timer alerts → Spoken cues): { text, lang, rate, onSilent, flush }.
     * The same audio session as the end tone: other audio ducks for the line and never stops,
     * and comes back up once nothing is left to say. `flush` cuts off what is still being said
     * (a countdown number).
     */
    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("nothing to say")
            return
        }
        let lang = call.getString("lang") ?? ""
        let rate = Float(call.getDouble("rate") ?? 1)
        let pitch = Float(call.getDouble("pitch") ?? 1)
        let voiceId = call.getString("voice") ?? ""
        let onSilent = call.getBool("onSilent") ?? false
        let flush = call.getBool("flush") ?? false
        DispatchQueue.main.async {
            let utterance = AVSpeechUtterance(string: text)
            // Settings → Timer alerts → Voice (v1.4.5): the voice picked there, by its identifier;
            // one that is not on this phone (any more) leaves the language's default.
            if !voiceId.isEmpty, let picked = AVSpeechSynthesisVoice(identifier: voiceId) {
                utterance.voice = picked
            } else if !lang.isEmpty {
                let base = String(lang.split(separator: "-").first ?? "")
                if let voice = AVSpeechSynthesisVoice(language: lang) ?? AVSpeechSynthesisVoice(language: base) {
                    utterance.voice = voice
                }
            }
            let wanted = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(2, rate))
            utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, wanted))
            utterance.pitchMultiplier = max(0.5, min(2, pitch))
            // The new line holds the session before the old ones are cut off, so the music stays
            // down across a flush instead of bouncing up for a moment.
            let id = self.beginSound(.speech, onSilent: onSilent)
            self.lines[ObjectIdentifier(utterance)] = id
            if flush && self.speech.isSpeaking {
                self.speech.stopSpeaking(at: .immediate)
            }
            self.speech.speak(utterance)
            // The synthesizer now and then never reports a line as done: it lets go by itself.
            DispatchQueue.main.asyncAfter(deadline: .now() + CueAudioLedger.speechCap(text: text, rate: Double(rate))) {
                if self.lines.removeValue(forKey: ObjectIdentifier(utterance)) != nil { self.endSound(id) }
            }
            call.resolve()
        }
    }

    // MARK: the audio session (CueAudioCore/CueAudioLedger.swift decides, this applies it)

    /// A sound of ours starts: the session takes the shape every open sound needs together.
    private func beginSound(_ kind: CueAudioLedger.Kind, onSilent: Bool) -> Int {
        let (id, step) = ledger.begin(kind, onSilent: onSilent)
        apply(step)
        return id
    }

    private func endSound(_ id: Int) {
        apply(ledger.end(id))
    }

    private func apply(_ step: CueSessionStep) {
        switch step {
        case .none:
            return
        case .activate(let shape):
            let session = AVAudioSession.sharedInstance()
            do {
                try session.setCategory(shape.avCategory, mode: shape.avMode, options: shape.avOptions)
                try session.setActive(true)
                ledger.didActivate(shape)
            } catch {
                // Played anyway, without the duck; the session stays the mixing kind it was.
            }
        case .deactivate(let grace):
            DispatchQueue.main.asyncAfter(deadline: .now() + grace) { self.letGo(attempt: 0) }
        }
    }

    /// Music back up: the session goes inactive with notifyOthersOnDeactivation once nothing of
    /// ours sounds, retried while the system still calls it busy, then back to the resting kind.
    private func letGo(attempt: Int) {
        guard ledger.isIdle, ledger.activeShape != nil else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            if let wait = CueAudioLedger.retryDelay(attempt: attempt) {
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { self.letGo(attempt: attempt + 1) }
                return
            }
        }
        ledger.didDeactivate()
        RestAlertPlugin.mixWithMusic()
    }

    /// A call or Siri took the audio: nothing of ours plays now, and the next cue starts afresh.
    @objc private func audioInterrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async {
            self.players.values.forEach { $0.stop() }
            self.players = [:]
            self.lines = [:]
            self.ledger.reset()
        }
    }

    /// The phone's voices for Settings → Timer alerts → Voice: { voices: [{ id, name, lang, online, quality }] }.
    /// Every voice here is on the phone, so none needs the internet. Personal Voice is left out:
    /// it needs its own permission, and a voice made of someone's own recordings stays theirs.
    @objc func voices(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var out: [[String: Any]] = []
            for v in AVSpeechSynthesisVoice.speechVoices() {
                if #available(iOS 17.0, *), v.voiceTraits.contains(.isPersonalVoice) { continue }
                var quality = v.quality == .enhanced ? "enhanced" : "default"
                if #available(iOS 16.0, *), v.quality == .premium { quality = "premium" }
                out.append(["id": v.identifier, "name": v.name, "lang": v.language, "online": false, "quality": quality])
            }
            call.resolve(["voices": out])
        }
    }

    @objc func hush(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.speechMade { self.speech.stopSpeaking(at: .immediate) }
            // didCancel lets go of each line; anything it missed goes here.
            self.lines = [:]
            self.apply(self.ledger.endAll(.speech))
            call.resolve()
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        lineEnded(utterance)
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        lineEnded(utterance)
    }

    /// One line done or cut off; the music comes back up once the last sound of ours ended.
    private func lineEnded(_ utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            if let id = self.lines.removeValue(forKey: ObjectIdentifier(utterance)) { self.endSound(id) }
        }
    }

    @objc private func cameToFront() {
        withdraw()
    }

    @objc private func leftFront() {
        post()
        // The app is about to be suspended and cannot play on: hand the music its full volume back
        // now rather than whenever iOS gets round to it.
        players.values.forEach { $0.stop() }
        players = [:]
        lines = [:]
        if speechMade { speech.stopSpeaking(at: .immediate) }
        apply(ledger.endAll())
    }

    /// Skip rest on the Lock Screen. Before a hold that starts by itself, the chain goes on from
    /// now: its count-in rings at once and the alerts after it move up by the time skipped.
    @objc private func restSkipped() {
        DispatchQueue.main.async {
            guard var p = self.pending, !p.cues.isEmpty else {
                self.pending = nil
                return
            }
            p = Pending(at: Date().addingTimeInterval(1), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues)
            self.pending = p
            self.withdraw()
            if UIApplication.shared.applicationState != .active { self.post() }
        }
    }

    /// Stop auto on the Lock Screen: the alert booked now stays (a hold running still ends), the
    /// chain's alerts after it go.
    @objc private func autoStopped() {
        DispatchQueue.main.async {
            guard var p = self.pending else { return }
            p.cues = []
            self.pending = p
            self.withdraw()
            if UIApplication.shared.applicationState != .active { self.post() }
        }
    }

    private func post() {
        guard let p = pending else { return }
        // The rest's own alert, then each of the chain's at its time after it (the ones still ahead).
        let alerts: [(String, Date, String)] = [(RestAlertPlugin.requestId, p.at, p.title)]
            + p.cues.enumerated().map { (RestAlertPlugin.cueIds[$0.offset], p.at.addingTimeInterval($0.element.dt), $0.element.title) }
        for (id, at, title) in alerts where at > Date() {
            let content = UNMutableNotificationContent()
            content.title = title
            if p.sound {
                // A sound of one's own whose file is not on this phone yet rings the chime.
                let tone = RestTone.soundFile(p.tone) != nil ? p.tone : "chime"
                content.sound = RestTone.soundFile(tone) != nil
                    ? UNNotificationSound(named: UNNotificationSoundName(RestTone.soundName(tone)))
                    : .default
            }
            if #available(iOS 15.0, *) { content.interruptionLevel = .active }
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: SafeNum.interval(at.timeIntervalSinceNow), repeats: false)
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        }
    }

    private func withdraw() {
        let center = UNUserNotificationCenter.current()
        let ids = [RestAlertPlugin.requestId] + RestAlertPlugin.cueIds
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }
}


/// CueSessionShape (CueAudioCore) in AVAudioSession's terms.
extension CueSessionShape {
    var avCategory: AVAudioSession.Category { category == .playback ? .playback : .ambient }
    var avMode: AVAudioSession.Mode { mode == .voicePrompt ? .voicePrompt : .default }
    var avOptions: AVAudioSession.CategoryOptions {
        var o: AVAudioSession.CategoryOptions = []
        if mixWithOthers { o.insert(.mixWithOthers) }
        if duckOthers { o.insert(.duckOthers) }
        return o
    }
}
