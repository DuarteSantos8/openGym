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
 * down for it and back up after (a page's Web Audio cannot). buzz() is the phone's one vibration:
 * iOS has no patterns.
 */
@objc(RestAlertPlugin)
public class RestAlertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestAlertPlugin"
    public let jsName = "RestAlert"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hold", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buzz", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAccent", returnType: CAPPluginReturnPromise),
    ]

    static let requestId = "opengym.rest"

    /** The rest waiting to be rung, kept so it can go back in when the app leaves the screen. */
    private struct Pending {
        let at: Date
        let title: String
        let sound: Bool
        let tone: String
    }
    private var pending: Pending?
    private var player: AVAudioPlayer?

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(cameToFront), name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(leftFront), name: UIApplication.didEnterBackgroundNotification, object: nil)
        // Written ahead, off the main thread: the first rest then finds its sound file there.
        DispatchQueue.global(qos: .utility).async { RestTone.kinds.forEach { _ = RestTone.soundFile($0) } }
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
        guard at > Date() else {
            call.reject("at must be in the future")
            return
        }
        pending = Pending(
            at: at,
            title: call.getString("title") ?? "Rest’s over. Next set!",
            sound: call.getBool("sound") ?? true,
            tone: RestTone.normalised(call.getString("tone") ?? ((call.getBool("classic") ?? false) ? "classic" : "chime"))
        )
        DispatchQueue.main.async {
            if UIApplication.shared.applicationState != .active { self.post() }
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

    @objc func buzz(_ call: CAPPluginCall) {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        call.resolve()
    }

    @objc func tone(_ call: CAPPluginCall) {
        let kind = RestTone.normalised(call.getString("kind"))
        DispatchQueue.global(qos: .userInitiated).async {
            guard let url = RestTone.soundFile(kind) else {
                call.reject("no sound file")
                return
            }
            DispatchQueue.main.async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    // Plays over the user's music, which ducks for it, and respects the ring/silent
                    // switch like any other sound the app makes.
                    try session.setCategory(.ambient, mode: .default, options: [.duckOthers])
                    try session.setActive(true)
                    let p = try AVAudioPlayer(contentsOf: url)
                    self.player = p
                    p.play()
                    DispatchQueue.main.asyncAfter(deadline: .now() + p.duration + 0.1) {
                        if self.player === p { self.player = nil }
                        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
                    }
                    call.resolve()
                } catch {
                    call.reject("could not play the tone")
                }
            }
        }
    }

    @objc private func cameToFront() {
        withdraw()
    }

    @objc private func leftFront() {
        post()
    }

    private func post() {
        guard let p = pending, p.at > Date() else { return }
        let content = UNMutableNotificationContent()
        content.title = p.title
        if p.sound {
            content.sound = RestTone.soundFile(p.tone) != nil
                ? UNNotificationSound(named: UNNotificationSoundName(RestTone.soundName(p.tone)))
                : .default
        }
        if #available(iOS 15.0, *) { content.interruptionLevel = .active }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, p.at.timeIntervalSinceNow), repeats: false)
        let request = UNNotificationRequest(identifier: RestAlertPlugin.requestId, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    private func withdraw() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [RestAlertPlugin.requestId])
        center.removeDeliveredNotifications(withIdentifiers: [RestAlertPlugin.requestId])
    }
}
