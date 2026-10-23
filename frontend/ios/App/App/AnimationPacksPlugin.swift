import Foundation
import Capacitor
import Network
import System
import WebKit
#if canImport(BackgroundAssets)
import BackgroundAssets
#endif

/**
 * The sharper exercise animations, as Apple-hosted asset packs (Background Assets, iOS 26 and
 * later): one pack per quality and figure, `anim-<px>-male` / `anim-<px>-female`, uploaded to App
 * Store Connect and delivered by Apple, never by a server of ours (Gym visual licence: anything
 * above 180 px reaches people only inside the store app). The packs and what is in them come from
 * scripts/media/make-pack-manifests.mjs; inside a pack a drawing sits at `<packId>/<id>.webp`.
 * The page side is frontend/src/lib/anim-packs.js. On an older iOS every call answers
 * "unavailable" and the app shows its built-in animations.
 *
 * Reading a pack's files: Background Assets keeps all downloaded packs as one shared namespace
 * that is only meant to be read through AssetPackManager (contents(at:), descriptor(for:)); a
 * URL from url(for:) is valid for this process only and is not a folder with the pack's files in
 * it (build 30 showed a "downloaded" pack of 0.1 MB and no new animations). So the page never
 * gets a path: it asks for opengym-pack://<packId>/<drawing>.webp, which AnimationPackSchemeHandler
 * answers with the file's bytes from contents(at:searchingInAssetPackWithID:), memory-mapped, on a
 * background queue. Nothing is copied and nothing leaves the app.
 *
 * The app needs, in Info.plist, BAAppGroupID, BAHasManagedAssetPacks and BAUsesAppleHosting, and
 * the downloader extension (AnimationPacksDownloader), which the system runs to fetch packs.
 */
