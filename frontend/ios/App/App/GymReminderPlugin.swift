import Foundation
import Capacitor
import CoreLocation
import UIKit
import UserNotifications

/**
 * The gym reminder (#614): a notification when the iPhone arrives at one of the user's gyms
 * (frontend lib/gym-reminder.js has the page's side and the rules in words).
 *
 * iOS watches the gyms itself with region monitoring (at most 20 regions per app), with openGym
 * closed and at hardly any battery cost: on arriving it launches the app in the background and
 * hands GymReminderCenter the region, which decides with GymReminderRules whether to post and
 * posts a local notification. That needs "Always" location; no background location mode
 * (UIBackgroundModes location) is needed or declared, region monitoring works without it.
 *
 * The page's status (last day trained, a running session, the words in the app's language) is
 * kept beside the gyms, so the decision needs no JavaScript. All of it lives in one file in
 * Application Support that is excluded from iCloud/iTunes backups: the places never leave the
 * phone, and never go to the user's server either.
 *
 * Usage from JS:
 *   const GR = registerPlugin('GymReminder');
 *   await GR.configure({ config });   // { watching, permission }
 *   await GR.status({ trainedOn, quietOn, activeSince, title, body });
 *   await GR.server({ server, headers }); // the paired server, asked about today before posting ('' forgets it)
 *   await GR.get();                   // { config, permission, watching }
 *   await GR.permission();            // { location, background, precise, notifications }
 *   await GR.requestForeground();     // While Using the App
 *   await GR.requestBackground();     // Always, after the in-app explainer
 *   await GR.currentPosition();       // { lat, lng, accuracy }
 *   await GR.openSettings();
 * Before posting, a paired phone asks its server whether today was trained on another device that
 * has not synced here yet (GET /api/nudge-check, at most 3 seconds). The server and its headers
 * (the pairing token) are kept in the Keychain, this device only. No server, offline, or no
 * answer in time: the phone's own status decides.
 * A tap on the notification goes through Capacitor's local-notifications handler (the page
 * listens there for id 3000).
 */
@objc(GymReminderPlugin)
public class GymReminderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GymReminderPlugin"
    public let jsName = "GymReminder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "server", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestForeground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    private var center: GymReminderCenter { GymReminderCenter.shared }

    @objc func configure(_ call: CAPPluginCall) {
        guard let config = call.getObject("config") else { call.reject("config is required"); return }
        DispatchQueue.main.async {
            self.center.saveConfig(config as [String: Any])
            let n = self.center.register(force: true)
            self.center.permissions { p in call.resolve(["watching": n, "permission": p]) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        let status: [String: Any] = [
            "trainedOn": call.getString("trainedOn") ?? "",
            "quietOn": call.getString("quietOn") ?? "",
            "activeSince": call.getDouble("activeSince") ?? 0,
            "title": call.getString("title") ?? "",
            "body": call.getString("body") ?? "",
        ]
        DispatchQueue.main.async {
            self.center.saveStatus(status)
            call.resolve()
        }
    }

    @objc func server(_ call: CAPPluginCall) {
        let server = call.getString("server") ?? ""
        if server.isEmpty {
            GymReminderCenter.clearServer()
        } else {
            _ = GymReminderCenter.saveServer(["server": server, "headers": call.getObject("headers") ?? [:]])
        }
        call.resolve()
    }

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Regions lost while the app could not watch (Always taken back and given again):
            // the page opening the settings is a good moment to arm them again.
            self.center.register(force: false)
            let config = self.center.config
            let n = self.center.watching()
            self.center.permissions { p in
                var r: [String: Any] = ["permission": p, "watching": n]
                if let c = config { r["config"] = c }
                call.resolve(r)
            }
        }
    }

    @objc func permission(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.center.permissions { call.resolve($0) } }
    }

    @objc func requestForeground(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.center.askWhenInUse {
                self.center.permissions { call.resolve($0) }
            }
        }
    }

    @objc func requestBackground(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.center.askAlways {
                self.center.register(force: false)
                self.center.permissions { call.resolve($0) }
            }
        }
    }

    @objc func currentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.center.locate { loc in
                guard let loc = loc else { call.reject("no fix"); return }
                call.resolve(["lat": loc.coordinate.latitude, "lng": loc.coordinate.longitude, "accuracy": loc.horizontalAccuracy])
            }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}

