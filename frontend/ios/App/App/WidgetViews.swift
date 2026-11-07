import AppIntents
import SwiftUI
import UIKit
import WidgetKit

/*
 * What the Home Screen and Lock Screen widgets and the workout's Live Activity look like.
 * Compiled into the widget extension, which shows them (OpenGymWidgets), and into the app, which
 * only draws them into pictures for CI when started with -OpenGymWidgetPreview
 * (WidgetPreview.swift). Text and SF Symbols only: no exercise animations or pictures (Gym visual
 * licence). The words come from the page in the app's language (lib/widgets.js).
 */

// MARK: - the snapshot (lib/widgets.js buildWidgetSnapshot)

@available(iOS 17.0, *)
struct WidgetSnapshot: Codable {
    struct Exercise: Codable, Hashable { var name: String; var line: String? }
    struct Day: Codable, Hashable {
        var iso: String
        var weekday: String?
        var name: String?
        var count: Int?
        var exercises: [Exercise]?
        var done: Bool?
        var ids: [String]?
    }
    struct Week: Codable { var done: Int; var planned: Int }
    struct PR: Codable { var name: String; var value: String?; var d: String? }
    struct Active: Codable { var id: String?; var name: String?; var start: Double?; var done: Int; var total: Int }
    struct Labels: Codable {
        var today: String?
        var restDay: String?
        var upNext: String?
        var thisWeek: String?
        var weekStreak: String?
        var streak: String?
        var lastPR: String?
        var done: String?
        var running: String?
        // v 2 (the configurable widget)
        var weightGoal: String?
        var nextWorkout: String?
        var records: String?
        var volume: String?
        var challenges: String?
        var freezes: String?
        var nothingPlanned: String?
        var noWeighIn: String?
        var startNow: String?
    }
    // v 2: one block per thing the configurable widget can show (lib/widgets.js).
    struct StreakInfo: Codable { var current: Int; var best: Int; var freezes: Int; var weekDone: Bool?; var next: Int?; var line: String?; var bestLine: String? }
    struct Weight: Codable { var current: Double; var goal: Double?; var toGo: Double?; var unit: String?; var trend: [Double]?; var currentText: String?; var goalText: String?; var line: String? }
    struct Records: Codable { var month: Int; var monthLine: String?; var last: PR? }
    struct Volume: Codable { var now: Double; var prev: Double; var unit: String?; var pct: Int?; var nowText: String?; var prevText: String?; var line: String? }
    // The monthly challenges (lib/widgets.js challengesOfWidget): how many of the month's are done.
    struct ChallengeItem: Codable { var id: String; var title: String?; var count: String?; var pct: Int?; var done: Bool? }
    struct Challenges: Codable { var month: String?; var done: Int; var total: Int; var items: [ChallengeItem]?; var line: String?; var next: String? }

    var v: Int
    var today: String
    var weekFrom: String?
    var weekUntil: String?
    var accent: String?
    var ink: String?
    var days: [Day]
    var week: Week?
    var streak: Int?
    var lastPR: PR?
    var active: Active?
    var labels: Labels?
    var streakInfo: StreakInfo?
    var weight: Weight?
    var records: Records?
    var volume: Volume?
    var challenges: Challenges?

