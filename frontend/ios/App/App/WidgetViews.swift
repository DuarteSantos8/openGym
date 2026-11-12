import AppIntents
import ImageIO
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import WidgetKit

/*
 * What the Home Screen and Lock Screen widgets and the workout's Live Activity look like.
 * Compiled into the widget extension, which shows them (OpenGymWidgets), and into the app, which
 * only draws them into pictures for CI when started with -OpenGymWidgetPreview
 * (WidgetPreview.swift). Text and SF Symbols, and in the Live Activity the exercise's 180 px still
 * the app ships when Settings asks for the picture (LiveStills): never an animation, never a
 * full-size picture (Gym visual licence). The words come from the page in the app's language.
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
    var accent: Color { Color(hex: snap?.accent) ?? .openGymGreen }
    var ink: Color { Color(hex: snap?.ink) ?? .openGymInk }
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

/// The brand's colours: the green (#a3e635), what every surface falls back on until the app has
/// said which accent it wears (1.4.5), and the near-black (#0c0e12) that reads on it.
extension Color {
    static let openGymGreen = Color(red: 0xa3 / 255, green: 0xe6 / 255, blue: 0x35 / 255)
    static let openGymInk = Color(red: 0x0c / 255, green: 0x0e / 255, blue: 0x12 / 255)
}

/// WCAG colour maths for the accent, the Swift side of lib/accent.js (luminance, contrast, inkOn).
/// Pure, so the vectors of accent.test.js hold here too (no Swift test target can reach widget code):
/// contrast(black, white) is 21 and a colour on itself 1; inkOn #ffd60a and #30d158 are black,
/// #1a237e and #8b0000 are white; the ink reads at least 4.5:1.
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
/// #3C3C43 at 78% is about 5.7:1 on white, like iOS's secondary label. Not for the always-black island.
@available(iOS 17.0, *)
struct SecondaryText: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var mode
    func body(content: Content) -> some View {
        if mode == .fullColor && scheme == .light {
            content.foregroundStyle(Color(red: 0x3C / 255, green: 0x3C / 255, blue: 0x43 / 255).opacity(0.78))
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
            OpenGymMark(width: 30)
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
            // The number answers the tap itself: it dims until the widget is drawn again
            // (invalidatableContent), then rolls to the new value instead of blurring over.
            Text(value)
                .font(.headline)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .invalidatableContent()
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
    @Environment(\.colorScheme) private var scheme
    let model: WidgetModel
    let shown: WidgetLogger.Shown

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if shown.allDone {
                Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(model.accent.mark(scheme)).widgetAccentable()
                Text(shown.allDoneText).font(.subheadline.weight(.semibold)).lineLimit(3)
                Spacer(minLength: 0)
            } else {
                Text(shown.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(shown.line).font(.caption2).secondaryText().lineLimit(1)
                Spacer(minLength: 2)
                if let w = shown.weight {
                    LoggerStepRow(label: shown.wLabel, value: w, field: "w", shown: shown, accent: model.accent.mark(scheme))
                }
                if let r = shown.reps {
                    LoggerStepRow(label: shown.rLabel, value: "\(r)", field: "r", shown: shown, accent: model.accent.mark(scheme))
                }
                if let sec = shown.seconds {
                    LoggerStepRow(label: shown.secLabel, value: "\(sec) s", field: "s", shown: shown, accent: model.accent.mark(scheme))
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
    @Environment(\.colorScheme) private var scheme
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
                                Circle().fill(model.accent.mark(scheme)).frame(width: 6, height: 6).widgetAccentable()
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
    @Environment(\.colorScheme) private var scheme
    let model: WidgetModel
    let c: KindContent

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Image(systemName: c.symbol).font(.caption2.weight(.bold))
                    .foregroundStyle(c.kind == .streak ? Color.orange : model.accent.mark(scheme)).widgetAccentable()
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
            if c.trend.count >= 2 { Sparkline(values: c.trend, color: model.accent.mark(scheme)).frame(height: 20) }
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
    var align: TextAlignment = .trailing
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let accent = (Color(hex: attributes.accent) ?? .openGymGreen).mark(scheme)
        // A hold (or its count-in) comes first: it is what is happening now.
        if let range = state.holdRange {
            Text(timerInterval: range, countsDown: true)
                .font(font.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(align)
                .foregroundStyle(accent)
        } else if let left = state.holdLeft {
            Label(LiveNumbers.clock(left), systemImage: "pause.fill")
                .font(font.weight(.bold)).monospacedDigit()
                .secondaryText()
        } else if let range = state.restRange {
            Text(timerInterval: range, countsDown: true)
                .font(font.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(align)
                .foregroundStyle(accent)
                // The clock ticks by itself; the caption above it names it, and the two are read together.
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
    /// `isStale` is the system's flag: the activity's staleDate is the rest's end, and nothing re-renders at 0:00.
    func clockLabel(_ state: ContentState, isStale: Bool = false) -> String {
        if state.holding { return state.holdKind == "countin" ? (labels.getReady ?? labels.rest) : (labels.hold ?? labels.rest) }
        if state.restRange != nil, isStale { return labels.restOver }
        return labels.rest
    }
}

/// Log set: ticks the set shown (the label from LIVE_VERSION 2 says so; "Done" read like "finish").
@available(iOS 17.0, *)
struct LiveDoneButton: View {
    let attributes: WorkoutActivityAttributes
    let cur: WorkoutActivityAttributes.SetInfo
    /// "Log set" in words only when it is the only button (lib/live-glance.js logWords); beside
    /// others the check mark alone, still named "Log set" for VoiceOver.
    var words: Bool = true

    var body: some View {
        let ink = Color(hex: attributes.ink) ?? .openGymInk
        Button(intent: DoneSetIntent(wid: attributes.wid, exId: cur.exId, entryIdx: cur.entryIdx, setIdx: cur.setIdx)) {
            if words {
                Label(attributes.labels.done, systemImage: "checkmark")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ink)
                    .lineLimit(1)
            } else {
                Image(systemName: "checkmark")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(ink)
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(Color(hex: attributes.accent) ?? .openGymGreen)
        .accessibilityLabel(Text(attributes.labels.done))
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
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
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
            .foregroundStyle((Color(hex: attributes.accent) ?? .openGymGreen).mark(scheme))
            .accessibilityHidden(true)
    }
}

/// Sets done of total. Only this number animates when an update lands; the clocks never do.
@available(iOS 17.0, *)
struct LiveCount: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        Text("\(state.done)/\(state.total)").monospacedDigit()
            .contentTransition(reduceMotion ? .identity : .numericText())
            .accessibilityLabel(Text(attributes.labels.setsDone?
                .replacingOccurrences(of: "{0}", with: "\(state.done)")
                .replacingOccurrences(of: "{1}", with: "\(state.total)") ?? "\(state.done)/\(state.total)"))
    }
}

/// The Lock Screen's (and a watch Smart Stack's, through the compact views) workout.
@available(iOS 17.0, *)
struct LiveLockView: View {
    @Environment(\.colorScheme) private var scheme
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var isStale = false

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
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
                        Text(attributes.clockLabel(state, isStale: isStale)).font(.caption2.weight(.semibold))
                            .textCase(isStale ? nil : .uppercase).secondaryText()
                            .lineLimit(2).multilineTextAlignment(.trailing)
                        LiveRest(attributes: attributes, state: state).frame(maxWidth: 96, alignment: .trailing)
                    }
                    // One spoken line ("Rest, 1:12"); the visible caption is not read a second time.
                    .accessibilityElement(children: .combine)
                }
            }
            // The rest fills by itself, as the clock runs down; the clock stays the readable part.
            if state.holdRange == nil, let range = state.restRange {
                ProgressView(timerInterval: range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.linear)
                    .tint(accent.mark(scheme))
                    .frame(height: 6)
                    .accessibilityHidden(true)
            }
            HStack(spacing: 10) {
                ProgressBar(value: Double(state.done) / Double(max(1, state.total)), accent: accent)
                LiveCount(attributes: attributes, state: state).font(.caption.weight(.semibold)).secondaryText()
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
            LiveCount(attributes: attributes, state: state).font(.caption.weight(.bold))
                .foregroundStyle(Color(hex: attributes.accent) ?? .openGymGreen)
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
                .foregroundStyle(Color(hex: attributes.accent) ?? .openGymGreen)
                .frame(width: 34)
        } else {
            OpenGymMark()
        }
    }
}

// MARK: - the glance's pieces (LIVE_VERSION 3 and 4)

/// The exercise stills the Live Activity shows, small copies in the App Group: the app writes them
/// from its own package (`public/<path>`, the 180 px still the app ships), the widget extension
/// reads them. 96 px at most, PNG. A path that is not a plain relative picture is refused.
enum LiveStills {
    static let maxPixels = 96

    static func name(_ path: String) -> String? {
        guard !path.isEmpty, path.count <= 120, !path.hasPrefix("/"), !path.contains(".."), !path.contains(":"),
              ["webp", "png", "jpg", "jpeg"].contains((path as NSString).pathExtension.lowercased()) else { return nil }
        let safe = path.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" ? $0 : "_" }
        return String(safe) + ".png"
    }

    static func file(_ path: String) -> URL? {
        guard let n = name(path), let dir = OpenGymGroup.container?.appendingPathComponent("live-stills") else { return nil }
        return dir.appendingPathComponent(n)
    }

    static func image(_ path: String?) -> UIImage? {
        guard let p = path, let url = file(p) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    /// In the app: the stills not copied yet, made small. Old ones beyond 60 go, oldest first.
    static func prepare(_ paths: [String]) {
        guard let dir = OpenGymGroup.container?.appendingPathComponent("live-stills") else { return }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for p in Set(paths) {
            guard let out = file(p), !FileManager.default.fileExists(atPath: out.path) else { continue }
            let source = Bundle.main.bundleURL.appendingPathComponent("public").appendingPathComponent(p)
            guard let src = CGImageSourceCreateWithURL(source as CFURL, nil) else { continue }
            let opts: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixels,
            ]
            guard let thumb = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary),
                  let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
            CGImageDestinationAddImage(dest, thumb, nil)
            CGImageDestinationFinalize(dest)
        }
        let all = ((try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
        if all.count > 60 {
            let dated = all.map { ($0, (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) }
            for (url, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(all.count - 60) { try? FileManager.default.removeItem(at: url) }
        }
    }
}

/// The exercise still, or nothing when there is none for the set shown.
@available(iOS 17.0, *)
struct LiveStillView: View {
    let path: String?
    var size: CGFloat = 44

    var body: some View {
        if let img = LiveStills.image(path) {
            Image(uiImage: img).resizable().scaledToFit()
                .frame(width: size, height: size)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2, style: .continuous))
                .accessibilityHidden(true)
        }
    }
}

/// The buttons a surface has, those that mean something now: Skip rest and +15 s only while
/// resting, − and + where the set has a list, Next where another exercise has sets open. Stop
/// auto comes first while timed holds run themselves, as on the classic card.
///
/// A button that comes or goes with a tap does it at once (`.transition(.identity)`): iOS fades
/// views in and out by default, which read as the widget being slow to answer.
@available(iOS 17.0, *)
struct LiveButtonsView: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    let acts: [String]
    var logWords: Bool = true

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
        HStack(spacing: 8) {
            if state.holding && state.auto == true {
                Button(intent: StopAutoIntent(wid: attributes.wid)) { Image(systemName: "stop.fill") }
                    .buttonStyle(.bordered).tint(accent)
                    .accessibilityLabel(Text(attributes.labels.stopAuto ?? "Stop auto"))
                    .transition(.identity)
            }
            ForEach(acts, id: \.self) { k in button(k, accent: accent).transition(.identity) }
        }
        .font(.subheadline.weight(.semibold))
    }

    @ViewBuilder
    private func button(_ k: String, accent: Color) -> some View {
        let wid = attributes.wid
        let label = Text(state.label("a." + k))
        switch k {
        case "log":
            if let c = state.cur { LiveDoneButton(attributes: attributes, cur: c, words: logWords) }
        case "restSkip":
            if state.resting {
                Button(intent: SkipRestIntent(wid: wid)) { Image(systemName: "forward.fill") }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
            }
        case "restAdd":
            if state.resting {
                Button(intent: AddRestIntent(wid: wid)) { Text("+15") }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
            }
        case "next":
            if let c = state.cur, state.nextUnitStart != nil {
                Button(intent: NextExerciseIntent(wid: wid, entryIdx: c.entryIdx)) { Image(systemName: "forward.end.fill") }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
            }
        case "wDown", "wUp", "rDown", "rUp", "effort":
            if let c = state.cur {
                let field = k == "effort" ? "e" : k.hasPrefix("w") ? "w" : "r"
                if c.adj?[field] != nil {
                    Button(intent: AdjustSetIntent(wid: wid, entryIdx: c.entryIdx, setIdx: c.setIdx, field: field, dir: k.hasSuffix("Down") ? -1 : 1)) {
                        if field == "e" {
                            Text(c.tv?["effort"] ?? "RIR").lineLimit(1).minimumScaleFactor(0.7)
                        } else {
                            HStack(spacing: 1) {
                                Image(systemName: k.hasSuffix("Down") ? "minus" : "plus")
                                Image(systemName: field == "w" ? "scalemass" : "repeat").font(.caption2)
                            }
                        }
                    }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
                }
            }
        case "prev", "warm", "addSet", "pause":
            if let c = state.cur {
                queueButton(k, c: c, label: label, accent: accent)
            } else if k == "pause" {
                Button(intent: LiveQueueIntent(wid: wid, kind: k, exId: "", entryIdx: 0, setIdx: 0)) { Image(systemName: state.paused == true ? "play.fill" : "pause.fill") }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
            }
        case "finish":
            if let url = URL(string: "opengym://start?do=finish") {
                Link(destination: url) { Image(systemName: "flag.checkered") }
                    .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
            }
        default:
            EmptyView()
        }
    }

    private func queueButton(_ k: String, c: WorkoutActivityAttributes.SetInfo, label: Text, accent: Color) -> some View {
        let icon = k == "prev" ? "backward.end.fill" : k == "warm" ? "sunrise.fill" : k == "addSet" ? "plus.circle" : (state.paused == true ? "play.fill" : "pause.fill")
        return Button(intent: LiveQueueIntent(wid: attributes.wid, kind: k, exId: c.exId, entryIdx: c.entryIdx, setIdx: c.setIdx)) { Image(systemName: icon) }
            .buttonStyle(.bordered).tint(accent).accessibilityLabel(label)
    }
}

// MARK: - the glance (LIVE_VERSION 4, lib/live-glance.js glanceView)

@available(iOS 16.1, *)
extension WorkoutActivityAttributes.SetInfo {
    /// The big line: weight × reps for a plain lift (− and + rewrite both in place), else the set's own.
    var big: String {
        if kd == nil, bg == nil, let w = tv?["weight"], let r = tv?["reps"], !w.isEmpty, !r.isEmpty { return "\(w) × \(r)" }
        return bg ?? target
    }

    /// A few letters for the Dynamic Island's pill: "80×8", "45 s", "20 min".
    var short: String {
        if kd == nil, sh == nil, let w = tv?["weight"], let r = tv?["reps"], !w.isEmpty, !r.isEmpty {
            let number = w.split(separator: " ").first.map(String.init) ?? w
            return "\(number)×\(r)"
        }
        return sh ?? ""
    }
}

/// One detail beside the set: its key (the heart rate gets its icon) and its words.
struct GlanceChip: Hashable {
    let k: String
    let t: String
}

/// A − + pair drawn beside its number ("w" the weight, "r" the reps) and the number as shown.
struct GlanceStep: Hashable {
    let f: String
    let t: String
}

/**
 * What a surface draws now, worked out from the state the page sent (or the activity moved on to
 * by itself): the moment, the words, the details and the buttons that mean something. The same
 * rules as lib/live-glance.js glanceView, which draws Settings' preview.
 */
