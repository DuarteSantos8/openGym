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
 * The session itself is WatchLink's (below), activated at launch by AppDelegate and not only once
 * the page's plugin loads: iOS wakes the app in the background for what the watch sends, and a
 * session activated only with the page received nothing until the app was opened (#882). The watch
 * sends its events as a message while the phone is in reach (stored here, answered with the ids
 * stored, so they are there in a moment), else with transferUserInfo; it keeps each one until the
 * page has applied it and the snapshot says so (`acked`, lib/watch-sync.js).
 *
 * Without a paired watch nothing happens: status says so and sendSnapshot is a no-op.
 *
 * A Garmin rides along (GarminLink.swift, docs/GARMIN.md): status says `garmin: true` when one with
 * the openGym app was picked in Garmin Connect, the page then adds its cut-down snapshot
 * (`garmin`) to each sendSnapshot, and the Garmin's events land in the same queue file. The Apple
 * Watch keeps its own snapshot; both can be there at once.
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
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
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
        CAPPluginMethod(name: "garminStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminPick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "garminStore", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        WatchLink.shared.plugin = self
        WatchLink.shared.start()
    }

    /* ---------- the page's calls ---------- */

    @objc func status(_ call: CAPPluginCall) {
        // A Garmin with the openGym app counts as a watch for the page: it then sends snapshots.
        let g = GarminLink.shared
        let garmin = GarminLink.onMain { g.anyInstalled() }
        guard WCSession.isSupported() else {
            call.resolve(["supported": garmin, "paired": garmin, "installed": garmin, "reachable": GarminLink.onMain { g.anyReachable() }, "garmin": garmin])
            return
        }
        let s = WCSession.default
        call.resolve([
            "supported": true,
            // A Garmin needs no WatchConnectivity session to be up.
            "activated": s.activationState == .activated || garmin,
            "paired": s.isPaired || garmin,
            "installed": s.isWatchAppInstalled || garmin,
            "reachable": s.isReachable || GarminLink.onMain { g.anyReachable() },
            "garmin": garmin,
        ])
    }

    /* ---------- the Garmin (Settings → Garmin, views/GarminSettings.jsx) ---------- */

    @objc func garminStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(GarminLink.shared.status()) }
    }

    /// Garmin Connect Mobile opens with its list of watches; the picked ones come back by URL.
    @objc func garminPick(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["ok": GarminLink.shared.pick()]) }
    }

    @objc func garminStore(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["ok": GarminLink.shared.openStore()]) }
    }

    /// A workout started on the phone: the watch app opens with it (Settings → Apple Watch, "Open on
    /// the watch"). HealthKit wakes the watch app with the workout's planned type (the page's
    /// `type`, else strength training), and the watch starts its workout session (OpenGymWatchApp's
    /// delegate). Only with a paired watch that has the app; anything else resolves { ok: false }
    /// and nothing happens.
    @objc func openOnWatch(_ call: CAPPluginCall) {
        // A Garmin with the app shows its own "open openGym?" prompt.
        let garmin = GarminLink.onMain { GarminLink.shared.open() }
        guard WCSession.isSupported(), WCSession.default.activationState == .activated,
              WCSession.default.isPaired, WCSession.default.isWatchAppInstalled,
              HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["ok": garmin])
            return
        }
        let config = HKWorkoutConfiguration()
        // The type the page planned (lib/health-connect.js plannedType, #799): a run opens as a run.
        config.activityType = AppleHealthPlugin.activityTypes[call.getString("type") ?? ""] ?? .traditionalStrengthTraining
        config.locationType = .indoor
        WatchBridgePlugin.health.startWatchApp(with: config) { ok, _ in
            call.resolve(["ok": ok || garmin])
        }
    }

    private static let health = HKHealthStore()

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json is required")
            return
        }
        WatchBridgePlugin.keepActivity(of: json)
        // The Garmin's cut-down snapshot (lib/garmin-snapshot.js), when the page made one.
        var garminSent = false
        if let g = call.getString("garmin") { garminSent = GarminLink.onMain { GarminLink.shared.send(g) } }
        guard WCSession.isSupported() else { call.resolve(["sent": garminSent]); return }
        let s = WCSession.default
        guard s.activationState == .activated, s.isPaired, s.isWatchAppInstalled else {
            call.resolve(["sent": garminSent])
            return
        }
        // Stamped: iOS does not deliver an application context equal to the last one, and the page
        // sends the same snapshot again on purpose when the watch app was (re)installed. The watch
        // reads "snapshot", and skips a stamp older than the newest it applied (SnapshotOrder), so
        // the stamp goes up with every snapshot whatever the clock does (nextStamp).
        let payload: [String: Any] = ["snapshot": json, "at": WatchBridgePlugin.stampSnapshot()]
        do {
            try s.updateApplicationContext(payload)
        } catch {
            call.resolve(["sent": garminSent, "error": error.localizedDescription])
            return
        }
        if s.isReachable {
            s.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
        call.resolve(["sent": true])
    }

    static let snapshotAtKey = "watchSnapshotAt"
    private static let stampLock = NSLock()

    /// The stamp for the next snapshot (seconds since 1970): the clock, but always after the last
    /// one given. The watch applies snapshots in the order of their stamps, and a phone whose
    /// clock went back (a time correction, a clock set by hand, less than SnapshotOrder's six
    /// hours) sent stamps the watch took for old: it skipped every snapshot until the clock had
    /// caught up, a set ticked on the phone never showing on the wrist. Kept on disk, so the order
    /// holds across launches of the app.
    static func nextStamp(now: Double, last: Double) -> Double {
        guard last.isFinite, last > 0 else { return now }
        return max(now, last + 0.001)
    }

    static func stampSnapshot() -> Double {
        stampLock.lock()
        defer { stampLock.unlock() }
        let d = UserDefaults.standard
        let at = nextStamp(now: Date().timeIntervalSince1970, last: d.double(forKey: snapshotAtKey))
        d.set(at, forKey: snapshotAtKey)
        return at
    }

    @objc func drain(_ call: CAPPluginCall) {
        WatchLink.shared.queue.async {
            call.resolve(["events": WatchLink.shared.readEvents()])
        }
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = Set((call.getArray("ids") ?? []).compactMap { $0 as? String })
        WatchLink.shared.queue.async {
            let left = WatchLink.shared.readEvents().filter { event in
                guard let id = event["id"] as? String else { return false }
                return !ids.contains(id)
            }
            WatchLink.shared.writeEvents(left)
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
        let count = max(2, min(30, SafeNum.int(seconds * 10)))
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

    /* ---------- "still going?" from the watch (#904) ---------- */

    static let idleWidKey = "watchIdleWid"
    static let idleActiveAtKey = "watchIdleActiveAt"

    /// The running workout and when it was last used on this phone, from the newest snapshot the
    /// page handed over (sent to the watch or not), kept on disk: the watch may ask while the app
    /// was woken in the background only to answer it.
    static func keepActivity(of json: String) {
        let snap = json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        let active = snap?["active"] as? [String: Any]
        let d = UserDefaults.standard
        if let wid = active?["id"] as? String { d.set(wid, forKey: idleWidKey) } else { d.removeObject(forKey: idleWidKey) }
        if let at = active?["activeAt"] as? NSNumber { d.set(at.doubleValue, forKey: idleActiveAtKey) } else { d.removeObject(forKey: idleActiveAtKey) }
    }

}

/**
 * The phone's WatchConnectivity session, from launch on (AppDelegate), for the page's plugin and
 * for the background launches iOS makes for the watch: a set sent while the phone is locked is on
 * disk here at once, and the watch's "still going?" is answered with the page asleep.
 */
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()
    /// The page's plugin, once it loaded: told of new events and of the link changing.
    weak var plugin: WatchBridgePlugin?
    let queue = DispatchQueue(label: "ch.opengym.watch-events")

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        if session.activationState != .activated { session.activate() }
    }

    func tell(_ name: String, _ data: [String: Any]) {
        DispatchQueue.main.async { self.plugin?.notifyListeners(name, data: data) }
    }

    /// Before it ends a workout as forgotten, the watch asks whether it goes on here (its copy may
    /// be stale): the answer is the workout this phone runs and when it was last used in it.
    /// The watch's events while the phone is in reach come the same way, as one message: each is
    /// stored (on disk before the answer), and the answer names the ids stored, so the watch need
    /// not send them again by transfer.
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if let list = message["events"] as? [String] {
            let got = list.compactMap { store($0) }
            if !got.isEmpty { tell("watchEvent", [:]) }
            replyHandler(["got": got])
            return
        }
        guard message["idleCheck"] != nil else { replyHandler([:]); return }
        let d = UserDefaults.standard
        var answer: [String: Any] = [:]
        if let wid = d.string(forKey: WatchBridgePlugin.idleWidKey) { answer["wid"] = wid }
        if d.object(forKey: WatchBridgePlugin.idleActiveAtKey) != nil { answer["activeAt"] = d.double(forKey: WatchBridgePlugin.idleActiveAtKey) }
        replyHandler(answer)
    }

    /* ---------- the watch's side ---------- */

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let json = userInfo["event"] as? String, store(json) != nil else { return }
        tell("watchEvent", [:])
    }

    /// One event from the watch into the queue file, once (by its id). On disk before this returns:
    /// once a transfer's delegate call has returned, WatchConnectivity counts it as delivered, and
    /// an app woken in the background for it may be suspended right after. Returns its id, or nil
    /// when it is not an event.
    @discardableResult
    func store(_ json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = event["id"] as? String else { return nil }
        // Stored (or there already) is what the answer to the watch means: an event that could not
        // be written is not named, so the watch keeps sending it instead of counting it delivered.
        var stored = true
        queue.sync {
            var events = self.readEvents()
            if !events.contains(where: { ($0["id"] as? String) == id }) {
                events.append(event)
                stored = self.writeEvents(events)
            }
        }
        return stored ? id : nil
    }

    /// The page asked for the status before the session was up (right after launch): it is told now.
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        tell("watchState", ["activated": activationState == .activated])
    }

    /// A watch paired or unpaired, the app installed on it or removed.
    public func sessionWatchStateDidChange(_ session: WCSession) {
        tell("watchState", ["paired": session.isPaired, "installed": session.isWatchAppInstalled])
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

    /// Only on `queue`.
    func readEvents() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return list
    }

    /// Only on `queue`. Whether the file was written.
    @discardableResult
    func writeEvents(_ events: [[String: Any]]) -> Bool {
        // A queue no page drained for a long time is capped, oldest first: many workouts' sets.
        let kept = Array(events.suffix(1000))
        guard let data = SafeJSON.data(kept) else { return false }
        return (try? data.write(to: fileURL, options: .atomic)) != nil
    }
}