    static func load() -> WidgetSnapshot? {
        guard let url = OpenGymGroup.container?.appendingPathComponent("widget.json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}

/// The snapshot as of one moment: the day it is then, the next day with a plan, this week.
@available(iOS 17.0, *)
struct WidgetModel {
    let snap: WidgetSnapshot?
    let date: Date

    static func isoDay(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    var iso: String { WidgetModel.isoDay(date) }
    var labels: WidgetSnapshot.Labels { snap?.labels ?? WidgetSnapshot.Labels() }
    var day: WidgetSnapshot.Day? { snap?.days.first { $0.iso == iso } }
    var next: WidgetSnapshot.Day? { snap?.days.first { $0.iso > iso && $0.name != nil } }
    /// A workout running now; one from a day gone by is stale (the app ends it when it opens).
    var active: WidgetSnapshot.Active? { snap?.today == iso ? snap?.active : nil }
    var weekDone: Int {
        guard let w = snap?.week else { return 0 }
        if let until = snap?.weekUntil, iso >= until { return 0 }
        return w.done
    }
    var weekPlanned: Int { snap?.week?.planned ?? 0 }
    var streak: Int { snap?.streak ?? 0 }
    var accent: Color { Color(hex: snap?.accent) ?? Color(red: 0.19, green: 0.82, blue: 0.35) }
    var ink: Color { accent.inkOn }
    /// The set to log from the widget while a workout runs today (v1.4.5, WidgetLogger), or nil.
    var logger: WidgetLogger.Shown? { active != nil ? WidgetLogger.shown() : nil }
}

@available(iOS 17.0, *)
extension Color {
    init?(hex: String?) {
        guard let hex = hex, hex.count == 7, hex.hasPrefix("#"), let n = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
    }
}

/// WCAG colour maths for the accent, the Swift side of lib/accent.js (luminance, contrast, inkOn).
/// Pure, so the vectors of accent.test.js hold here too (no Swift test target can reach widget code):
/// inkOn #ffd60a and #30d158 are black, #1a237e and #8b0000 are white; the ink always reads 4.5:1.
enum AccentMath {
    typealias RGB = (r: Double, g: Double, b: Double)

    static func luminance(_ c: RGB) -> Double {
        func lin(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    static func contrast(_ a: RGB, _ b: RGB) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// True for black ink, false for white: whichever reads better on `c` (black on a tie).
    static func blackInk(on c: RGB) -> Bool { contrast(c, (0, 0, 0)) >= contrast(c, (1, 1, 1)) }

    /// `c`, darkened step by step until it holds 3:1 against white (graphics on a light background).
    static func mark(_ c: RGB) -> RGB {
        var m = c
        for _ in 0..<12 where contrast(m, (1, 1, 1)) < 3 { m = (m.r * 0.88, m.g * 0.88, m.b * 0.88) }
        return m
    }
}

@available(iOS 17.0, *)
extension Color {
    var rgb: AccentMath.RGB {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b))
    }

    /// Black or white, whichever reads better on this colour (lib/accent.js inkOn).
    var inkOn: Color { AccentMath.blackInk(on: rgb) ? .black : .white }

    /// For marks (ring, bar, glyph): the accent as is on dark, a shade darker on light so it holds 3:1.
    func mark(_ scheme: ColorScheme) -> Color {
        guard scheme == .light else { return self }
        let m = AccentMath.mark(rgb)
        return Color(red: m.r, green: m.g, blue: m.b)
    }
}

/// Secondary text. A light full-colour widget gets a darker grey (the system one is under 4.5:1 on
/// white); tinted and clear widgets keep the system's, which the system recolours itself.
@available(iOS 17.0, *)
struct SecondaryText: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode
    func body(content: Content) -> some View {
        if mode == .fullColor && scheme == .light {
            content.foregroundStyle(Color(red: 0.235, green: 0.235, blue: 0.263).opacity(0.78))
        } else {
            content.foregroundStyle(.secondary)
        }
    }
}

@available(iOS 17.0, *)
extension View {
    func secondaryText() -> some View { modifier(SecondaryText()) }
}

@available(iOS 17.0, *)
extension Image {
    /// Lets a symbol take the tint in an accented widget (iOS 18+; before that .widgetAccentable alone does).
    @ViewBuilder func accentedMark() -> some View {
        if #available(iOS 18.0, *) { self.widgetAccentedRenderingMode(.accented) } else { self }
    }
}

// MARK: - pieces

/// A slim bar in the accent (drawn by SwiftUI itself, so it also renders into CI's pictures).
@available(iOS 17.0, *)
struct ProgressBar: View {
    @Environment(\.colorScheme) private var scheme
    let value: Double
    let accent: Color

    var body: some View {
        let mark = accent.mark(scheme)
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(mark.opacity(0.22))
                Capsule().fill(mark).frame(width: max(6, g.size.width * min(1, max(0, value)))).widgetAccentable()
            }
        }
        .frame(height: 6)
    }
}

@available(iOS 17.0, *)
struct WeekRing: View {
    @Environment(\.colorScheme) private var scheme
    let done: Int
    let planned: Int
    let accent: Color
    var size: CGFloat = 56

