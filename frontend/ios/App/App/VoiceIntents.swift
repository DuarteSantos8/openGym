import AppIntents
import Capacitor
import Foundation
import UIKit

/*
 * Siri, the Shortcuts app and Spotlight (v1.4.4, lib/voice.js). Four App Shortcuts, iOS 16 and up:
 *
 *   Start my workout     opens the app at opengym://start?today=1: today's plan through the same
 *                        path as the widget's Start, or the workout already running (never a second).
 *   Log my weight        asks for the number, in the profile's unit, and leaves it in the App Group
 *                        without opening the app. The page brings it in when it next starts or comes
 *                        back (VoiceBridge below, lib/voice.js importPendingWeighIns), once.
 *   What's my workout today / How's my streak   answered from the widget snapshot (widget.json,
 *                        lib/widgets.js), without opening the app.
 *
 * The words: <lang>.lproj/Localizable.strings and AppShortcuts.strings beside this file, written
 * by ios/ci/voice-strings.mjs. The names in the answers (a routine's, a weekday's) come from the
 * snapshot, in the app's language.
 */

// MARK: - pending weigh-ins (the App Group)

/// Weigh-ins Siri logged that the page has not brought in yet. Plain JSON in the App Group's
/// defaults: [{ id, w, unit, at (ms), d (the local day then) }].
enum VoicePending {
    static let key = "voice.pendingWeighIns"
    private static let lock = NSLock()
    // A queue the app never drained keeps its newest weigh-ins, not every one ever said.
    static let max = 60

    static func all() -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return read()
    }

    @discardableResult
    static func add(w: Double, unit: String, at: Date = Date()) -> String {
        let id = UUID().uuidString
        let item: [String: Any] = [
            "id": id, "w": w, "unit": unit,
            "at": (at.timeIntervalSince1970 * 1000).rounded(),
            "d": VoiceSnapshot.isoDay(at),
        ]
        lock.lock(); defer { lock.unlock() }
        var list = read()
        list.append(item)
        if list.count > max { list.removeFirst(list.count - max) }
        write(list)
        return id
    }

    static func remove(ids: Set<String>) {
        lock.lock(); defer { lock.unlock() }
        write(read().filter { !ids.contains(($0["id"] as? String) ?? "") })
    }

    private static func read() -> [[String: Any]] {
        guard let data = OpenGymGroup.defaults.data(forKey: key),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return list
    }

    private static func write(_ list: [[String: Any]]) {
        if let data = try? JSONSerialization.data(withJSONObject: list) {
            OpenGymGroup.defaults.set(data, forKey: key)
        }
    }
}

/// The page's side: what is pending, and forgetting what it brought in (lib/voice.js).
@objc(VoiceBridgePlugin)
public class VoiceBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VoiceBridgePlugin"
    public let jsName = "VoiceBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    @objc func pending(_ call: CAPPluginCall) {
        call.resolve(["items": VoicePending.all()])
    }

    @objc func clear(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        VoicePending.remove(ids: Set(ids))
        call.resolve()
    }
}

// MARK: - the widget snapshot, as far as the answers need it

/// The part of widget.json (lib/widgets.js buildWidgetSnapshot) Siri answers from. Its own small
/// copy: the widgets' WidgetSnapshot is iOS 17 only, these run from iOS 16.
struct VoiceSnapshot: Decodable {
    struct Day: Decodable { var iso: String; var weekday: String?; var name: String?; var done: Bool? }
    struct Active: Decodable { var name: String? }
    struct Streak: Decodable { var current: Int?; var best: Int?; var weekDone: Bool? }

    var today: String
    var weekUntil: String?
    var unit: String?
    var days: [Day]
    var active: Active?
    var streak: Int?
    var streakInfo: Streak?

    static func load() -> VoiceSnapshot? {
        guard let url = OpenGymGroup.container?.appendingPathComponent(WidgetBridgePlugin.fileName),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(VoiceSnapshot.self, from: data)
    }

    static func isoDay(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    var weightUnit: String { unit == "lb" ? "lb" : "kg" }
}

/// What Siri says, in the phone's language (<lang>.lproj/Localizable.strings).
enum VoiceWords {
    static func say(_ key: String, _ args: CVarArg...) -> String {
        let format = NSLocalizedString(key, comment: "")
        return args.isEmpty ? format : String(format: format, locale: Locale.current, arguments: args)
    }

    static func weight(_ w: Double, _ unit: String) -> String {
        let f = NumberFormatter()
        f.locale = Locale.current
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 1
        return "\(f.string(from: NSNumber(value: w)) ?? String(w)) \(unit)"
    }

