import AVFoundation
import Capacitor
import Foundation
import HealthKit
import ImageIO
import UniformTypeIdentifiers
import WatchConnectivity

/**
 * The phone's end of the Apple Watch link (frontend lib/watch-sync.js, watch app in ios/App/Watch).
 *
 * Phone → watch: the page hands over a snapshot of the running workout (what to lift, what is
 * done, the rest) as a JSON string. It goes out as the application context, which the watch gets
 * whenever it next can, and as a message too when the watch is reachable right now.
 *
 * Watch → phone: the watch sends what happened on it (a set ticked, with its weight and reps) with
 * transferUserInfo, which iOS delivers even when this app is not running. Every event is written to
 * a file first, so one that arrives while the page is asleep (the phone locked in a pocket) is
 * still there when the page wakes: the page drains the file, applies each event once (by its id)
 * and acknowledges it, which removes it here. A live page is told at once ("watchEvent").
 *
 * Without a paired watch nothing happens: status says so and sendSnapshot is a no-op.
 *
 * Usage from JS:
 *   const WatchBridge = registerPlugin('WatchBridge')
 *   await WatchBridge.status()            // { supported, paired, installed, reachable }
 *   await WatchBridge.sendSnapshot({ json })
 *   const { events } = await WatchBridge.drain()
 *   await WatchBridge.ack({ ids })
 *   WatchBridge.addListener('watchEvent', e => ...)
 *   await WatchBridge.sendClips({ wid, clips: [{ exId, path }] })   // the workout's animations
 *   await WatchBridge.openOnWatch()       // { ok }: a workout started here opens the watch app
 *   await WatchBridge.dropClips()         // the workout is over: clips still on their way are cancelled
 *   WatchBridge.addListener('watchState', ...)   // activated, paired, installed changed: ask status again
 *
 * Animations: only the running workout's, only as files sent with transferFile (the watch keeps
 * them while that workout runs and deletes them after). Each is what this phone shows for that
 * exercise: a file of a downloaded animation pack (`file`), or the app's built-in clip in the app
 * package (`path` under public/: the store build's animated WebP, an MP4 loop in other builds).
 * Made into a small looping GIF here (ImageIO reads animated WebP; AVFoundation the MP4), because
 * the watch shows a frame sequence. Nothing is fetched from anywhere.
 */
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendClips", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openOnWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dropClips", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue(label: "ch.opengym.watch-events")

    override public func load() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /* ---------- the page's calls ---------- */

    @objc func status(_ call: CAPPluginCall) {
        guard WCSession.isSupported() else {
            call.resolve(["supported": false, "paired": false, "installed": false, "reachable": false])
            return
        }
        let s = WCSession.default
        call.resolve([
            "supported": true,
            "activated": s.activationState == .activated,
            "paired": s.isPaired,
            "installed": s.isWatchAppInstalled,
            "reachable": s.isReachable,
        ])
    }

    /// A workout started on the phone: the watch app opens with it (Settings → Apple Watch, "Open on
    /// the watch"). HealthKit wakes the watch app with a strength-training configuration, and the
    /// watch starts its workout session (OpenGymWatchApp's delegate). Only with a paired watch that
    /// has the app; anything else resolves { ok: false } and nothing happens.
    @objc func openOnWatch(_ call: CAPPluginCall) {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isPaired, WCSession.default.isWatchAppInstalled,
              HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["ok": false])
            return
        }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        WatchBridgePlugin.health.startWatchApp(with: config) { ok, _ in
            call.resolve(["ok": ok])
        }
    }

    private static let health = HKHealthStore()

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json is required")
            return
        }
        guard WCSession.isSupported() else { call.resolve(["sent": false]); return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else {
            call.resolve(["sent": false])
            return
        }
        let payload: [String: Any] = ["snapshot": json]
        do {
            try s.updateApplicationContext(payload)
        } catch {
            call.resolve(["sent": false, "error": error.localizedDescription])
            return
        }
        if s.isReachable {
            s.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
        call.resolve(["sent": true])
    }

    @objc func drain(_ call: CAPPluginCall) {
        queue.async {
            call.resolve(["events": self.readEvents()])
        }
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = Set((call.getArray("ids") ?? []).compactMap { $0 as? String })
        queue.async {
            let left = self.readEvents().filter { event in
                guard let id = event["id"] as? String else { return false }
                return !ids.contains(id)
            }
            self.writeEvents(left)
            call.resolve()
        }
    }

    /// The workout is over: its clips still waiting to go to the watch are cancelled (they would
    /// pile up in the queue while the watch is away, and the watch drops them on arrival anyway).
    @objc func dropClips(_ call: CAPPluginCall) {
        if WCSession.isSupported(), WCSession.default.activationState == .activated {
            WCSession.default.outstandingFileTransfers.forEach { $0.cancel() }
        }
        clipQueue.async { self.clipsSent = [:] }
        call.resolve()
    }

    /// The phone's GIF cache (Caches/watch-clips): the most recently used few dozen are kept.
    static func pruneClipCache(keep: Int = 60) {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("watch-clips")
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys), files.count > keep else { return }
        let dated = files.map { ($0, (try? $0.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast) }
        for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(keep) { try? FileManager.default.removeItem(at: url) }
    }

    /// The clips already on their way for each workout, by exercise.
    private var clipsSent: [String: Set<String>] = [:]
    private let clipQueue = DispatchQueue(label: "ch.opengym.watch-clips", qos: .utility)

    @objc func sendClips(_ call: CAPPluginCall) {
        guard let wid = call.getString("wid"), WCSession.isSupported() else { call.resolve(["sent": 0]); return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else { call.resolve(["sent": 0]); return }
        let clips = (call.getArray("clips") ?? []).compactMap { $0 as? [String: Any] }
        call.resolve(["queued": clips.count])
        // Another workout's clips still queued (the watch was away): cancelled, this one's go first.
        for t in s.outstandingFileTransfers where (t.file.metadata?["wid"] as? String) != wid { t.cancel() }
        clipQueue.async {
            var sent = self.clipsSent[wid] ?? []
            if self.clipsSent.count > 4 { self.clipsSent = self.clipsSent.filter { $0.key == wid } }
            defer { WatchBridgePlugin.pruneClipCache() }
            for clip in clips {
                guard let exId = clip["exId"] as? String, !sent.contains(exId),
                      let gif = WatchBridgePlugin.gifFor(clip, named: exId) else { continue }
                s.transferFile(gif, metadata: ["exId": exId, "wid": wid])
                sent.insert(exId)
            }
            self.clipsSent[wid] = sent
        }
    }

    /// The clip as a small GIF: a file of a downloaded animation pack (`packId` + `drawing`, read
    /// through Background Assets, never by path) or a file in the app package (`path` under
    /// public/). Anything else is refused.
    static func gifFor(_ clip: [String: Any], named exId: String) -> URL? {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("watch-clips")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let pack = clip["packId"] as? String, let drawing = clip["drawing"] as? String {
            let out = dir.appendingPathComponent("\(pack)-\(drawing).gif")
            if FileManager.default.fileExists(atPath: out.path) { touch(out); return out }
            guard let data = AnimationPacksPlugin.packData(pack, drawing) else { return nil }
            return ClipCodec.makeGif(data: data, to: out, maxPixels: 160) ? out : nil
        }
        guard let path = clip["path"] as? String, !path.hasPrefix("/"), !path.contains(".."),
              ["webp", "gif", "mp4"].contains((path as NSString).pathExtension.lowercased()) else { return nil }
        let source = Bundle.main.bundleURL.appendingPathComponent("public").appendingPathComponent(path)
        guard FileManager.default.isReadableFile(atPath: source.path) else { return nil }
        return gif(for: source, named: exId)
    }

    /// A small looping GIF of a clip (160 px), cached by exercise: an animated WebP or GIF frame by
    /// frame through ImageIO, an MP4 sampled about ten times a second through AVFoundation.
    static func gif(for source: URL, named name: String) -> URL? {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("watch-clips")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "_")
        let out = dir.appendingPathComponent(safe + ".gif")
        if FileManager.default.fileExists(atPath: out.path) { touch(out); return out }
        if source.pathExtension.lowercased() != "mp4" { return gifFromImage(source, to: out) }
        let asset = AVURLAsset(url: source)
        let seconds = CMTimeGetSeconds(asset.duration)
        guard seconds.isFinite, seconds > 0 else { return nil }
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 160, height: 160)
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let count = max(2, min(30, Int(seconds * 10)))
        let step = seconds / Double(count)
        guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.gif.identifier as CFString, count, nil) else { return nil }
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFLoopCount as String: 0]] as CFDictionary)
        let frameProps = [kCGImagePropertyGIFDictionary as String: [kCGImagePropertyGIFDelayTime as String: step]] as CFDictionary
        var added = 0
        for i in 0..<count {
            let t = CMTime(seconds: step * Double(i), preferredTimescale: 600)
            if let img = try? gen.copyCGImage(at: t, actualTime: nil) {
                CGImageDestinationAddImage(dest, img, frameProps)
                added += 1
            }
        }
        guard added > 0, CGImageDestinationFinalize(dest) else {
            try? FileManager.default.removeItem(at: out)
            return nil
        }
        return out
    }

    /// Used now: kept longest by the cache's pruning.
    private static func touch(_ url: URL) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
    }

    /// An animated WebP or GIF, frame by frame with its delays (WatchCore ClipCodec, the same code
    /// CI tests on a synthetic clip).
    private static func gifFromImage(_ source: URL, to out: URL) -> URL? {
        ClipCodec.makeGif(from: source, to: out, maxPixels: 160) ? out : nil
    }

    /* ---------- the watch's side ---------- */

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let json = userInfo["event"] as? String,
              let data = json.data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              event["id"] is String else { return }
        // On disk before this returns: once it has, WatchConnectivity counts the transfer as
        // delivered, and an app woken in the background for it may be suspended right after. An
        // async write could then never run, and the watch would not send the set again.
        queue.sync {
            var events = self.readEvents()
            if !events.contains(where: { ($0["id"] as? String) == (event["id"] as? String) }) {
                events.append(event)
                self.writeEvents(events)
            }
        }
        DispatchQueue.main.async { self.notifyListeners("watchEvent", data: event) }
    }

    /// The page asked for the status before the session was up (right after launch): it is told now.
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { self.notifyListeners("watchState", data: ["activated": activationState == .activated]) }
    }

    /// A watch paired or unpaired, the app installed on it or removed.
    public func sessionWatchStateDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.notifyListeners("watchState", data: ["paired": session.isPaired, "installed": session.isWatchAppInstalled]) }
    }
    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) {
        // A different watch was paired: start a session with that one.
        WCSession.default.activate()
    }

    /* ---------- the queue file ---------- */

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("watch-events.json")
    }

    private func readEvents() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return list
    }

    private func writeEvents(_ events: [[String: Any]]) {
        // A queue no page drained for a long time is capped, oldest first: a few hundred sets.
        let kept = Array(events.suffix(500))
        if let data = try? JSONSerialization.data(withJSONObject: kept) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }
}
