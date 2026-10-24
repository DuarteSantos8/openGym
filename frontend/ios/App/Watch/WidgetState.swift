import Foundation
import SwiftUI

/*
 * What the watch app shows, for its complications and the Smart Stack widget (ios/App/Watch/
 * Widgets): written by the app whenever it changes, read by the widget through the App Group.
 * Compiled into both. Plain text and numbers, no media.
 *
 *   rest   the rest running, until restEndsAt
 *   set    the set up next: exercise and weight × reps
 *   today  no workout running, today's planned one ready to start
 *   idle   nothing to show but the app
 */
struct WidgetState: Codable, Equatable {
    var mode: String
    var title: String
    var detail: String
    var restEndsAt: Date?
    /// Work sets done and in all, today's session (the complications' ring).
    var done: Int = 0
    var total: Int = 0
    /// "2/4": the set up next, of its exercise's work sets.
    var setLabel: String = ""
    var updatedAt: Date = .distantPast
    /// The app's language (the phone's), so the complications speak it too.
    var lang: String?

    static let idle = WidgetState(mode: "idle", title: "openGym", detail: "", restEndsAt: nil)
    static let groupId = "group.ch.opengym.app"
    private static let key = "widgetState"

    static func == (a: WidgetState, b: WidgetState) -> Bool {
        a.mode == b.mode && a.title == b.title && a.detail == b.detail && a.restEndsAt == b.restEndsAt
            && a.done == b.done && a.total == b.total && a.setLabel == b.setLabel && a.lang == b.lang
    }

    /// The state as written, unless it is about a session the watch app has not touched for 45
    /// minutes (it was closed, or the workout runs on the phone alone): then nothing to show, and
    /// the iPhone's Live Activity has the Smart Stack to itself instead of two cards saying the same.
    static func read() -> WidgetState {
        guard let d = UserDefaults(suiteName: groupId)?.data(forKey: key),
              let s = try? JSONDecoder().decode(WidgetState.self, from: d) else { return .idle }
        if (s.mode == "set" || s.mode == "rest") && Date().timeIntervalSince(s.updatedAt) > 45 * 60 { return .idle }
        return s
    }

    func write() {
        var s = self
        s.updatedAt = Date()
        if let d = try? JSONEncoder().encode(s) { UserDefaults(suiteName: WidgetState.groupId)?.set(d, forKey: WidgetState.key) }
    }
}

extension WidgetState {
    /// The locale for the widget's words: the app's language where this bundle has it, else English
    /// (a phone in English never gets a German complication from a watch set to German).
    var locale: Locale {
        guard let l = lang else { return .current }
        if l == "en" { return Locale(identifier: "en") }
        let name = ["pt": "pt-PT", "zh": "zh-Hans", "zh-TW": "zh-Hant"][l] ?? l
        return Locale(identifier: Bundle.main.path(forResource: name, ofType: "lproj") != nil ? name : "en")
    }
}

/// openGym's mark, the app icon's barbell (frontend/public/icon-512.png), drawn as one shape so it
/// takes the watch face's tint and stays sharp at every complication size.
struct OpenGymLogo: Shape {
    func path(in rect: CGRect) -> Path {
        // The icon's own coordinates (512 × 512); the barbell spans x 80…432, y 170…342.
        let boxes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (80, 200, 36, 112), (116, 242, 16, 28), (132, 170, 46, 172),
            (178, 242, 156, 28),
            (334, 170, 46, 172), (380, 242, 16, 28), (396, 200, 36, 112),
        ]
        let minX: CGFloat = 80, minY: CGFloat = 170, w: CGFloat = 352, h: CGFloat = 172
        let scale = min(rect.width / w, rect.height / h)
        let ox = rect.midX - w * scale / 2, oy = rect.midY - h * scale / 2
        var p = Path()
        for (x, y, bw, bh) in boxes {
            p.addRect(CGRect(x: ox + (x - minX) * scale, y: oy + (y - minY) * scale, width: bw * scale, height: bh * scale))
        }
        return p
    }
}