@available(iOS 16.1, *)
struct GlanceModel {
    enum Phase { case work, hold, rest, between, done }
    var phase: Phase = .done
    var heading = ""
    var next: String?
    var title = ""
    var sub = ""
    var big = ""
    var chips: [GlanceChip] = []
    var note: String?
    var progress: Double?
    var buttons: [String] = []
    var still: String?
    var elapsed = false
    /// The time since the start, small, under a rest's or a hold's clock ("Time since start" on).
    var since = false
    /// Weight and reps as steppers in place of the big line (a plain lift with both pairs on).
    var steps: [GlanceStep] = []
    /// "Log set" in words: only when it is the only button.
    var logWords = true

    /// A clock counts down in this moment (a rest or a hold), drawn by Text(timerInterval:).
    var timed: Bool { phase == .hold || phase == .rest || phase == .between }

    static let priority = ["log", "wDown", "wUp", "rDown", "rUp", "effort", "restAdd", "restSkip", "next", "pause", "warm", "addSet", "finish"]

    init(_ a: WorkoutActivityAttributes, _ s: WorkoutActivityAttributes.ContentState, room: Int) {
        let g = s.g ?? WorkoutActivityAttributes.Glance()
        let total = max(0, s.total)
        let done = min(total, max(0, s.done))
        if g.lk == "detailed" { progress = total > 0 ? Double(done) / Double(total) : 0 }
        let detailRoom = g.lk == "clean" ? 2 : 4
        func chipsOf(_ set: WorkoutActivityAttributes.SetInfo?) -> [GlanceChip] {
            var list: [GlanceChip] = []
            for k in set?.ck ?? [] { if let v = set?.tv?[k], !v.isEmpty { list.append(GlanceChip(k: k, t: v)) } }
            for k in g.sx ?? [] { if let v = s.tv?[k], !v.isEmpty { list.append(GlanceChip(k: k, t: v)) } }
            return Array(list.prefix(detailRoom))
        }
        guard let cur = s.cur else {
            phase = .done
            title = a.noSetText(s)
            sub = s.name
            elapsed = g.el == true
            buttons = ["finish"]
            return
        }
        still = g.pic == true ? cur.img : nil
        var list: [String]
        if s.holding {
            phase = .hold
            heading = a.clockLabel(s)
            title = cur.exName
            sub = cur.setLine
            big = cur.big
            // Stop auto comes from LiveButtonsView itself while a chain runs.
            list = ["log"]
            since = g.el == true
        } else if s.resting {
            phase = cur.fr == true ? .between : .rest
            heading = a.labels.rest
            if g.nx != false {
                next = phase == .between ? (s.tl?["nextEx"] ?? a.labels.nextExercise ?? a.labels.next) : a.labels.next
                title = cur.exName
                sub = cur.setLine
                big = cur.big
            } else {
                title = s.name
            }
            chips = chipsOf(nil)
            since = g.el == true
            list = g.rb ?? ["log", "restSkip"]
        } else {
            phase = .work
            title = cur.exName
            sub = cur.setLine
            big = cur.big
            chips = chipsOf(cur)
            if g.lk == "detailed", let pr = cur.tv?["pr"], !pr.isEmpty { note = pr }
            elapsed = g.el == true
            list = cur.b ?? ["log"]
        }
        let fields = ["wDown": "w", "wUp": "w", "rDown": "r", "rUp": "r", "effort": "e"]
        list = list.filter { k in
            if k == "next" { return s.nextUnitStart != nil }
            if let f = fields[k] { return cur.adj?[f] != nil }
            if k == "restAdd" || k == "restSkip" { return s.resting }
            return true
        }
        let rank = { (k: String) -> Int in GlanceModel.priority.firstIndex(of: k) ?? GlanceModel.priority.count }
        var seen = Set<String>()
        list = list.filter { seen.insert($0).inserted }.sorted { rank($0) < rank($1) }
        // A plain lift's − + pairs as steppers beside the numbers: four − + buttons in the row left
        // no room for anything else and squeezed it (TestFlight 67). Both pairs or none.
        if phase == .work, cur.kd == nil, cur.bg == nil, let w = cur.tv?["weight"], let r = cur.tv?["reps"], !w.isEmpty, !r.isEmpty {
            var found: [GlanceStep] = []
            for (f, down, up) in [("w", "wDown", "wUp"), ("r", "rDown", "rUp")] {
                guard list.contains(down), list.contains(up), let a = cur.adj?[f] else { continue }
                let shown = a.t.indices.contains(a.i) ? a.t[a.i] : (f == "w" ? w : r)
                found.append(GlanceStep(f: f, t: shown))
            }
            if found.count == 2 {
                steps = found
                list = list.filter { fields[$0] == nil || $0 == "effort" }
            }
        }
        buttons = Array(list.prefix(max(1, room)))
        // Room on the Lock Screen (160 points): with the still or the steppers, the record line goes
        // first, never the numbers or the buttons.
        if still != nil || !steps.isEmpty { note = nil }
        logWords = buttons.count == 1 && steps.isEmpty
    }

