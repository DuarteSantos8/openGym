import Foundation
import UIKit
#if canImport(ConnectIQ)
import ConnectIQ
#endif

/**
 * The iPhone's end of the Garmin link (docs/GARMIN.md, watch app in frontend/garmin): Garmin's
 * Connect IQ Mobile SDK. The Android twin is android/app/src/ciq/.../GarminLink.java; the page sees
 * both through WatchBridge (status `garmin`, sendSnapshot's `garmin`, the same queue file).
 *
 * On the iPhone the SDK talks to the watch itself over Bluetooth, but only to the watches the user
 * picked in Garmin Connect Mobile: `pick()` hands over to Garmin Connect (showDeviceSelection), which
 * comes back with them through the `opengym-ciq` URL scheme (Info.plist; SceneDelegate and
 * AppDelegate hand the URL here). They are kept on disk, so it is asked once.
 *
 * The SDK starts only once a Garmin was picked: it opens Bluetooth, and iOS then asks for it. An
 * iPhone without a Garmin never sees that question.
 *
 * Built with the SDK only when the Swift package is in the project (ios/ci/add-garmin.rb, which
 * CI and the release build run): without it, `canImport(ConnectIQ)` is false, this compiles to
 * "no Garmin" and Settings → Garmin says so.
 */
final class GarminLink: NSObject {
    static let shared = GarminLink()
    /// Garmin Connect Mobile comes back to the app with the picked watches through this scheme.
    static let urlScheme = "opengym-ciq"
    /// The watch app's id (frontend/garmin/manifest.xml).
    static let appId = UUID(uuidString: "3c533c63-754d-4018-9c00-0ad529e400b9")!
    /// The app's id in the Connect IQ Store (apps.garmin.com/apps/<id>, submitted 2026-11-09; docs/GARMIN.md).
    static let storeId: UUID? = UUID(uuidString: "62e66310-66de-4bdd-8e40-5d2c0d853a08")

    #if canImport(ConnectIQ)
    static let built = true
    private var started = false
    private var devices: [IQDevice] = []
    private var installed: [UUID: Bool] = [:]
    private var registered: Set<UUID> = []
    private var lastSnapshot: [String: Any]?
    /// Garmin Connect Mobile said it is missing (needsToInstallConnectMobile): Settings → Garmin says so.
    private var noConnect = false
    #else
    static let built = false
    #endif

    /// The SDK and this link's state live on the main thread (the SDK calls back there).
    static func onMain<T>(_ body: () -> T) -> T {
        Thread.isMainThread ? body() : DispatchQueue.main.sync(execute: body)
    }

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("garmin-devices.plist")
    }

    /// At launch: the SDK comes up when a Garmin was picked before (else it waits for `pick`).
    func start() {
        #if canImport(ConnectIQ)
        let saved = loadDevices()
        guard !saved.isEmpty else { return }
        startSDK()
        use(saved)
        #endif
    }

    /// Settings → Garmin → Choose watches: Garmin Connect Mobile opens with its list.
    func pick() -> Bool {
        #if canImport(ConnectIQ)
        startSDK()
        noConnect = false
        guard let ciq = ConnectIQ.sharedInstance() else { return false }
        DispatchQueue.main.async { ciq.showDeviceSelection() }
        return true
        #else
        return false
        #endif
    }

    /// Garmin Connect's answer to `pick`. Whether the URL was Garmin's.
    func handle(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == GarminLink.urlScheme else { return false }
        #if canImport(ConnectIQ)
        startSDK()
        noConnect = false
        let picked = (ConnectIQ.sharedInstance()?.parseDeviceSelectionResponse(from: url) as? [IQDevice]) ?? []
        // Always the latest list only (Garmin's guide): the ones not picked again are let go of.
        saveDevices(picked)
        use(picked)
        #endif
        return true
    }

    func status() -> [String: Any] {
        #if canImport(ConnectIQ)
        let list: [[String: Any]] = devices.map { d in
            var o: [String: Any] = ["id": d.uuid.uuidString, "name": d.friendlyName ?? d.modelName ?? "Garmin", "connected": connected(d)]
            if let inst = installed[d.uuid] { o["installed"] = inst }
            return o
        }
        return ["supported": true, "state": noConnect ? "no-gcm" : started ? "ready" : "idle", "installed": anyInstalled(), "reachable": anyReachable(),
                "store": GarminLink.storeId != nil, "devices": list, "picker": true]
        #else
        return ["supported": false, "state": "build", "installed": false, "reachable": false, "store": false, "devices": [], "picker": false]
        #endif
    }

    func anyInstalled() -> Bool {
        #if canImport(ConnectIQ)
        return installed.values.contains(true)
        #else
        return false
        #endif
    }

    func anyReachable() -> Bool {
        #if canImport(ConnectIQ)
        return devices.contains { connected($0) && installed[$0.uuid] == true }
        #else
        return false
        #endif
    }

    /// The page's Garmin snapshot (lib/garmin-snapshot.js) to every connected Garmin with the app.
    func send(_ json: String) -> Bool {
        #if canImport(ConnectIQ)
        guard let data = json.data(using: .utf8),
              let snap = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        let clean = GarminLink.monkey(snap) as? [String: Any] ?? [:]
        lastSnapshot = clean
        var any = false
        for d in devices where connected(d) && installed[d.uuid] != false {
            sendTo(d, clean)
            any = true
        }
        return any
        #else
        return false
        #endif
    }

    /// A workout started on the phone: each connected Garmin with the app asks "open openGym?".
    func open() -> Bool {
        #if canImport(ConnectIQ)
        guard started, let ciq = ConnectIQ.sharedInstance() else { return false }
        var any = false
        for d in devices where connected(d) && installed[d.uuid] == true {
            ciq.openAppRequest(app(for: d)) { _ in }
            any = true
        }
        return any
        #else
        return false
        #endif
    }

    /// The openGym page in the Connect IQ Store, once it is published there.
    func openStore() -> Bool {
        #if canImport(ConnectIQ)
        guard started, GarminLink.storeId != nil, let d = devices.first, let ciq = ConnectIQ.sharedInstance() else { return false }
        ciq.showStore(for: app(for: d))
        return true
        #else
        return false
        #endif
    }

    /// The snapshot as Connect IQ carries it: no nulls (a missing key reads as null on the watch).
    static func monkey(_ v: Any) -> Any? {
        if v is NSNull { return nil }
        if let d = v as? [String: Any] {
            var out: [String: Any] = [:]
            for (k, x) in d { if let y = monkey(x) { out[k] = y } }
            return out
        }
        if let a = v as? [Any] { return a.compactMap { monkey($0) } }
        return v
    }

    /// The watch's events as JSON, as the other watches send them; hello is for the bridge only.
    static func events(in message: Any) -> (events: [String], hello: Bool) {
        guard let dict = message as? [String: Any], let list = dict["events"] as? [Any] else { return ([], false) }
        var out: [String] = [], hello = false
        for case let ev as [String: Any] in list {
            guard let id = ev["id"] as? String, !id.isEmpty else { continue }
            if (ev["type"] as? String) == "hello" { hello = true; continue }
            if JSONSerialization.isValidJSONObject(ev), let data = try? JSONSerialization.data(withJSONObject: ev),
               let s = String(data: data, encoding: .utf8) { out.append(s) }
        }
        return (out, hello)
    }
}

