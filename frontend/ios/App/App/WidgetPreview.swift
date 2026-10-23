import SwiftUI
import UIKit

/**
 * For CI only (.github/workflows/ios.yml): started with -OpenGymWidgetPreview, the app draws the
 * widgets and the Live Activity (WidgetViews.swift, the same views the widget extension shows)
 * with made-up data into PNG files in Documents/widget-preview, light and dark, and writes
 * done.txt when it is through. Nobody without a Mac can put a widget on a simulator's Home
 * Screen, so this is how a change to them is seen. Never runs otherwise: nothing but the CI step
 * passes the argument.
 */
enum WidgetPreview {
    static let argument = "-OpenGymWidgetPreview"

    static func runIfAsked() {
        guard ProcessInfo.processInfo.arguments.contains(argument) else { return }
        if #available(iOS 17.0, *) {
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                render()
            }
        }
    }

    @available(iOS 17.0, *)
    private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        try? JSONDecoder().decode(type, from: Data(json.utf8))
    }

    @available(iOS 17.0, *)
    private static func snapshot(today: String, active: String = "null") -> WidgetSnapshot? {
        decode(WidgetSnapshot.self, """
        {"v":1,"today":"\(today)","weekFrom":"\(today)","weekUntil":"9999-12-31","unit":"kg","accent":"#30d158","ink":"#000000",
         "days":[{"iso":"\(today)","weekday":"Wednesday","name":"Push Day","count":5,"done":false,"exercises":[
           {"name":"Barbell Bench Press","line":"4 × 6 · 80 kg"},{"name":"Overhead Press","line":"3 × 8 · 45 kg"},
           {"name":"Incline Dumbbell Press","line":"3 × 10 · 26 kg"},{"name":"Lateral Raise","line":"3 × 15 · 10 kg"},
           {"name":"Triceps Pushdown","line":"3 × 12 · 30 kg"}]},
          {"iso":"9999-12-30","weekday":"Friday","name":"Leg Day","count":4}],
         "week":{"done":2,"planned":4},"streak":7,"lastPR":{"name":"Barbell Squat","value":"120 kg","d":"\(today)"},
         "active":\(active),
         "labels":{"today":"Today","restDay":"Rest day","upNext":"Up next","thisWeek":"This week","weekStreak":"Week streak",
           "streak":"7 week streak","lastPR":"Last PR","done":"Done","running":"Workout running"}}
        """)
    }

    @available(iOS 17.0, *)
    private static func live(rest: Bool) -> (WorkoutActivityAttributes, WorkoutActivityAttributes.ContentState)? {
        let end = (Date().timeIntervalSince1970 + 75) * 1000
        guard let a = decode(WorkoutActivityAttributes.self, """
        {"v":1,"wid":"preview","start":null,"accent":"#30d158","ink":"#000000",
         "labels":{"done":"Done","rest":"Rest","next":"Up next","allDone":"All sets done","restOver":"Rest’s over. Next set!"}}
        """), let s = decode(WorkoutActivityAttributes.ContentState.self, """
        {"name":"Push Day","cur":{"exId":"0025","entryIdx":0,"setIdx":2,"exName":"Barbell Bench Press","setLine":"Set 3 of 4",
          "target":"80 kg × 6","restAfter":120},"ahead":[],"restEndsAt":\(rest ? String(end) : "null"),"restLeft":null,
          "restTotal":\(rest ? "120" : "null"),"done":6,"total":17}
        """) else { return nil }
        return (a, s)
    }

    @available(iOS 17.0, *)
    @MainActor
    private static func render() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("widget-preview")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let now = Date()
        let today = WidgetModel.isoDay(now)
        let plan = WidgetModel(snap: snapshot(today: today), date: now)
        let restDay = WidgetModel(snap: snapshot(today: today).map { var s = $0; s.days.removeFirst(); return s }, date: now)
        let running = WidgetModel(snap: snapshot(today: today, active: #"{"id":"a","name":"Push Day","start":\#((now.timeIntervalSince1970 - 1500) * 1000),"done":6,"total":17}"#), date: now)
        let empty = WidgetModel(snap: nil, date: now)

        func save<V: View>(_ name: String, _ size: CGSize, dark: Bool, radius: CGFloat = 22, padding: CGFloat = 16, @ViewBuilder _ view: () -> V) {
            let framed = view()
                .padding(padding)
                .frame(width: size.width, height: size.height)
                .background(Color(UIColor.systemBackground))
                .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .environment(\.colorScheme, dark ? .dark : .light)
            let r = ImageRenderer(content: framed)
            r.scale = 3
            if let data = r.uiImage?.pngData() {
                try? data.write(to: dir.appendingPathComponent("\(name)-\(dark ? "dark" : "light").png"))
            }
        }

        for dark in [false, true] {
            save("small-plan", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: plan) }
            save("small-rest-day", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: restDay) }
            save("small-running", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: running) }
            save("small-empty", CGSize(width: 170, height: 170), dark: dark) { SmallWidgetView(model: empty) }
            save("medium", CGSize(width: 364, height: 170), dark: dark) { MediumWidgetView(model: plan) }
            save("large", CGSize(width: 364, height: 382), dark: dark) { LargeWidgetView(model: plan) }
            if case let (a, s)? = live(rest: false) {
                save("live-lock", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s) }
            }
            if case let (a, s)? = live(rest: true) {
                save("live-lock-resting", CGSize(width: 370, height: 150), dark: dark, radius: 24, padding: 0) { LiveLockView(attributes: a, state: s) }
            }
        }
        // The Lock Screen's accessories and the Dynamic Island are drawn light on dark.
        save("lock-rect", CGSize(width: 172, height: 76), dark: true, radius: 12, padding: 6) { NextRectView(model: plan) }
        save("lock-circle", CGSize(width: 76, height: 76), dark: true, radius: 38, padding: 0) { StreakCircleView(model: plan) }
        save("lock-inline", CGSize(width: 260, height: 30), dark: true, radius: 6, padding: 4) { NextInlineView(model: plan) }
        if case let (a, s)? = live(rest: true) {
            save("island-compact", CGSize(width: 250, height: 37), dark: true, radius: 18.5, padding: 8) {
                HStack {
                    Image(systemName: "dumbbell.fill").foregroundStyle(Color(hex: a.accent) ?? .green)
                    Spacer()
                    LiveCompactTrailing(attributes: a, state: s)
                }
            }
            save("island-minimal", CGSize(width: 37, height: 37), dark: true, radius: 18.5, padding: 2) { LiveMinimal(attributes: a, state: s) }
        }
        try? "done".write(to: dir.appendingPathComponent("done.txt"), atomically: true, encoding: .utf8)
    }
}