@objc(AnimationPacksPlugin)
public class AnimationPacksPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AnimationPacksPlugin"
    public let jsName = "AnimationPacks"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "localPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "diagnose", returnType: CAPPluginReturnPromise),
    ]

    /// One file of a downloaded pack, its bytes memory-mapped (the Apple Watch's clips,
    /// WatchBridgePlugin), or nil: not downloaded, no such drawing, or before iOS 26.
    static func packData(_ id: String, _ drawing: String) -> Data? {
        guard matches(packPattern, id), drawing.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            return try? AssetPackManager.shared.contents(at: FilePath("\(id)/\(drawing).webp"), searchingInAssetPackWithID: id, options: .mappedIfSafe)
        }
        #endif
        return nil
    }

    /// Only the ids the app knows: a pack id from the page goes nowhere else.
    static let packPattern = try! NSRegularExpression(pattern: "^anim-(240|360|480|720|1080)-(male|female)$")
    private static let probePattern = try! NSRegularExpression(pattern: "^[0-9]{4,5}$")

    static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private func packArgs(_ call: CAPPluginCall, probe needed: Bool) -> (String, String)? {
        guard let id = call.getString("packId"), AnimationPacksPlugin.matches(AnimationPacksPlugin.packPattern, id) else {
            call.reject("unknown pack", "failed")
            return nil
        }
        let probe = call.getString("probe") ?? ""
        if needed && !AnimationPacksPlugin.matches(AnimationPacksPlugin.probePattern, probe) {
            call.reject("probe is required", "failed")
            return nil
        }
        return (id, probe)
    }

    /// Apple-hosted packs: iOS 26, an app that declares them, its App Group and the downloader
    /// extension. Background Assets stops the app outright (a "programmer error") when the group
    /// or the extension is missing, as in an unsigned simulator build, so without them the packs
    /// are simply not offered and nothing touches AssetPackManager.
    static let supported: Bool = {
        guard #available(iOS 26.0, *) else { return false }
        let info = Bundle.main.infoDictionary ?? [:]
        guard info["BAUsesAppleHosting"] as? Bool == true, let group = info["BAAppGroupID"] as? String else { return false }
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else { return false }
        let ext = Bundle.main.bundleURL.appendingPathComponent("Extensions/AnimationPacksDownloader.appex")
        return FileManager.default.fileExists(atPath: ext.path)
    }()
    private var supported: Bool { AnimationPacksPlugin.supported }

    /// A TestFlight (or development) build: the page shows the packs' details row there.
    private static let testFlight: Bool = Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": supported, "testflight": AnimationPacksPlugin.testFlight])
    }

    /// The URL the page reads a pack's files from (AnimationPackSchemeHandler).
    static func base(_ id: String) -> String { "\(AnimationPackSchemeHandler.scheme)://\(id)" }

    /// 'ready' when the pack is on this device and its probe file can be read, with its size on
    /// disk (worked out once per pack version, then kept: it walks every file).
    @objc func status(_ call: CAPPluginCall) {
        guard let (id, probe) = packArgs(call, probe: true) else { return }
        guard supported else { call.resolve(["state": "none"]); return }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                guard AnimationPacksPlugin.readable(id, probe) else {
                    call.resolve(["state": "none"])
                    return
                }
                call.resolve(["state": "ready", "bytes": await AnimationPacksPlugin.localBytes(id), "base": AnimationPacksPlugin.base(id)])
            }
            return
        }
        #endif
        call.resolve(["state": "none"])
    }

    /// Kept for older pages: the base to read the pack's files from, never a file path.
    @objc func localPath(_ call: CAPPluginCall) {
        guard let (id, probe) = packArgs(call, probe: true) else { return }
        guard supported, AnimationPacksPlugin.readable(id, probe) else {
            call.reject("not downloaded", "unavailable")
            return
        }
        call.resolve(["path": AnimationPacksPlugin.base(id), "base": AnimationPacksPlugin.base(id)])
    }

    /// What a pack costs to download, before it is: { downloadSize } in bytes, from Apple.
    @objc func info(_ call: CAPPluginCall) {
        guard let (id, _) = packArgs(call, probe: false) else { return }
        guard supported else { call.resolve([:]); return }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                if let pack = try? await AssetPackManager.shared.assetPack(withID: id) {
                    call.resolve(["downloadSize": pack.downloadSize, "version": pack.version])
                } else {
                    call.resolve([:])
                }
            }
            return
        }
        #endif
        call.resolve([:])
    }

    /// For the details row (TestFlight): everything this side knows about one pack, as text.
    @objc func diagnose(_ call: CAPPluginCall) {
        guard let (id, probe) = packArgs(call, probe: true) else { return }
        var out: [String: Any] = ["supported": supported, "base": AnimationPacksPlugin.base(id), "probe": "\(id)/\(probe).webp"]
        guard supported else { call.resolve(out); return }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                let manager = AssetPackManager.shared
                out["readable"] = AnimationPacksPlugin.readable(id, probe)
                if #available(iOS 26.4, *) {
                    out["status"] = AnimationPacksPlugin.describe(await manager.localStatus(ofAssetPackWithID: id))
                }
                do {
                    let data = try manager.contents(at: FilePath("\(id)/\(probe).webp"), searchingInAssetPackWithID: id, options: .mappedIfSafe)
                    out["probeBytes"] = data.count
                } catch {
                    out["probeError"] = String(describing: error)
                }
                if let url = try? manager.url(for: FilePath("\(id)/\(probe).webp")) {
                    out["probeUrl"] = url.path
                    out["probeUrlExists"] = FileManager.default.fileExists(atPath: url.path)
                    let folder = url.deletingLastPathComponent()
                    out["folderFiles"] = (try? FileManager.default.contentsOfDirectory(atPath: folder.path).count) ?? -1
                }
                if let dir = try? manager.url(for: FilePath(id)) {
                    out["packUrl"] = dir.path
                    let (files, bytes) = AnimationPacksPlugin.walk(dir)
                    out["packFiles"] = files
                    out["packBytes"] = bytes
                }
                if let pack = try? await manager.assetPack(withID: id) {
                    out["downloadSize"] = pack.downloadSize
                    out["version"] = pack.version
                }
                call.resolve(out)
            }
            return
        }
        #endif
        call.resolve(out)
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let (id, _) = packArgs(call, probe: false) else { return }
        guard supported else { call.reject("asset packs need iOS 26", "unavailable"); return }
        let wifiOnly = call.getBool("wifiOnly") ?? true
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                if wifiOnly, await !AnimationPacksPlugin.onWifi() {
                    call.reject("waiting for Wi-Fi", "needs-wifi")
                    return
                }
                let manager = AssetPackManager.shared
                let watcher = Task { [weak self] in
                    for await update in await manager.statusUpdates(forAssetPackWithID: id) {
                        if case .downloading(_, let progress) = update {
                            self?.notifyListeners("progress", data: ["packId": id, "fraction": progress.fractionCompleted])
                        }
                    }
                }
                defer { watcher.cancel() }
                do {
                    let pack = try await manager.assetPack(withID: id)
                    // ensureLocalAvailability(of:requireLatestVersion:) only from iOS 26.4.
                    try await manager.ensureLocalAvailability(of: pack)
                    UserDefaults.standard.removeObject(forKey: AnimationPacksPlugin.bytesKey(id))
                    call.resolve()
                } catch is CancellationError {
                    call.reject("cancelled", "cancelled")
                } catch {
                    call.reject(error.localizedDescription, "failed")
                }
            }
            return
        }
        #endif
        call.reject("asset packs need iOS 26", "unavailable")
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let (id, _) = packArgs(call, probe: false) else { return }
        guard supported else { call.resolve(); return }
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    try await AssetPackManager.shared.remove(assetPackWithID: id)
                    UserDefaults.standard.removeObject(forKey: AnimationPacksPlugin.bytesKey(id))
                    call.resolve()
                } catch {
                    call.reject(error.localizedDescription, "failed")
                }
            }
            return
        }
        #endif
        call.resolve()
    }

    /// Whether the pack's probe file can be read through Background Assets: the test that the
    /// pack is really there for the scheme handler, not only listed as downloaded.
    static func readable(_ id: String, _ probe: String) -> Bool {
        #if canImport(BackgroundAssets)
        if #available(iOS 26.0, *) {
            guard let fd = try? AssetPackManager.shared.descriptor(for: FilePath("\(id)/\(probe).webp"), searchingInAssetPackWithID: id) else { return false }
            try? fd.close()
            return true
        }
        #endif
        return false
    }

    /// The pack's size on disk: its files counted once through the merged directory url(for:)
    /// gives for the pack's own folder (all of a pack's files sit under its id), then kept until
    /// the pack is downloaded again or removed.
    @available(iOS 26.0, *)
    private static func localBytes(_ id: String) async -> Int {
        let key = bytesKey(id)
        let kept = UserDefaults.standard.integer(forKey: key)
        if kept > 0 { return kept }
        #if canImport(BackgroundAssets)
        guard let dir = try? AssetPackManager.shared.url(for: FilePath(id)) else { return 0 }
        let bytes = walk(dir).1
        if bytes > 0 { UserDefaults.standard.set(bytes, forKey: key) }
        return bytes
        #else
        return 0
        #endif
    }

    static func bytesKey(_ id: String) -> String { "animPackBytes.\(id)" }

    /// Files and bytes under a folder.
    static func walk(_ dir: URL) -> (Int, Int) {
        let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .fileAllocatedSizeKey, .isRegularFileKey]
        guard let e = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys) else { return (0, 0) }
        var files = 0, bytes = 0
        for case let f as URL in e {
            guard let v = try? f.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
            files += 1
            bytes += v.totalFileAllocatedSize ?? v.fileAllocatedSize ?? 0
        }
        return (files, bytes)
    }

    @available(iOS 26.0, *)
    private static func describe(_ s: AssetPack.Status) -> String {
        var parts: [String] = []
        if s.contains(.downloadAvailable) { parts.append("downloadAvailable") }
        if s.contains(.downloading) { parts.append("downloading") }
        if s.contains(.downloaded) { parts.append("downloaded") }
        if s.contains(.upToDate) { parts.append("upToDate") }
        if s.contains(.outOfDate) { parts.append("outOfDate") }
        if s.contains(.updateAvailable) { parts.append("updateAvailable") }
        if s.contains(.obsolete) { parts.append("obsolete") }
        return parts.isEmpty ? "none" : parts.joined(separator: ",")
    }

    /// Whether the phone is on a network that costs nothing extra (Wi-Fi or a cable), now.
    private static func onWifi() async -> Bool {
        await withCheckedContinuation { done in
            let monitor = NWPathMonitor()
            let once = Once()
            monitor.pathUpdateHandler = { path in
                guard once.first() else { return }
                monitor.cancel()
                done.resume(returning: path.status == .satisfied && !path.isExpensive && !path.isConstrained)
            }
            monitor.start(queue: DispatchQueue(label: "ch.opengym.app.anim-packs.path"))
        }
    }
}