    var body: some View {
        let frac = planned > 0 ? min(1, Double(done) / Double(planned)) : (done > 0 ? 1 : 0)
        let mark = accent.mark(scheme)
        ZStack {
            Circle().stroke(mark.opacity(0.22), lineWidth: size / 7)
            Circle().trim(from: 0, to: frac)
                .stroke(mark, style: StrokeStyle(lineWidth: size / 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .widgetAccentable()
            Text(planned > 0 ? "\(done)/\(planned)" : "\(done)")
                .font(.system(size: size / 4, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
        }
        .frame(width: size, height: size)
    }
}

@available(iOS 17.0, *)
struct TodayHeader: View {
    @Environment(\.colorScheme) private var scheme
    let model: WidgetModel

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "dumbbell.fill").accentedMark().font(.caption2.weight(.bold))
                .foregroundStyle(model.accent.mark(scheme)).widgetAccentable()
            Text((model.active != nil ? model.labels.running : model.labels.today) ?? "Today")
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .secondaryText()
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}

/// Today in a few lines: the running workout, today's plan, or the rest day and what comes next.
@available(iOS 17.0, *)
struct TodayBlock: View {
    let model: WidgetModel
    var big = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let a = model.active {
                Text(a.name ?? "").font(big ? .title2.weight(.bold) : .headline).lineLimit(2).minimumScaleFactor(0.8)
                if let start = a.start {
                    Text(Date(timeIntervalSince1970: start / 1000), style: .timer)
                        .font(.title3.weight(.semibold)).monospacedDigit()
                }
                ProgressBar(value: Double(a.done) / Double(max(1, a.total)), accent: model.accent)
            } else if let d = model.day, let name = d.name {
                Text(name).font(big ? .title2.weight(.bold) : .title3.weight(.bold)).lineLimit(2).minimumScaleFactor(0.75)
                if d.done == true {
                    Label(model.labels.done ?? "Done", systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.semibold))
                } else if let n = d.count, n > 0 {
                    Label("\(n)", systemImage: "list.bullet").font(.caption).secondaryText()
                }
            } else {
                Text(model.labels.restDay ?? "Rest day").font(big ? .title2.weight(.bold) : .title3.weight(.bold)).lineLimit(1).minimumScaleFactor(0.75)
                if let n = model.next {
                    Text("\(model.labels.upNext ?? "Up next"): \(n.weekday ?? "")")
                        .font(.caption).secondaryText().lineLimit(1)
                    Text(n.name ?? "").font(.caption.weight(.semibold)).lineLimit(1)
                }
            }
        }
    }
}

@available(iOS 17.0, *)
struct StreakLine: View {
    let model: WidgetModel
    var body: some View {
        Label {
            Text(model.labels.streak ?? "\(model.streak)").lineLimit(1).minimumScaleFactor(0.7)
        } icon: {
            Image(systemName: "flame.fill").foregroundStyle(.orange).widgetAccentable()
        }
        .font(.caption.weight(.semibold))
    }
}

// MARK: - the widgets

/// Placeholder before the app wrote anything.
@available(iOS 17.0, *)
struct WidgetEmpty: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "dumbbell.fill").font(.title3).secondaryText()
            Text("Open openGym once to see your plan here.").font(.caption).secondaryText()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - logging a set from the widget (v1.4.5)

/// One number with its − and +: they change the widget's copy of the set (WidgetStepIntent).
@available(iOS 17.0, *)
struct LoggerStepRow: View {
    let label: String
    let value: String
    let field: String
    let shown: WidgetLogger.Shown
    let accent: Color