    /// The buttons as iOS lays them out: the quiet ones first, the primary (Log set, Finish) last.
    var shown: [String] { buttons.filter { $0 != "log" && $0 != "finish" } + buttons.filter { $0 == "log" || $0 == "finish" } }
}

/// The details in one line: "RIR 2 · ♥ 132 bpm · Zone 3".
@available(iOS 17.0, *)
struct GlanceChips: View {
    let chips: [GlanceChip]
    let hs: String?
    var note: String? = nil

    var body: some View {
        HStack(spacing: 10) {
            ForEach(chips, id: \.self) { c in
                HStack(spacing: 3) {
                    if c.k == "hr" { Image(systemName: hs == "watch" ? "applewatch" : "heart.fill").foregroundStyle(.red).font(.caption2) }
                    Text(c.t).monospacedDigit()
                }
            }
            if let n = note {
                Label(n, systemImage: "trophy.fill").labelStyle(.titleAndIcon)
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

/// The time since the start, ticking by itself (Text(style: .timer)), or a pause sign while paused.
@available(iOS 17.0, *)
struct GlanceElapsed: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    /// Under a rest's clock: smaller, so the countdown stays the big thing.
    var small: Bool = false

    var body: some View {
        if let s = attributes.start, s.isFinite, s > 0 {
            HStack(spacing: 3) {
                Image(systemName: state.paused == true ? "pause.fill" : "stopwatch")
                if state.paused != true {
                    Text(Date(timeIntervalSince1970: s / 1000), style: .timer).monospacedDigit()
                }
            }
            .font(small ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: 96, alignment: small ? .leading : .trailing)
            .accessibilityLabel(Text(state.label("elapsed")))
        }
    }
}

/// Weight and reps with their − and + beside them: "− 80 kg + × − 8 +", then the set's line while it
/// fits. The numbers are never cut (fixedSize); the set's line is left out first.
@available(iOS 17.0, *)
struct GlanceSteps: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    let steps: [GlanceStep]
    var sub: String = ""

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(withSub: !sub.isEmpty)
            row(withSub: false)
        }
    }

