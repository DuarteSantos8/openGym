import Foundation
import UIKit
import MediaPlayer
import Capacitor

/**
 * The Music app's player, for the music bar of a workout (lib/music/apple-music.js): what plays,
 * and play / pause / next / previous. MPMusicPlayerController's system player is the Music app
 * itself, so a song started there is the one these buttons steer, and it plays on when openGym
 * is closed. The title of what plays needs access to the media library (NSAppleMusicUsageDescription).
 *
 *   authorize()          { granted }
 *   nowPlaying({known})  { authorized, playing, id?, title?, artist?, artwork? }; the artwork (a
 *                        small JPEG data URL) only when the song is not `known` already
 *   play() pause() next() previous()
 */
@objc(MusicPlayerPlugin)
public class MusicPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MusicPlayerPlugin"
    public let jsName = "MusicPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "previous", returnType: CAPPluginReturnPromise),
    ]

    private var player: MPMusicPlayerController { MPMusicPlayerController.systemMusicPlayer }

    @objc func authorize(_ call: CAPPluginCall) {
        if MPMediaLibrary.authorizationStatus() != .notDetermined {
            call.resolve(["granted": MPMediaLibrary.authorizationStatus() == .authorized])
            return
        }
        MPMediaLibrary.requestAuthorization { status in
            call.resolve(["granted": status == .authorized])
        }
    }

    @objc func nowPlaying(_ call: CAPPluginCall) {
        let known = call.getString("known") ?? ""
        DispatchQueue.main.async {
            let status = MPMediaLibrary.authorizationStatus()
            var r: [String: Any] = [
                "authorized": status != .denied && status != .restricted,
                "playing": self.player.playbackState == .playing,
            ]
            if let item = self.player.nowPlayingItem {
                let id = String(item.persistentID)
                r["id"] = id
                r["title"] = item.title ?? ""
                r["artist"] = item.artist ?? item.albumArtist ?? ""
                if id != known, let image = item.artwork?.image(at: CGSize(width: 96, height: 96)),
                   let jpeg = image.jpegData(compressionQuality: 0.7) {
                    r["artwork"] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                }
            }
            call.resolve(r)
        }
    }

    private func onMain(_ call: CAPPluginCall, _ work: @escaping (MPMusicPlayerController) -> Void) {
        DispatchQueue.main.async {
            work(self.player)
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) { onMain(call) { $0.play() } }
    @objc func pause(_ call: CAPPluginCall) { onMain(call) { $0.pause() } }
    @objc func next(_ call: CAPPluginCall) { onMain(call) { $0.skipToNextItem() } }
    @objc func previous(_ call: CAPPluginCall) { onMain(call) { $0.skipToPreviousItem() } }
}