#if canImport(ConnectIQ)
extension GarminLink: IQDeviceEventDelegate, IQAppMessageDelegate, IQUIOverrideDelegate {
    private func startSDK() {
        guard !started else { return }
        started = true
        ConnectIQ.sharedInstance()?.initialize(withUrlScheme: GarminLink.urlScheme, uiOverrideDelegate: self,
                                               stateRestorationIdentifier: "ch.opengym.app.garmin")
    }

    private func app(for d: IQDevice) -> IQApp {
        IQApp(uuid: GarminLink.appId, store: GarminLink.storeId ?? GarminLink.appId, device: d)
    }

    private func connected(_ d: IQDevice) -> Bool {
        ConnectIQ.sharedInstance()?.getDeviceStatus(d) == .connected
    }

    private func use(_ list: [IQDevice]) {
        guard let ciq = ConnectIQ.sharedInstance() else { return }
        devices = list
        installed = installed.filter { k, _ in list.contains { $0.uuid == k } }
        for d in list {
            // Once per watch: one no longer picked stays registered until the app restarts, but
            // gets nothing (it is not in `devices`) and what it sends is not asked for.
            if !registered.contains(d.uuid) {
                ciq.register(forDeviceEvents: d, delegate: self)
                ciq.register(forAppMessages: app(for: d), delegate: self)
                registered.insert(d.uuid)
            }
            askInstalled(d)
        }
        WatchLink.shared.tell("watchState", [:])
    }

    private func askInstalled(_ d: IQDevice) {
        ConnectIQ.sharedInstance()?.getAppStatus(app(for: d)) { [weak self] st in
            guard let self else { return }
            let now = st?.isInstalled == true
            if self.installed[d.uuid] != now {
                self.installed[d.uuid] = now
                WatchLink.shared.tell("watchState", [:])
            }
            if now { self.sendTo(d, self.lastSnapshot) }
        }
    }

    private func sendTo(_ d: IQDevice, _ snap: [String: Any]?) {
        guard let snap, let ciq = ConnectIQ.sharedInstance() else { return }
        ciq.sendMessage(snap, to: app(for: d), progress: { _, _ in }, completion: { _ in
            // Not delivered: the next connect or hello sends the latest again.
        })
    }

    func deviceStatusChanged(_ device: IQDevice, status: IQDeviceStatus) {
        if status == .connected { askInstalled(device) }
        WatchLink.shared.tell("watchState", [:])
    }

    func receivedMessage(_ message: Any, from app: IQApp) {
        let (events, hello) = GarminLink.events(in: message)
        // A set logged on the watch counts whichever watch it came from; the rest only for a picked one.
        if let d = app.device, devices.contains(where: { $0.uuid == d.uuid }) {
            if installed[d.uuid] != true { installed[d.uuid] = true; WatchLink.shared.tell("watchState", [:]) }
            if hello { sendTo(d, lastSnapshot) }
        }
        let got = events.compactMap { WatchLink.shared.store($0) }
        if !got.isEmpty { WatchLink.shared.tell("watchEvent", [:]) }
    }

    /// Garmin Connect Mobile is not on this iPhone: Settings → Garmin says so (no alert of the SDK's).
    func needsToInstallConnectMobile() {
        noConnect = true
        WatchLink.shared.tell("watchState", ["garminConnect": false])
    }

    private func loadDevices() -> [IQDevice] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? NSKeyedUnarchiver.unarchivedArrayOfObjects(ofClass: IQDevice.self, from: data)) ?? []
    }

    private func saveDevices(_ list: [IQDevice]) {
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: list, requiringSecureCoding: true) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }
}
#endif
