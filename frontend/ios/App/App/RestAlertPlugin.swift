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
        /// When this end was set (ms): a watch's change older than it is left alone (PhoneRestAlarm).
        var since: Double = Date().timeIntervalSince1970 * 1000
        /// The tone and the rest-over line baked into one file in Library/Sounds (#1393): the rest's own alert only, never the cues'.
        var lineSound: String?
    }
    private var pending: Pending?
    /// Names the bake now allowed to finish: a new rest, a cancel or a hold lets an older one go to waste.
    private var bakeId = UUID()
    /// The synthesizer writing the rest-over line to samples, kept alive until it is done.
    private var baking: AVSpeechSynthesizer?
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
        // The Lock Screen's +15 or a set logged there booked the alert itself: that is the newest change of the rest.
        nc.addObserver(self, selector: #selector(restBooked(_:)), name: LiveActivityQueue.restBooked, object: nil)
        // The watch's +15, −15, Skip or a set's rest, with the page asleep: this alert moves with it.
        nc.addObserver(self, selector: #selector(watchRest(_:)), name: WatchLink.eventStored, object: nil)
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
        bakeId = UUID()
        let mine = bakeId
        let line = call.getObject("line")
        let withTone = pending?.sound == true ? pending?.tone : nil
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState != .active {
                self.withdraw()
                self.post()
            }
            if let line = line { self.bakeLine(line, tone: withTone, id: mine) }
            call.resolve()
        }
    }

    // MARK: the rest-over line in the notification's sound (#1393)

    private func number(_ v: Any?) -> Double? {
        (v as? Double) ?? (v as? NSNumber)?.doubleValue ?? (v as? Int).map(Double.init)
    }

    /// The utterance for `text` with the voice rules every spoken cue follows: the voice picked by its
    /// identifier, else the language's own. One that is not on this phone (any more) leaves the default.
    private func utterance(_ text: String, lang: String, rate: Float, pitch: Float, voiceId: String) -> AVSpeechUtterance {
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
        return utterance
    }

    /// Main thread. Makes the line's samples (the person's own clip, else the spoken line written
    /// out), then the file. Any failure leaves the tone-only notification as it is.
    private func bakeLine(_ line: [String: Any], tone: String?, id: UUID) {
        if let hash = line["clip"] as? String {
            // Validated as a hash, so it can never name a path outside the media folder.
            guard RestTone.userHash("u:\(hash)") != nil,
                  let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
            let url = lib.appendingPathComponent("opengym-media", isDirectory: true).appendingPathComponent("\(hash).wav")
            DispatchQueue.global(qos: .utility).async { self.finishBake(RestTone.samples(contentsOf: url), tone: tone, id: id) }
            return
        }
        guard let text = line["text"] as? String, !text.isEmpty else { return }
        let u = utterance(String(text.prefix(500)), lang: line["lang"] as? String ?? "", rate: Float(number(line["rate"]) ?? 1),
                          pitch: Float(number(line["pitch"]) ?? 1), voiceId: line["voice"] as? String ?? "")
        let synth = AVSpeechSynthesizer()
        baking = synth
        let queue = DispatchQueue(label: "opengym.restline")
        var buffers: [AVAudioPCMBuffer] = []
        var finished = false
        func finish(_ samples: [Int16]?) {
            finished = true
            DispatchQueue.main.async { if self.baking === synth { self.baking = nil } }
            finishBake(samples, tone: tone, id: id)
        }
        // write() hands over buffers (never plays them, never touches the audio session); an empty one is the end.
        synth.write(u) { buffer in
            queue.async {
                guard !finished else { return }
                if let pcm = buffer as? AVAudioPCMBuffer, pcm.frameLength > 0 { buffers.append(pcm) } else { finish(RestTone.samples(buffers)) }
            }
        }
        // A synthesizer that never reports the end: the tone-only notification stays.
        queue.asyncAfter(deadline: .now() + 10) { if !finished { finish(nil) } }
    }

    /// Off the main thread: tone, gap and line into one file, then the notification is posted again with it.
    private func finishBake(_ line: [Int16]?, tone: String?, id: UUID) {
        guard let line = line, !line.isEmpty else { return }
        var toneSamples: [Int16] = []
        if let tone = tone {
            // A sound of one's own whose file is not on this phone yet rings the chime, as post() does.
            guard let url = RestTone.soundFile(tone) ?? RestTone.soundFile("chime"), let s = RestTone.samples(contentsOf: url) else { return }
            toneSamples = s
        }
        // The same silence after the line as after a tone: Bluetooth earbuds clip the end of a sound.
        let padded = line + [Int16](repeating: 0, count: Int(RestTone.tailSec * Double(RestTone.rate)))
        let mix = RestLineMix.join(tone: toneSamples, line: padded, rate: RestTone.rate)
        // Over 30 s join() keeps the tone alone, and a line alone has no cap there: no point in a file then.
        guard mix.count > toneSamples.count, mix.count <= 29 * RestTone.rate,
              let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
        // A new name each time: iOS keeps a notification sound by its name.
        let name = "rest-line-\(UUID().uuidString).wav"
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try RestTone.wav(mix).write(to: dir.appendingPathComponent(name), options: .atomic)
        } catch { return }
        DispatchQueue.main.async {
            let old = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
            // Still the same rest: the notification goes back in with the line. Not in front: the page rings it.
            if self.bakeId == id, var p = self.pending {
                p.lineSound = name
                self.pending = p
                if UIApplication.shared.applicationState != .active {
                    self.withdraw()
                    self.post()
                }
            }
            let keep = self.pending?.lineSound
            for f in old where f.hasPrefix("rest-line-") && f != name && f != keep {
                try? FileManager.default.removeItem(at: dir.appendingPathComponent(f))
            }
            if self.pending?.lineSound != name { try? FileManager.default.removeItem(at: dir.appendingPathComponent(name)) }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        pending = nil
        bakeId = UUID()
        withdraw()
        call.resolve()
    }

    @objc func hold(_ call: CAPPluginCall) {
        pending = nil
        bakeId = UUID()
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
                // Plays over the user's music and never stops it; the music ducks for it only with
                // "Play even on silent" (CueAudioLedger).
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
            let utterance = self.utterance(text, lang: lang, rate: rate, pitch: pitch, voiceId: voiceId)
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
        // Whatever happened above, never sound in .soloAmbient (the session iOS starts an app in,
        // and the one WebKit can leave behind): it stops the music. A .playback shape the ledger
        // holds is set again, so a sound meant to ring through the silent switch still does;
        // anything else gets .ambient, which mixes with the music.
        if AVAudioSession.sharedInstance().category == .soloAmbient {
            if let shape = ledger.activeShape, shape.category == .playback { apply(.activate(shape)) } else { RestAlertPlugin.mixWithMusic() }
        }
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
                // Played anyway, without the duck. A category that took stays (play() activates
                // it, so an onSilent cue keeps .playback); one that did not falls back to the
                // mixing kind, never .soloAmbient. The next cue tries the activation again, and
                // the session is still let go once nothing sounds (CueAudioLedger.holdsSession).
                if session.category != shape.avCategory { RestAlertPlugin.mixWithMusic() }
                ledger.didFailActivation()
            }
        case .deactivate(let grace):
            DispatchQueue.main.asyncAfter(deadline: .now() + grace) { self.letGo(attempt: 0) }
        }
    }

    /// Music back up: the session goes inactive with notifyOthersOnDeactivation once nothing of
    /// ours sounds, retried while the system still calls it busy, then back to the resting kind.
    private func letGo(attempt: Int) {
        guard ledger.isIdle, ledger.holdsSession else { return }
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
            p = Pending(at: Date().addingTimeInterval(1), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues, lineSound: p.lineSound)
            self.pending = p
            self.withdraw()
            if UIApplication.shared.applicationState != .active { self.post() }
        }
    }

    /// The Lock Screen booked the rest's alert (already posted): the end and the ordering mark follow it.
    @objc private func restBooked(_ note: Notification) {
        guard let end = note.userInfo?["end"] as? Double, end.isFinite else { return }
        // When it was booked, not when this block runs: a watch change stored in between still counts.
        let at = (note.userInfo?["at"] as? Double) ?? Date().timeIntervalSince1970 * 1000
        DispatchQueue.main.async {
            guard let p = self.pending else { return }
            self.pending = Pending(at: Date(timeIntervalSince1970: end / 1000), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues, since: at, lineSound: p.lineSound)
        }
    }

    /// Stop auto on the Lock Screen: the alert booked now stays (a hold running still ends), the
    /// chain's alerts after it go. Only those go, never the rest's own id: a set logged during a hold
    /// has just booked the next rest's alarm under it (tick), and this block runs after that.
    @objc private func autoStopped() {
        DispatchQueue.main.async {
            guard var p = self.pending else { return }
            p.cues = []
            self.pending = p
            self.withdraw(RestAlertPlugin.cueIds)
        }
    }

    /// The rest changed on the watch while the page sleeps (the phone locked in a pocket): the alert
    /// rings when the watch's rest ends, or not at all after a Skip there, instead of at the old end.
    /// The page books its own again when it wakes and applies the same event. In front, the page does it.
    @objc private func watchRest(_ note: Notification) {
        guard let ev = note.userInfo?["event"] as? [String: Any] else { return }
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .active, let p = self.pending else { return }
            let wid = UserDefaults.standard.string(forKey: WatchBridgePlugin.idleWidKey)
            guard let c = PhoneRestAlarm.change(ev, wid: wid, since: p.since, now: Date().timeIntervalSince1970 * 1000) else { return }
            self.withdraw()
            if c.sameRest, let over = c.over {
                // The watch's end passed already (an event that came late): the chain keeps its phases from it, and only what is still ahead rings.
                self.pending = Pending(at: Date(timeIntervalSince1970: over / 1000), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues, since: c.at, lineSound: p.lineSound)
                self.post()
            } else if c.sameRest, let end = c.end {
                self.pending = Pending(at: Date(timeIntervalSince1970: end / 1000), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues, since: c.at, lineSound: p.lineSound)
                self.post()
            } else if c.sameRest, !p.cues.isEmpty {
                // Skip before a hold that starts by itself: its count-in now, the chain after it (as restSkipped).
                self.pending = Pending(at: Date().addingTimeInterval(1), title: p.title, sound: p.sound, tone: p.tone, cues: p.cues, since: c.at, lineSound: p.lineSound)
                self.post()
            } else {
                // A Skip, or a set ticked at the wrist: that set's new rest is the page's to book when it wakes, named for the next set.
                self.pending = nil
            }
            if #available(iOS 17.0, *), let wid = wid { Task { await LiveActivityTick.followWatchRest(wid: wid, end: c.end) } }
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
            if id == RestAlertPlugin.requestId, let line = p.lineSound, RestAlertPlugin.soundExists(line) {
                // Tone and line in one file (the tone left out when the rest sound is off); the cues keep the plain tone.
                content.sound = UNNotificationSound(named: UNNotificationSoundName(line))
            } else if p.sound {
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

    private static func soundExists(_ name: String) -> Bool {
        guard let lib = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return false }
        return FileManager.default.fileExists(atPath: lib.appendingPathComponent("Sounds").appendingPathComponent(name).path)
    }

    private func withdraw(_ ids: [String] = [RestAlertPlugin.requestId] + RestAlertPlugin.cueIds) {
        let center = UNUserNotificationCenter.current()
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