/// The location side, alive from launch on (AppDelegate): iOS relaunches the app in the
/// background for a region event and hands it to whichever CLLocationManager delegate exists then.
final class GymReminderCenter: NSObject, CLLocationManagerDelegate {
    static let shared = GymReminderCenter()
    static let notificationId = "3000"
    static let regionPrefix = "gym:"
    static let maxGyms = 20

    private let manager = CLLocationManager()
    private var authWaiters: [() -> Void] = []
    private var fixWaiters: [(CLLocation?) -> Void] = []
    private var promptShown = false
    private var store: [String: Any] = [:]

    private override init() {
        super.init()
        store = GymReminderCenter.readStore()
    }

    /// From AppDelegate, before launching ends: becomes the delegate, so a region event that
    /// relaunched the app is delivered here.
    func start() {
        manager.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(resignedActive), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: what is kept

    private static var fileURL: URL? {
        guard let dir = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true) else { return nil }
        return dir.appendingPathComponent("gym-reminder.json")
    }

    private static func readStore() -> [String: Any] {
        guard let url = fileURL, let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    private func writeStore() {
        guard var url = GymReminderCenter.fileURL,
              let data = try? JSONSerialization.data(withJSONObject: store) else { return }
        // Readable after the first unlock: a region event can wake the app while the phone is locked.
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    var config: [String: Any]? { store["config"] as? [String: Any] }
    var isOn: Bool { (config?["on"] as? Bool) == true }
    private var status: [String: Any] { store["status"] as? [String: Any] ?? [:] }

    func saveConfig(_ c: [String: Any]) { store["config"] = c; writeStore() }
    func saveStatus(_ s: [String: Any]) { store["status"] = s; writeStore() }

    // MARK: the paired server (Keychain: it carries the pairing token)

    private static func serverQuery() -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Bundle.main.bundleIdentifier ?? "ch.opengym.app",
                kSecAttrAccount as String: "gym-reminder-server"]
    }