    private func row(withSub: Bool) -> some View {
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
        return HStack(spacing: 6) {
            ForEach(steps, id: \.self) { s in
                if s.f == "r" && steps.count > 1 {
                    Text("\u{00d7}").font(.headline).foregroundStyle(.secondary)
                }
                stepButton(s.f, dir: -1, accent: accent)
                Text(s.t).font(.system(.title3, design: .rounded).weight(.bold)).monospacedDigit()
                    .lineLimit(1).fixedSize()
                    .contentTransition(.numericText())
                stepButton(s.f, dir: 1, accent: accent)
            }
            if withSub {
                Spacer(minLength: 4)
                Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                    .contentTransition(.identity)
            }
        }
    }

    @ViewBuilder
    private func stepButton(_ f: String, dir: Int, accent: Color) -> some View {
        if let c = state.cur {
            Button(intent: AdjustSetIntent(wid: attributes.wid, entryIdx: c.entryIdx, setIdx: c.setIdx, field: f, dir: dir)) {
                Image(systemName: dir < 0 ? "minus" : "plus").font(.subheadline.weight(.bold))
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.circle)
            .tint(accent)
            .accessibilityLabel(Text(state.label("a." + f + (dir < 0 ? "Down" : "Up"))))
        }
    }
}

/// The Lock Screen (and an Apple Watch's Smart Stack): about 160 points tall at most.
///
/// A tap changes the moment (a set to a rest) and with it the whole layout. Left alone, iOS
/// fades the old views out and the new ones in and blurs every changed text over, up to two
/// seconds in all, so the card looked slow. Here the layout swaps at once (`.transition(.identity)`
/// on what comes and goes), words change without the blur (`.contentTransition(.identity)`), and
/// only the numbers roll (`.numericText()`). The clocks are left to iOS.
@available(iOS 17.0, *)
struct GlanceLockView: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let g = GlanceModel(attributes, state, room: 4)
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
        VStack(alignment: .leading, spacing: 6) {
            if g.timed {
                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(g.heading).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                        LiveRest(attributes: attributes, state: state, font: .largeTitle, align: .leading)
                            .frame(maxWidth: 118, alignment: .leading)
                        if g.since { GlanceElapsed(attributes: attributes, state: state, small: true) }
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        if let n = g.next { Text(n).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1) }
                        Text(g.title).font(.headline).lineLimit(1)
                        if !g.big.isEmpty { Text(g.big).font(.subheadline.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.75) }
                        if !g.sub.isEmpty { Text(g.sub).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    }
                    .contentTransition(.identity)
                    Spacer(minLength: 0)
                }
                .transition(.identity)
            } else if !g.steps.isEmpty {
                // Steppers: the title on one line (a small still before it), the numbers with their
                // − and + in place of the big line.
                HStack(alignment: .center, spacing: 8) {
                    if let p = g.still { LiveStillView(path: p, size: 28) }
                    Text(g.title).font(.headline).lineLimit(1).contentTransition(.identity)
                    Spacer(minLength: 6)
                    if g.elapsed { GlanceElapsed(attributes: attributes, state: state) }
                }
                .transition(.identity)
                GlanceSteps(attributes: attributes, state: state, steps: g.steps, sub: g.sub)
                    .transition(.identity)
            } else {
                HStack(alignment: .top, spacing: 10) {
                    if let p = g.still { LiveStillView(path: p, size: 44) }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(g.title).font(.headline).lineLimit(1)
                        if g.still != nil && !g.big.isEmpty {
                            // With the still, the numbers sit beside it under the title.
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(g.big).font(.system(.title3, design: .rounded).weight(.bold)).monospacedDigit()
                                    .lineLimit(1).minimumScaleFactor(0.6).layoutPriority(1)
                                    .contentTransition(.numericText())
                                if !g.sub.isEmpty { Text(g.sub).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                            }
                        } else if g.big.isEmpty && !g.sub.isEmpty {
                            Text(g.sub).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .contentTransition(.identity)
                    Spacer(minLength: 6)
                    if g.elapsed { GlanceElapsed(attributes: attributes, state: state) }
                }
                .transition(.identity)
                if g.still == nil && !g.big.isEmpty {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(g.big).font(.system(.title2, design: .rounded).weight(.bold)).monospacedDigit()
                            .lineLimit(1).minimumScaleFactor(0.6)
                            .contentTransition(.numericText())
                        Spacer(minLength: 4)
                        if !g.sub.isEmpty { Text(g.sub).font(.subheadline).foregroundStyle(.secondary).lineLimit(1).fixedSize().contentTransition(.identity) }
                    }
                    .transition(.identity)
                }
            }
            if !g.chips.isEmpty || g.note != nil {
                GlanceChips(chips: g.chips, hs: state.hs, note: g.note)
                    .transition(.identity)
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                if let p = g.progress { ProgressBar(value: p, accent: accent) } else { Spacer(minLength: 0) }
                LiveButtonsView(attributes: attributes, state: state, acts: g.shown, logWords: g.logWords)
            }
        }
        .padding(14)
    }
}

