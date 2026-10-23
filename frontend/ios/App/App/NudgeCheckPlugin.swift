import Foundation
import Capacitor
import BackgroundTasks
import Security
import UserNotifications

/**
 * The background check before a missed-day nudge or a workout-day reminder the app scheduled on
 * the phone (frontend lib/nudge-check.js). The page hands over the paired server, the headers a
 * request to it carries and the days something is scheduled for; a BGAppRefreshTask then asks
 * GET /api/nudge-check about the next of those days and takes back the notifications a workout or
 * a day note on another device made pointless. Offline, an error, an answer it cannot read:
 * nothing changes. iOS decides when the task actually runs, so this is a good chance of catching
 * it, never a promise (docs/MOBILE.md).
 *
 * Usage from JS:
 *   const NudgeCheck = registerPlugin('NudgeCheck');
 *   await NudgeCheck.arm({ server, headers, entries: [{ date, at, reminder: [ids], nudge: [ids] }] });
 *   await NudgeCheck.disarm();
 *
 * The headers carry the pairing token, so the whole configuration lives in the Keychain (this
 * device only, readable after the first unlock, which a background task needs), not in a file.
 */
@objc(NudgeCheckPlugin)
public class NudgeCheckPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NudgeCheckPlugin"
    public let jsName = "NudgeCheck"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "arm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disarm", returnType: CAPPluginReturnPromise),
    ]

    /// Also in Info.plist (BGTaskSchedulerPermittedIdentifiers).
    static let taskId = "ch.opengym.app.nudge-check"
    private static let account = "nudge-check"

    @objc func arm(_ call: CAPPluginCall) {
        guard let server = call.getString("server"), !server.isEmpty else {
            call.reject("server is required")
            return
        }
        let config: [String: Any] = [
            "server": server,
            "headers": call.getObject("headers") ?? [:],
            "entries": call.getArray("entries") ?? [],
        ]
        guard NudgeCheckPlugin.save(config) else {
            call.reject("could not keep the check")
            return
        }
        NudgeCheckPlugin.schedule(config)
        call.resolve()
    }

    @objc func disarm(_ call: CAPPluginCall) {
        NudgeCheckPlugin.clear()
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: NudgeCheckPlugin.taskId)
        call.resolve()
    }

    // MARK: the task

    /// From AppDelegate, before launching ends: iOS only hands a task to a handler registered then.
    static func registerTask() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskId, using: nil) { task in
            guard let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
            run(refresh)
        }
    }

    /// The days still ahead, soonest first.
    private static func upcoming(_ config: [String: Any], now: Date = Date()) -> [[String: Any]] {
        let entries = config["entries"] as? [[String: Any]] ?? []
        return entries
            .filter { ($0["at"] as? Double ?? 0) / 1000 > now.timeIntervalSince1970 }
            .sorted { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }
    }

    /// Asks for a run some time before the next day's first notification: an hour ahead, or a
    /// quarter of an hour from now when that is already past. iOS picks the moment itself.
    static func schedule(_ config: [String: Any]) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId)
        guard let next = upcoming(config).first, let at = next["at"] as? Double else { return }
        let fires = Date(timeIntervalSince1970: at / 1000)
        let request = BGAppRefreshTaskRequest(identifier: taskId)
        request.earliestBeginDate = max(fires.addingTimeInterval(-3600), Date().addingTimeInterval(15 * 60))
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func run(_ task: BGAppRefreshTask) {
        guard var config = load(), let server = config["server"] as? String else {
            task.setTaskCompleted(success: true)
            return
        }
        // The days whose notifications fire within the next twelve hours: what a check now can still save.
        let soon = upcoming(config).filter { (($0["at"] as? Double ?? 0) / 1000) - Date().timeIntervalSince1970 < 12 * 3600 }
        let headers = config["headers"] as? [String: String] ?? [:]
        let group = DispatchGroup()
        var tasks: [URLSessionDataTask] = []
        var settled: Set<String> = []
        let lock = NSLock()
        for entry in soon {
            guard let date = entry["date"] as? String,
                  var parts = URLComponents(string: server + "/api/nudge-check") else { continue }
            parts.queryItems = [URLQueryItem(name: "date", value: date)]
            guard let url = parts.url else { continue }
            var request = URLRequest(url: url, timeoutInterval: 20)
            for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
            group.enter()
            let t = URLSession.shared.dataTask(with: request) { data, response, _ in
                defer { group.leave() }
                guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                      let answer = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
                let ids = idsToCancel(entry, answer)
                if !ids.isEmpty {
                    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ids.map { String($0) })
                }
                if answer["done"] as? Bool == true { lock.lock(); settled.insert(date); lock.unlock() }
            }
            tasks.append(t)
            t.resume()
        }
        task.expirationHandler = { tasks.forEach { $0.cancel() } }
        group.notify(queue: .main) {
            // A day settled is not checked again; the rest is asked about again closer to its time.
            let left = upcoming(config).filter { !settled.contains($0["date"] as? String ?? "") }
            config["entries"] = left
            _ = save(config)
            if let next = left.first, let at = next["at"] as? Double {
                let fires = Date(timeIntervalSince1970: at / 1000)
                BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: taskId)
                let request = BGAppRefreshTaskRequest(identifier: taskId)
                // Still well ahead of it: once more, half an hour before. Otherwise the usual hour.
                let again = fires.timeIntervalSinceNow > 45 * 60 ? fires.addingTimeInterval(-30 * 60) : fires.addingTimeInterval(-3600)
                request.earliestBeginDate = max(again, Date().addingTimeInterval(15 * 60))
                try? BGTaskScheduler.shared.submit(request)
            }
            task.setTaskCompleted(success: true)
        }
    }

    /// The rule lib/nudge-check.js idsToCancel spells out: a day trained or excused takes its
    /// reminder and its nudge, a day the server would not nudge takes the nudge, anything else
    /// (another day's answer included) takes nothing.
    static func idsToCancel(_ entry: [String: Any], _ answer: [String: Any]) -> [Int] {
        guard let date = entry["date"] as? String, answer["date"] as? String == date else { return [] }
        let reminder = (entry["reminder"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue }
        let nudge = (entry["nudge"] as? [Any] ?? []).compactMap { ($0 as? NSNumber)?.intValue }
        if answer["done"] as? Bool == true { return reminder + nudge }
        if answer["nudge"] as? Bool == false { return nudge }
        return []
    }

    // MARK: Keychain

    private static func query() -> [String: Any] {
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Bundle.main.bundleIdentifier ?? "ch.opengym.app",
                kSecAttrAccount as String: account]
    }

    static func save(_ config: [String: Any]) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: config) else { return false }
        SecItemDelete(query() as CFDictionary)
        var add = query()
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> [String: Any]? {
        var q = query()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func clear() {
        SecItemDelete(query() as CFDictionary)
    }
}