/// True the first time only: the path monitor may answer more than once, the continuation once.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func first() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}

/**
 * Serves opengym-pack://<packId>/<drawing>.webp to the web view from the downloaded asset pack,
 * read through AssetPackManager (memory-mapped) off the main thread. Only the app's pack ids and
 * plain drawing names; anything else is a 404. Registered on the web view's configuration by
 * MainViewController.
 */
final class AnimationPackSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "opengym-pack"
    private static let filePattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,64}\\.webp$")
    private let queue = DispatchQueue(label: "ch.opengym.app.anim-pack-files", qos: .userInitiated, attributes: .concurrent)
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let id = url.host,
              AnimationPacksPlugin.matches(AnimationPacksPlugin.packPattern, id) else { return fail(task, 404) }
        let file = url.lastPathComponent
        guard url.pathComponents.count == 2, AnimationPacksPlugin.matches(AnimationPackSchemeHandler.filePattern, file) else { return fail(task, 404) }
        let key = ObjectIdentifier(task)
        queue.async {
            var data: Data?
            #if canImport(BackgroundAssets)
            if #available(iOS 26.0, *) {
                data = try? AssetPackManager.shared.contents(at: FilePath("\(id)/\(file)"), searchingInAssetPackWithID: id, options: .mappedIfSafe)
            }
            #endif
            DispatchQueue.main.async {
                guard self.take(key) else { return }
                guard let data = data else { return self.fail(task, 404) }
                let headers = [
                    "Content-Type": "image/webp",
                    "Content-Length": String(data.count),
                    "Cache-Control": "max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*",
                ]
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); stopped.insert(ObjectIdentifier(task)); lock.unlock()
    }

    /// False once WebKit stopped the task: answering it then would throw.
    private func take(_ key: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped.remove(key) == nil
    }

    private func fail(_ task: WKURLSchemeTask, _ code: Int) {
        guard let url = task.request.url else { return }
        task.didReceive(HTTPURLResponse(url: url, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Access-Control-Allow-Origin": "*"])!)
        task.didFinish()
    }
}