    /// What is on today, from the snapshot as of `now`.
    static func today(_ snap: VoiceSnapshot?, now: Date = Date()) -> String {
        let iso = VoiceSnapshot.isoDay(now)
        guard let snap = snap, let day = snap.days.first(where: { $0.iso == iso }) else {
            return say("Open openGym once, then ask me again.")
        }
        if snap.today == iso, let active = snap.active {
            if let name = active.name, !name.isEmpty { return say("You’re in the middle of %@.", name) }
            return say("You’re in the middle of a workout.")
        }
        if let name = day.name {
            let shown = name.isEmpty ? say("Your workout") : name
            if snap.today == iso, day.done == true { return say("%@ is done for today. Nice work.", shown) }
            return say("Today: %@.", shown)
        }
        if let next = snap.days.first(where: { $0.iso > iso && $0.name != nil }) {
            let shown = (next.name ?? "").isEmpty ? say("Your workout") : next.name!
            return say("Rest day today. Next up: %@ on %@.", shown, next.weekday ?? next.iso)
        }
        return say("Nothing planned today.")
    }

    /// The week streak, from the snapshot as of `now`.
    static func streak(_ snap: VoiceSnapshot?, now: Date = Date()) -> String {
        guard let snap = snap else { return say("Open openGym once, then ask me again.") }
        let iso = VoiceSnapshot.isoDay(now)
        let n = snap.streakInfo?.current ?? snap.streak ?? 0
        // A snapshot from an earlier week says nothing about this one.
        var weekDone = snap.streakInfo?.weekDone ?? false
        if let until = snap.weekUntil, iso >= until { weekDone = false }
        if n <= 0 { return say("No streak yet. One workout this week starts one.") }
        return weekDone
            ? say("Week streak: %d. This week already counts.", n)
            : say("Week streak: %d. One workout this week keeps it going.", n)
    }
}

// MARK: - the intents

@available(iOS 16.0, *)
struct StartWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Start workout"
    static let description = IntentDescription("Starts today’s planned workout, or opens the one already running.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // The widget's Start, with today's plan as the app has it: a running workout wins there
        // (lib/widget-links.js). Handed on as any opengym:// link is, so a cold start finds it as
        // the launch URL and a running app gets appUrlOpen.
        if let url = URL(string: "opengym://start?today=1") {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        return .result()
    }
}

@available(iOS 16.0, *)
struct LogWeightIntent: AppIntent {
    static let title: LocalizedStringResource = "Log weight"
    static let description = IntentDescription("Logs your body weight without opening openGym.")
    static let openAppWhenRun = false

    @Parameter(title: "Weight", requestValueDialog: IntentDialog("What’s your weight?"))
    var weight: Double

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // The unit is the profile's, as the app last wrote it; before that there is none to go by.
        guard let snap = VoiceSnapshot.load() else {
            return .result(dialog: IntentDialog(stringLiteral: VoiceWords.say("Open openGym once, then ask me again.")))
        }
        let unit = snap.weightUnit
        let w = (weight * 10).rounded() / 10
        let range: ClosedRange<Double> = unit == "lb" ? 44...1500 : 20...700
        guard w.isFinite, range.contains(w) else {
            return .result(dialog: IntentDialog(stringLiteral: VoiceWords.say("That doesn’t sound like a weight. Try again?")))
        }
        VoicePending.add(w: w, unit: unit)
        return .result(dialog: IntentDialog(stringLiteral: VoiceWords.say("Logged %@.", VoiceWords.weight(w, unit))))
    }
}

@available(iOS 16.0, *)
struct TodayWorkoutIntent: AppIntent {
    static let title: LocalizedStringResource = "Today’s workout"
    static let description = IntentDescription("Tells you what’s planned for today.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: VoiceWords.today(VoiceSnapshot.load())))
    }
}

@available(iOS 16.0, *)
struct StreakIntent: AppIntent {
    static let title: LocalizedStringResource = "Week streak"
    static let description = IntentDescription("Tells you how many weeks in a row you trained.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: VoiceWords.streak(VoiceSnapshot.load())))
    }
}

/// What Siri, Spotlight and the Shortcuts app offer without any setup. The phrases in other
/// languages: <lang>.lproj/AppShortcuts.strings (ios/ci/voice-strings.mjs).
@available(iOS 16.0, *)
struct OpenGymShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartWorkoutIntent(), phrases: [
            "Start my workout in \(.applicationName)",
            "Start a workout with \(.applicationName)",
        ])
        AppShortcut(intent: LogWeightIntent(), phrases: [
            "Log my weight in \(.applicationName)",
            "Log a weigh-in in \(.applicationName)",
        ])
        AppShortcut(intent: TodayWorkoutIntent(), phrases: [
            "What's my workout today in \(.applicationName)",
            "What's planned today in \(.applicationName)",
        ])
        AppShortcut(intent: StreakIntent(), phrases: [
            "How's my streak in \(.applicationName)",
            "What's my \(.applicationName) streak",
        ])
    }
}