    static func saveServer(_ auth: [String: Any]) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: auth) else { return false }
        SecItemDelete(serverQuery() as CFDictionary)
        var add = serverQuery()
        add[kSecValueData as String] = data
        // Readable after the first unlock: a region event can wake the app while the phone is locked.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func loadServer() -> [String: Any]? {
        var q = serverQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func clearServer() {
        SecItemDelete(serverQuery() as CFDictionary)
    }

    /// Whether the paired server says `today` was trained or excused. Calls back false without a
    /// server, offline, on any error and after 3 seconds, always on the main queue.
    func trainedElsewhere(today: String, _ done: @escaping (Bool) -> Void) {
        guard let auth = GymReminderCenter.loadServer(), var base = auth["server"] as? String, !base.isEmpty else { done(false); return }
        while base.hasSuffix("/") { base.removeLast() }
        guard var parts = URLComponents(string: base + "/api/nudge-check") else { done(false); return }
        parts.queryItems = [URLQueryItem(name: "date", value: today)]
        guard let url = parts.url else { done(false); return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (k, v) in auth["headers"] as? [String: String] ?? [:] { request.setValue(v, forHTTPHeaderField: k) }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3
        cfg.timeoutIntervalForResource = 3
        cfg.waitsForConnectivity = false
        let session = URLSession(configuration: cfg)
        var finished = false
        let finish: (Bool) -> Void = { v in
            DispatchQueue.main.async {
                if finished { return }
                finished = true
                session.invalidateAndCancel()
                done(v)
            }
        }
        session.dataTask(with: request) { data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                  let a = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { finish(false); return }
            finish((a["date"] as? String) == today && (a["done"] as? Bool) == true)
        }.resume()
        // The hard stop, whatever URLSession does with DNS or a half-open socket.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { finish(false) }
    }

    // MARK: permissions

    private var authorization: CLAuthorizationStatus { manager.authorizationStatus }

    func permissions(_ done: @escaping ([String: Any]) -> Void) {
        let a = authorization
        let precise = manager.accuracyAuthorization == .fullAccuracy
        let location: String = (a == .authorizedAlways || a == .authorizedWhenInUse) ? "granted" : (a == .denied || a == .restricted) ? "denied" : "prompt"
        let background: String = a == .authorizedAlways ? (precise ? "granted" : "denied")
            : (a == .denied || a == .restricted || (a == .authorizedWhenInUse && (store["askedAlways"] as? Bool) == true)) ? "denied" : "prompt"
        UNUserNotificationCenter.current().getNotificationSettings { s in
            let n: String = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional ? "granted" : s.authorizationStatus == .denied ? "denied" : "prompt"
            DispatchQueue.main.async {
                done(["location": location, "background": background, "precise": precise, "notifications": n])
            }
        }
    }

    func askWhenInUse(_ done: @escaping () -> Void) {
        guard authorization == .notDetermined else { done(); return }
        waitForAnswer(done)
        manager.requestWhenInUseAuthorization()
    }

    func askAlways(_ done: @escaping () -> Void) {
        let a = authorization
        guard a == .notDetermined || a == .authorizedWhenInUse else { done(); return }
        store["askedAlways"] = true
        writeStore()
        waitForAnswer(done)
        manager.requestAlwaysAuthorization()
    }

    /// iOS answers a request it shows by changing the authorization; one it does not show (asked
    /// before, or "Allow Once") changes nothing and calls back never. So: done on a change, when
    /// the app comes back after a prompt, or shortly after asking when no prompt took the screen.
    private func waitForAnswer(_ done: @escaping () -> Void) {
        authWaiters.append(done)
        promptShown = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, !self.promptShown else { return }
            self.flushAuth()
        }
    }

    private func flushAuth() {
        let w = authWaiters
        authWaiters.removeAll()
        w.forEach { $0() }
    }

    @objc private func resignedActive() { if !authWaiters.isEmpty { promptShown = true } }
    @objc private func becameActive() {
        if promptShown { promptShown = false; DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.flushAuth() } }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if authorization != .notDetermined { flushAuth() }
        // Always given (or taken back) in Settings: watch, or stop. Also runs once at launch,
        // where nothing changes when the right gyms are already watched.
        register(force: false)
    }

    // MARK: one fix

    func locate(_ done: @escaping (CLLocation?) -> Void) {
        let a = authorization
        guard a == .authorizedAlways || a == .authorizedWhenInUse else { done(nil); return }
        fixWaiters.append(done)
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.requestLocation()
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
            guard let self = self, !self.fixWaiters.isEmpty else { return }
            self.flushFix(self.manager.location)
        }
    }

    private func flushFix(_ loc: CLLocation?) {
        let w = fixWaiters
        fixWaiters.removeAll()
        w.forEach { $0(loc) }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let last = locations.last { flushFix(last) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if !fixWaiters.isEmpty { flushFix(manager.location) }
    }

    // MARK: watching

    func watching() -> Int {
        manager.monitoredRegions.filter { $0.identifier.hasPrefix(GymReminderCenter.regionPrefix) }.count
    }

    /// The regions the saved gyms ask for: none when off, without Always, or with approximate
    /// location (region monitoring needs precise location).
    private func wanted() -> [CLCircularRegion] {
        guard isOn, authorization == .authorizedAlways, manager.accuracyAuthorization == .fullAccuracy,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return [] }
        let gyms = (config?["gyms"] as? [[String: Any]]) ?? []
        var out: [CLCircularRegion] = []
        for g in gyms.prefix(GymReminderCenter.maxGyms) {
            guard let id = g["id"] as? String,
                  let lat = (g["lat"] as? NSNumber)?.doubleValue, let lng = (g["lng"] as? NSNumber)?.doubleValue else { continue }
            let radius = min(max((g["radius"] as? NSNumber)?.doubleValue ?? 100, 50), min(500, manager.maximumRegionMonitoringDistance))
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), radius: radius, identifier: GymReminderCenter.regionPrefix + id)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            out.append(region)
        }
        return out
    }

    /// Watches the saved gyms (or stops). `force` restarts every region (the page saved new gyms);
    /// otherwise nothing is touched when the right ones are already watched, so a launch or a
    /// permission check never re-arms a region the phone is standing in. Returns how many are watched.
    @discardableResult
    func register(force: Bool) -> Int {
        let want = wanted()
        let have = manager.monitoredRegions.filter { $0.identifier.hasPrefix(GymReminderCenter.regionPrefix) }
        let same = Set(have.compactMap { r -> String? in
            guard let c = r as? CLCircularRegion else { return nil }
            return "\(c.identifier)|\(c.center.latitude)|\(c.center.longitude)|\(c.radius)"
        }) == Set(want.map { "\($0.identifier)|\($0.center.latitude)|\($0.center.longitude)|\($0.radius)" })
        if same && !force { return have.count }
        for r in have { manager.stopMonitoring(for: r) }
        for r in want { manager.startMonitoring(for: r) }
        if !want.isEmpty { store["armedAt"] = Date().timeIntervalSince1970; writeStore() }
        return want.count
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(GymReminderCenter.regionPrefix) else { return }
        // A region added while the phone is already inside it may report an entry right away,
        // which would ping right after "I'm at the gym right now".
        let armedAt = (store["armedAt"] as? NSNumber)?.doubleValue ?? 0
        if Date().timeIntervalSince1970 - armedAt < 90 { return }
        let gymId = String(region.identifier.dropFirst(GymReminderCenter.regionPrefix.count))
        // A few seconds to write the notification, even when iOS woke the app just for this.
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "gym-reminder") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        arrive(gymId: gymId, now: Date()) {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }
    }

    func locationManager(_ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error) {
        // Nothing to do here but not crash: the settings page shows how many gyms are watched.
    }

    /// Applies the no-nag rule for arriving at `gymId` now, and posts if it says so.
    func arrive(gymId: String, now: Date, done: @escaping () -> Void) {
        let c = config ?? [:]
        let st = status
        let gyms = (c["gyms"] as? [[String: Any]]) ?? []
        let win = c["window"] as? [String: Any]
        let why = GymReminderRules.skipReason(
            on: (c["on"] as? Bool) == true, gyms: gyms.count,
            windowFrom: win?["from"] as? String, windowTo: win?["to"] as? String,
            trainedOn: st["trainedOn"] as? String ?? "", quietOn: st["quietOn"] as? String ?? "",
            activeSince: (st["activeSince"] as? NSNumber)?.doubleValue ?? 0,
            lastFired: store["lastFired"] as? String ?? "", now: now)
        guard why == nil else { done(); return }
        let today = GymReminderRules.isoOf(now)
        trainedElsewhere(today: today) { [weak self] elsewhere in
            guard let self = self else { done(); return }
            if elsewhere {
                // Remember it, so the next region event today needs no network.
                var s = self.status
                s["trainedOn"] = today
                self.saveStatus(s)
                done()
                return
            }
            self.post(gymId: gymId, gyms: gyms, now: now, done: done)
        }
    }

    private func post(gymId: String, gyms: [[String: Any]], now: Date, done: @escaping () -> Void) {
        let st = status
        let gym = gyms.first { ($0["id"] as? String) == gymId }
        let own = ((gym?["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let content = UNMutableNotificationContent()
        let title = st["title"] as? String ?? ""
        let body = st["body"] as? String ?? ""
        content.title = title.isEmpty ? "Gym spotted" : title
        content.body = !own.isEmpty ? own : (body.isEmpty ? "Ready for your workout? 💪" : body)
        content.sound = .default
        // How Capacitor's local-notifications handler hands `extra` to the page on a tap.
        content.userInfo = ["cap_extra": ["gymReminder": true]]
        let request = UNNotificationRequest(identifier: GymReminderCenter.notificationId, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { [weak self] error in
            DispatchQueue.main.async {
                if error == nil, let self = self {
                    self.store["lastFired"] = GymReminderRules.isoOf(now)
                    self.writeStore()
                }
                done()
            }
        }
    }
}
