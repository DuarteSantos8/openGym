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
    /// Sets logged on the watch that have not reached the iPhone yet (nil: none).
    var unsent: Int?

    static let idle = WidgetState(mode: "idle", title: "openGym", detail: "", restEndsAt: nil)
    static let groupId = "group.ch.opengym.app"
    private static let key = "widgetState"

    static func == (a: WidgetState, b: WidgetState) -> Bool {
        a.mode == b.mode && a.title == b.title && a.detail == b.detail && a.restEndsAt == b.restEndsAt
            && a.done == b.done && a.total == b.total && a.setLabel == b.setLabel && a.lang == b.lang && a.unsent == b.unsent
    }

    /// The state as written, unless it is about a session the watch app has not touched for 45
    /// minutes (it was closed, or the workout runs on the phone alone): then nothing to show, and
    /// the iPhone's Live Activity has the Smart Stack to itself instead of two cards saying the same.
    static func read() -> WidgetState {
        guard let d = UserDefaults(suiteName: groupId)?.data(forKey: key),
              let s = try? JSONDecoder().decode(WidgetState.self, from: d) else { return .idle }
        if (s.mode == "set" || s.mode == "rest") && Date().timeIntervalSince(s.updatedAt) > 45 * 60 { return s.quiet }
        return s
    }

    func write() {
        var s = self
        s.updatedAt = Date()
        if let d = try? JSONEncoder().encode(s) { UserDefaults(suiteName: WidgetState.groupId)?.set(d, forKey: WidgetState.key) }
    }
}

extension WidgetState {
    /// Nothing to show but the app, still in the app's language and still saying what waits for the phone.
    var quiet: WidgetState {
        var q = WidgetState.idle
        q.lang = lang
        q.unsent = unsent
        return q
    }

    /// The locale for the widget's words: the app's language where this bundle has it, else English
    /// (a phone in English never gets a German complication from a watch set to German).
    var locale: Locale {
        guard let l = lang else { return .current }
        if l == "en" { return Locale(identifier: "en") }
        let name = ["pt": "pt-PT", "zh": "zh-Hans", "zh-TW": "zh-Hant"][l] ?? l
        return Locale(identifier: Bundle.main.path(forResource: name, ofType: "lproj") != nil ? name : "en")
    }
}

/// openGym's mark (assets/logo/opengym-mark.svg): five plain rectangles on a 352 x 174 grid, square
/// corners. One shape, so it takes the watch face's tint and stays sharp at every complication size.
struct OpenGymLogo: Shape {
    /// The brand green (#A3E635): the logo's colour wherever it is not tinted by the face.
    static let green = Color(red: 163 / 255, green: 230 / 255, blue: 53 / 255)

    func path(in rect: CGRect) -> Path {
        let boxes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (80, 242, 352, 28), (80, 199, 36, 114), (131, 169, 47, 174), (334, 169, 47, 174), (396, 199, 36, 114),
        ]
        let minX: CGFloat = 80, minY: CGFloat = 169, w: CGFloat = 352, h: CGFloat = 174
        let scale = min(rect.width / w, rect.height / h)
        let ox = rect.midX - w * scale / 2, oy = rect.midY - h * scale / 2
        var p = Path()
        for (x, y, bw, bh) in boxes {
            p.addRect(CGRect(x: ox + (x - minX) * scale, y: oy + (y - minY) * scale, width: bw * scale, height: bh * scale))
        }
        return p
    }
}