    var body: some View {
        HStack(spacing: 6) {
            Button(intent: WidgetStepIntent(op: field + "-")) {
                Image(systemName: "minus").font(.caption.weight(.bold)).frame(maxWidth: 26, maxHeight: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text("\(shown.less) \(label)"))
            Text(value)
                .font(.headline)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("\(label): \(value)"))
            Button(intent: WidgetStepIntent(op: field + "+")) {
                Image(systemName: "plus").font(.caption.weight(.bold)).frame(maxWidth: 26, maxHeight: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text("\(shown.more) \(label)"))
        }
        .controlSize(.small)
    }
}

/// The set to do now, its numbers with − and +, and Log set (WidgetLogSetIntent).
@available(iOS 17.0, *)
struct LoggerView: View {
    let model: WidgetModel
    let shown: WidgetLogger.Shown

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if shown.allDone {
                Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(model.accent)
                Text(shown.allDoneText).font(.subheadline.weight(.semibold)).lineLimit(3)
                Spacer(minLength: 0)
            } else {
                Text(shown.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(shown.line).font(.caption2).secondaryText().lineLimit(1)
                Spacer(minLength: 2)
                if let w = shown.weight {
                    LoggerStepRow(label: shown.wLabel, value: w, field: "w", shown: shown, accent: model.accent)
                }
                if let r = shown.reps {
                    LoggerStepRow(label: shown.rLabel, value: "\(r)", field: "r", shown: shown, accent: model.accent)
                }
                if let sec = shown.seconds {
                    LoggerStepRow(label: shown.secLabel, value: "\(sec) s", field: "s", shown: shown, accent: model.accent)
                }
                Button(intent: WidgetLogSetIntent()) {
                    Label(shown.logSet, systemImage: "checkmark")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(model.ink)
                }
                .buttonStyle(.borderedProminent)
                .tint(model.accent)
                .controlSize(.small)
                .accessibilityHint(Text([shown.name, shown.line].filter { !$0.isEmpty }.joined(separator: ", ")))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

@available(iOS 17.0, *)
struct SmallWidgetView: View {
    let model: WidgetModel
    var body: some View {
        if let lg = model.logger { LoggerView(model: model, shown: lg) } else if model.snap == nil { WidgetEmpty() } else {
            VStack(alignment: .leading, spacing: 0) {
                TodayHeader(model: model)
                Spacer(minLength: 4)
                TodayBlock(model: model)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

@available(iOS 17.0, *)
struct MediumWidgetView: View {
    let model: WidgetModel
    var body: some View {
        if model.snap == nil { WidgetEmpty() } else {
            HStack(alignment: .top, spacing: 14) {
                // While a workout runs, the left half is the set to log (SmallWidgetView shows it).
                SmallWidgetView(model: model)
                VStack(spacing: 8) {
                    Text(model.labels.thisWeek ?? "This week").font(.caption2.weight(.semibold)).textCase(.uppercase).secondaryText().lineLimit(1)
                    WeekRing(done: model.weekDone, planned: model.weekPlanned, accent: model.accent)
                    StreakLine(model: model)
                }
                .frame(width: 112)
            }
        }
    }
}

@available(iOS 17.0, *)
struct LargeWidgetView: View {
    let model: WidgetModel
    var body: some View {
        if model.snap == nil { WidgetEmpty() } else if let lg = model.logger {
            VStack(alignment: .leading, spacing: 10) {
                TodayHeader(model: model)
                LoggerView(model: model, shown: lg)
                Divider()
                StreakLine(model: model)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        TodayHeader(model: model)
                        TodayBlock(model: model, big: true)
                    }
                    Spacer(minLength: 8)
                    WeekRing(done: model.weekDone, planned: model.weekPlanned, accent: model.accent, size: 50)
                }
                if model.active == nil, let list = model.day?.exercises, !list.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(list.enumerated()), id: \.offset) { _, ex in
                            HStack(spacing: 8) {
                                Circle().fill(model.accent).frame(width: 6, height: 6)
                                Text(ex.name).font(.subheadline).lineLimit(1)
                                Spacer(minLength: 6)
                                Text(ex.line ?? "").font(.caption).secondaryText().lineLimit(1)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
                Divider()
                HStack(alignment: .center) {
                    StreakLine(model: model)
                    Spacer(minLength: 8)
                    if let pr = model.snap?.lastPR {
                        Label {
                            VStack(alignment: .trailing, spacing: 0) {
                                Text(model.labels.lastPR ?? "Last PR").font(.caption2).secondaryText()
                                Text([pr.name, pr.value ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption.weight(.semibold)).lineLimit(1)
                            }
                        } icon: {
                            Image(systemName: "trophy.fill").foregroundStyle(.yellow)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

/// Lock Screen, round: the streak.
@available(iOS 17.0, *)
struct StreakCircleView: View {
    let model: WidgetModel
    var body: some View {
        ZStack {
            Circle().fill(.fill.tertiary)
            VStack(spacing: -1) {
                Image(systemName: "flame.fill").font(.system(size: 13, weight: .bold)).widgetAccentable()
                Text("\(model.streak)").font(.system(size: 22, weight: .bold, design: .rounded)).minimumScaleFactor(0.5)
            }
        }
        .accessibilityLabel(model.labels.streak ?? "\(model.streak)")
    }
}

/// Lock Screen, wide: the next workout (or the one running).
@available(iOS 17.0, *)
struct NextRectView: View {
    let model: WidgetModel
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let a = model.active {
                Text(model.labels.running ?? "").font(.caption.weight(.semibold)).widgetAccentable().lineLimit(1)
                Text(a.name ?? "").font(.headline).lineLimit(1)
                if let start = a.start { Text(Date(timeIntervalSince1970: start / 1000), style: .timer).font(.caption).monospacedDigit() }
            } else if let d = model.day, let name = d.name, d.done != true {
                Label(model.labels.today ?? "Today", systemImage: "dumbbell.fill").font(.caption.weight(.semibold)).widgetAccentable().lineLimit(1)
                Text(name).font(.headline).lineLimit(2)
            } else if let n = model.next {
                Label("\(model.labels.upNext ?? "Up next") · \(n.weekday ?? "")", systemImage: "calendar").font(.caption.weight(.semibold)).widgetAccentable().lineLimit(1)
                Text(n.name ?? "").font(.headline).lineLimit(2)
            } else {
                Label(model.labels.restDay ?? "Rest day", systemImage: "moon.zzz.fill").font(.headline).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@available(iOS 17.0, *)
struct NextInlineView: View {
    let model: WidgetModel
    var body: some View {
        if let a = model.active {
            Label(a.name ?? "", systemImage: "dumbbell.fill")
        } else if let d = model.day, let name = d.name, d.done != true {
            Label("\(model.labels.today ?? "Today"): \(name)", systemImage: "dumbbell.fill")
        } else if let n = model.next {
            Label("\(n.weekday ?? ""): \(n.name ?? "")", systemImage: "calendar")
        } else {
            Label(model.labels.restDay ?? "Rest day", systemImage: "moon.zzz.fill")
        }
    }
}

// MARK: - the configurable widget ("openGym": what to show, OpenGymWidgets.swift)

/// What the configurable widget can show. The menu's words are in OpenGymWidgets.swift (AppEnum).
enum GymWidgetKind: String, CaseIterable, Codable {
    case streak, weight, week, next, records, volume, challenges
}

/// The links a tap opens (lib/widget-links.js reads them; Android builds the same ones).
enum GymLink {
    static let home = URL(string: "opengym://home")!
    static let stats = URL(string: "opengym://stats")!
    static let weighIn = URL(string: "opengym://weigh-in")!
    /// The workout already running (a start with no routines goes back to it).
    static let workout = URL(string: "opengym://start")!
    static func start(_ ids: [String]?) -> URL {
        let ok = (ids ?? []).filter { $0.range(of: "^[A-Za-z0-9_.:-]{1,64}$", options: .regularExpression) != nil }.prefix(8)
        if ok.isEmpty { return home }
        return URL(string: "opengym://start?r=" + ok.joined(separator: ",")) ?? home
    }
}

/// One block of the configurable widget, as words: what it is, the number, one line, where a tap goes.
@available(iOS 17.0, *)
struct KindContent {
    let kind: GymWidgetKind
    let symbol: String
    let title: String
    let value: String
    /// What the round Lock Screen widget has room for.
    let short: String
    let caption: String
    let url: URL
    var trend: [Double] = []
    var freezes = 0
}

@available(iOS 17.0, *)
extension WidgetModel {
    /// The next workout: today's while it is not done, else the next day with a plan.
    var nextWorkout: WidgetSnapshot.Day? {
        if active == nil, let d = day, d.name != nil, d.done != true { return d }
        return next
    }

    func content(_ kind: GymWidgetKind) -> KindContent {
        let l = labels
        switch kind {
        case .streak:
            let s = snap?.streakInfo
            let n = s?.current ?? streak
            return KindContent(kind: kind, symbol: "flame.fill", title: l.weekStreak ?? "Week streak", value: "\(n)", short: "\(n)",
                               caption: s?.bestLine ?? "", url: GymLink.stats, freezes: s?.freezes ?? 0)
        case .weight:
            let title = l.weightGoal ?? "Weight goal"
            guard let w = snap?.weight else {
                return KindContent(kind: kind, symbol: "scalemass.fill", title: title, value: "–", short: "–", caption: l.noWeighIn ?? "", url: GymLink.weighIn)
            }
            let short = w.toGo.map { String(format: $0 < 10 ? "%.1f" : "%.0f", $0) } ?? String(format: "%.0f", w.current)
            return KindContent(kind: kind, symbol: "scalemass.fill", title: title, value: w.currentText ?? "", short: short,
                               caption: w.line ?? "", url: GymLink.weighIn, trend: w.trend ?? [])
        case .week:
            let v = weekPlanned > 0 ? "\(weekDone)/\(weekPlanned)" : "\(weekDone)"
            return KindContent(kind: kind, symbol: "calendar", title: l.thisWeek ?? "This week", value: v, short: v,
                               caption: snap?.streakInfo?.line ?? l.streak ?? "", url: GymLink.home)
        case .next:
            let title = l.nextWorkout ?? "Next workout"
            if let a = active {
                return KindContent(kind: kind, symbol: "dumbbell.fill", title: l.running ?? title, value: a.name ?? "", short: "\(a.done)/\(a.total)",
                                   caption: "\(a.done)/\(a.total)", url: GymLink.workout)
            }
            guard let d = nextWorkout, let name = d.name else {
                return KindContent(kind: kind, symbol: "dumbbell.fill", title: title, value: l.nothingPlanned ?? "", short: "–", caption: l.restDay ?? "", url: GymLink.home)
            }
            let when = d.iso == iso ? (l.today ?? "Today") : (d.weekday ?? "")
            return KindContent(kind: kind, symbol: "dumbbell.fill", title: title, value: name, short: String(when.prefix(3)),
                               caption: when, url: GymLink.start(d.ids))
        case .records:
            let r = snap?.records
            var caption = r?.monthLine ?? ""
            if let pr = r?.last ?? snap?.lastPR { caption = [pr.name, pr.value ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") }
            let n = r?.month ?? 0
            return KindContent(kind: kind, symbol: "trophy.fill", title: l.records ?? "Records", value: "\(n)", short: "\(n)", caption: caption, url: GymLink.stats)
        case .volume:
            let v = snap?.volume
            let short = v?.pct.map { ($0 > 0 ? "+" : "") + "\($0)%" } ?? (v?.nowText ?? "0")
            return KindContent(kind: kind, symbol: "chart.bar.fill", title: l.volume ?? "Volume", value: v?.nowText ?? "0", short: short,
                               caption: v?.line ?? "", url: GymLink.stats)
        case .challenges:
            let c = snap?.challenges
            let v = c.map { "\($0.done)/\($0.total)" } ?? "–"
            return KindContent(kind: kind, symbol: "rosette", title: l.challenges ?? "Challenges", value: v, short: v,
                               caption: c?.next ?? c?.line ?? "", url: GymLink.home)
        }
    }
}

/// The weight goal's last weigh-ins as a thin line.
@available(iOS 17.0, *)
struct Sparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        GeometryReader { g in
            let lo = values.min() ?? 0, hi = values.max() ?? 1
            let span = max(hi - lo, 0.5), mid = (hi + lo) / 2
            let pts = values.enumerated().map { i, v in
                CGPoint(x: g.size.width * CGFloat(i) / CGFloat(max(1, values.count - 1)),
                        y: g.size.height * CGFloat(1 - ((v - mid) / span + 0.5)))
            }
            ZStack {
                Path { p in
                    guard let first = pts.first else { return }
                    p.move(to: first)
                    for q in pts.dropFirst() { p.addLine(to: q) }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                if let last = pts.last { Circle().fill(color).frame(width: 5, height: 5).position(last) }
            }
        }
        .padding(.vertical, 2)
    }
}

/// Snowflakes for the freezes banked.
@available(iOS 17.0, *)
struct FreezeFlakes: View {
    let n: Int
    var body: some View {
        if n > 0 {
            HStack(spacing: 1) {
                ForEach(0..<min(2, n), id: \.self) { _ in Image(systemName: "snowflake") }
            }
            .font(.caption.weight(.bold))
            .foregroundStyle(.cyan)
        }
    }
}

/// One block: what it is, the number big, one line under it.
@available(iOS 17.0, *)
struct KindBlock: View {
    let model: WidgetModel
    let c: KindContent

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Image(systemName: c.symbol).font(.caption2.weight(.bold))
                    .foregroundStyle(c.kind == .streak ? Color.orange : model.accent)
                Text(c.title).font(.caption2.weight(.semibold)).textCase(.uppercase).secondaryText().lineLimit(1)
                Spacer(minLength: 0)
            }
            Spacer(minLength: 2)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(c.value)
                    .font(c.kind == .next ? .title3.weight(.bold) : .system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit().lineLimit(c.kind == .next ? 2 : 1).minimumScaleFactor(0.5)
                FreezeFlakes(n: c.freezes)
            }
            if c.trend.count >= 2 { Sparkline(values: c.trend, color: model.accent).frame(height: 20) }
            if !c.caption.isEmpty {
                Text(c.caption).font(.caption).secondaryText().lineLimit(2).minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// The configurable widget in every size it comes in.
@available(iOS 17.0, *)
struct KindWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let model: WidgetModel
    let kind: GymWidgetKind
    let second: GymWidgetKind

    var body: some View {
        let c = model.content(kind)
        Group {
            if model.snap == nil && family != .accessoryInline && family != .accessoryCircular && family != .accessoryRectangular {
                WidgetEmpty()
            } else {
                switch family {
                case .systemSmall where model.logger != nil:
                    LoggerView(model: model, shown: model.logger!)
                case .systemMedium where model.logger != nil:
                    HStack(spacing: 14) {
                        LoggerView(model: model, shown: model.logger!)
                        Divider()
                        Link(destination: c.url) { KindBlock(model: model, c: c) }
                    }
                case .systemMedium:
                    HStack(spacing: 14) {
                        Link(destination: c.url) { KindBlock(model: model, c: c) }
                        Divider()
                        let d = model.content(second)
                        Link(destination: d.url) { KindBlock(model: model, c: d) }
                    }
                case .accessoryCircular: KindCircleView(c: c)
                case .accessoryRectangular: KindRectView(c: c)
                case .accessoryInline: Label("\(c.title): \(c.value)", systemImage: c.symbol)
                default: KindBlock(model: model, c: c)
                }
            }
        }
        .widgetURL(c.url)
    }
}

@available(iOS 17.0, *)
struct KindCircleView: View {
    let c: KindContent
    var body: some View {
        ZStack {
            Circle().fill(.fill.tertiary)
            VStack(spacing: -1) {
                Image(systemName: c.symbol).font(.system(size: 12, weight: .bold)).widgetAccentable()
                Text(c.short).font(.system(size: 19, weight: .bold, design: .rounded)).monospacedDigit().minimumScaleFactor(0.4).lineLimit(1)
            }
            .padding(4)
        }
        .accessibilityLabel("\(c.title): \(c.value)")
    }
}

@available(iOS 17.0, *)
struct KindRectView: View {
    let c: KindContent
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label(c.title, systemImage: c.symbol).font(.caption.weight(.semibold)).widgetAccentable().lineLimit(1)
            HStack(spacing: 4) {
                Text(c.value).font(.headline).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                if c.freezes > 0 { Image(systemName: "snowflake").font(.caption2) }
            }
            if !c.caption.isEmpty { Text(c.caption).font(.caption).lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - the Live Activity

@available(iOS 17.0, *)
struct LiveRest: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var font: Font = .title2
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let accent = (Color(hex: attributes.accent) ?? .green).mark(scheme)
        // A hold (or its count-in) comes first: it is what is happening now.
        if let range = state.holdRange {
            Text(timerInterval: range, countsDown: true)
                .font(font.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(accent)
        } else if let left = state.holdLeft {
            Label(LiveNumbers.clock(left), systemImage: "pause.fill")
                .font(font.weight(.bold)).monospacedDigit()
                .secondaryText()
        } else if let range = state.restRange {
            Text(timerInterval: range, countsDown: true)
                .font(font.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(accent)
                // The clock ticks by itself, so VoiceOver gets it as the value ("Rest, 1:12").
                .accessibilityLabel(attributes.labels.rest)
                .accessibilityValue(Text(timerInterval: range, countsDown: true))
        } else if let left = state.restLeft {
            Label(LiveNumbers.clock(left), systemImage: "pause.fill")
                .font(font.weight(.bold)).monospacedDigit()
                .secondaryText()
        }
    }
}

@available(iOS 16.1, *)
extension WorkoutActivityAttributes {
    /// The line with no set to show: all done, or sets left that the activity does not carry
    /// (many taps with the page asleep), where "All sets done" was simply wrong (Discord).
    func noSetText(_ state: ContentState) -> String {
        state.done < state.total ? (labels.openApp ?? "Open openGym for the next set") : labels.allDone
    }

    /// The word over the clock: the count-in, the hold, or the rest.
    func clockLabel(_ state: ContentState) -> String {
        if state.holding { return state.holdKind == "countin" ? (labels.getReady ?? labels.rest) : (labels.hold ?? labels.rest) }
        if let r = state.restRange, r.upperBound <= Date() { return labels.restOver }
        return labels.rest
    }
}

/// Log set: ticks the set shown (the label from LIVE_VERSION 2 says so; "Done" read like "finish").
@available(iOS 17.0, *)
struct LiveDoneButton: View {
    let attributes: WorkoutActivityAttributes
    let cur: WorkoutActivityAttributes.SetInfo

    var body: some View {
        Button(intent: DoneSetIntent(wid: attributes.wid, exId: cur.exId, entryIdx: cur.entryIdx, setIdx: cur.setIdx)) {
            Label(attributes.labels.done, systemImage: "checkmark")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle((Color(hex: attributes.accent) ?? .green).inkOn)
                .lineLimit(1)
        }
        .buttonStyle(.borderedProminent)
        .tint(Color(hex: attributes.accent) ?? .green)
        .accessibilityHint(Text([cur.exName, cur.setLine].filter { !$0.isEmpty }.joined(separator: ", ")))
    }
}

/// The smaller button beside Log set: Skip rest while resting, else Next exercise, and nothing
/// when no other exercise has sets open.
@available(iOS 17.0, *)
struct LiveSecondaryButton: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .green
        if state.holding && state.auto == true {
            Button(intent: StopAutoIntent(wid: attributes.wid)) {
                Image(systemName: "stop.fill").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text(attributes.labels.stopAuto ?? "Stop auto"))
        } else if state.resting {
            Button(intent: SkipRestIntent(wid: attributes.wid)) {
                Image(systemName: "forward.fill").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text(attributes.labels.skipRest ?? "Skip rest"))
        } else if let c = state.cur, state.nextUnitStart != nil {
            Button(intent: NextExerciseIntent(wid: attributes.wid, entryIdx: c.entryIdx)) {
                Image(systemName: "forward.end.fill").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text(attributes.labels.nextExercise ?? "Next exercise"))
        }
    }
}

/// What the activity is doing, in a shape as well as a colour: a timer while resting or holding,
/// a dumbbell while a set runs.
@available(iOS 17.0, *)
struct LiveGlyph: View {
    @Environment(\.colorScheme) private var scheme
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        Image(systemName: state.holding || state.resting ? "timer" : "dumbbell.fill")
            .foregroundStyle((Color(hex: attributes.accent) ?? .green).mark(scheme))
            .accessibilityHidden(true)
    }
}

/// Sets done of total. Only this number animates when an update lands; the clocks never do.
@available(iOS 17.0, *)
struct LiveCount: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        Text("\(state.done)/\(state.total)").monospacedDigit()
            .contentTransition(reduceMotion ? .identity : .numericText())
    }
}

/// The Lock Screen's (and a watch Smart Stack's, through the compact views) workout.
@available(iOS 17.0, *)
struct LiveLockView: View {
    @Environment(\.colorScheme) private var scheme
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .green
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        LiveGlyph(attributes: attributes, state: state).font(.subheadline)
                        Text(state.cur?.exName ?? attributes.noSetText(state)).font(.headline).lineLimit(1)
                    }
                    if let c = state.cur {
                        Text([c.setLine, c.target].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.subheadline).secondaryText().lineLimit(1)
                    } else {
                        Text(state.name).font(.subheadline).secondaryText().lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if state.holding || state.restRange != nil || state.restLeft != nil {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(attributes.clockLabel(state)).font(.caption2.weight(.semibold)).textCase(.uppercase).secondaryText()
                            .lineLimit(2).multilineTextAlignment(.trailing)
                        LiveRest(attributes: attributes, state: state).frame(maxWidth: 96, alignment: .trailing)
                    }
                }
            }
            // The rest fills by itself, as the clock runs down; the clock stays the readable part.
            if state.holdRange == nil, let range = state.restRange {
                ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .tint(accent.mark(scheme))
                    .accessibilityHidden(true)
            }
            HStack(spacing: 10) {
                ProgressBar(value: Double(state.done) / Double(max(1, state.total)), accent: accent)
                LiveCount(state: state).font(.caption.weight(.semibold)).secondaryText()
                LiveSecondaryButton(attributes: attributes, state: state)
                if let c = state.cur { LiveDoneButton(attributes: attributes, cur: c) }
            }
        }
        .padding(16)
    }
}

/// The Dynamic Island's small sides: the rest counting down, or how far along the session is.
@available(iOS 17.0, *)
struct LiveCompactTrailing: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        if state.holding || state.restRange != nil || state.restLeft != nil {
            LiveRest(attributes: attributes, state: state, font: .caption).frame(width: 46)
        } else {
            LiveCount(state: state).font(.caption.weight(.bold))
                .foregroundStyle(Color(hex: attributes.accent) ?? .green)
        }
    }
}

@available(iOS 17.0, *)
struct LiveMinimal: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        if let range = state.holdRange ?? state.restRange {
            Text(timerInterval: range, countsDown: true, showsHours: false)
                .font(.caption2.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(.center)
                .foregroundStyle(Color(hex: attributes.accent) ?? .green)
                .frame(width: 34)
        } else {
            Image(systemName: "dumbbell.fill").foregroundStyle(Color(hex: attributes.accent) ?? .green)
        }
    }
}