/// The Dynamic Island's pill: the still or the mark, then the clock or the set in a few letters.
@available(iOS 17.0, *)
struct GlanceCompactLeading: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        if state.g?.pic == true, let p = state.cur?.img, LiveStills.image(p) != nil {
            LiveStillView(path: p, size: 24)
        } else {
            OpenGymMark()
        }
    }
}

@available(iOS 17.0, *)
struct GlanceCompactTrailing: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .openGymGreen
        if state.holding || state.resting {
            LiveRest(attributes: attributes, state: state, font: .caption).frame(maxWidth: 52)
        } else if let c = state.cur, !c.short.isEmpty {
            Text(c.short).font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(accent)
                .lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: 64)
        } else {
            Text("\(state.done)/\(state.total)").font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(accent)
        }
    }
}

/// The view a long press on the island opens.
@available(iOS 17.0, *)
struct GlanceIslandLeading: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let g = GlanceModel(attributes, state, room: 3)
        VStack(alignment: .leading, spacing: 1) {
            if let n = g.next { Text(n).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1) }
            Text(g.title).font(.headline).lineLimit(1).minimumScaleFactor(0.75)
            if !g.sub.isEmpty { Text(g.sub).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
        }
        // Words change at once, without iOS's blur from the old to the new (see GlanceLockView).
        .contentTransition(.identity)
        .padding(.leading, 4)
    }
}

@available(iOS 17.0, *)
struct GlanceIslandTrailing: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let g = GlanceModel(attributes, state, room: 3)
        Group {
            if g.timed {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(g.heading).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    LiveRest(attributes: attributes, state: state, font: .title3)
                }
                .frame(maxWidth: 88, alignment: .trailing)
                .transition(.identity)
            } else if g.elapsed {
                GlanceElapsed(attributes: attributes, state: state)
                    .transition(.identity)
            } else if !g.big.isEmpty && g.steps.isEmpty {
                Text(g.big).font(.subheadline.weight(.bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                    .contentTransition(.numericText())
                    .transition(.identity)
            }
        }
        .padding(.trailing, 4)
    }
}

@available(iOS 17.0, *)
struct GlanceIslandBottom: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let g = GlanceModel(attributes, state, room: 3)
        VStack(alignment: .leading, spacing: 6) {
            if !g.steps.isEmpty {
                GlanceSteps(attributes: attributes, state: state, steps: g.steps)
                    .transition(.identity)
            } else if (g.timed || g.elapsed) && !g.big.isEmpty {
                Text(g.big).font(.subheadline.weight(.semibold)).monospacedDigit().lineLimit(1)
                    .contentTransition(.identity)
                    .transition(.identity)
            }
            HStack(spacing: 8) {
                GlanceChips(chips: Array(g.chips.prefix(g.buttons.count >= 3 ? 1 : 2)), hs: state.hs)
                Spacer(minLength: 0)
                LiveButtonsView(attributes: attributes, state: state, acts: g.shown, logWords: g.logWords)
            }
        }
    }
}

// MARK: - the logo

/// openGym's logo mark (assets/logo/opengym-mark.svg): five plain rectangles on a 352 x 174 grid,
/// square corners. Where the app shows who it is (the Dynamic Island, an empty widget), not an SF Symbol.
struct OpenGymMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        let boxes: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (0, 73, 352, 28), (0, 30, 36, 114), (51, 0, 47, 174), (254, 0, 47, 174), (316, 30, 36, 114),
        ]
        let scale = min(rect.width / 352, rect.height / 174)
        let ox = rect.midX - 176 * scale, oy = rect.midY - 87 * scale
        var p = Path()
        for (x, y, w, h) in boxes { p.addRect(CGRect(x: ox + x * scale, y: oy + y * scale, width: w * scale, height: h * scale)) }
        return p
    }
}

/// The mark in brand green (#A3E635), `width` points wide. The logo's colour, never the accent.
struct OpenGymMark: View {
    var width: CGFloat = 20

    var body: some View {
        OpenGymMarkShape()
            .fill(Color(red: 163 / 255, green: 230 / 255, blue: 53 / 255))
            .frame(width: width, height: width * 174 / 352)
            .accessibilityHidden(true)
    }
}
