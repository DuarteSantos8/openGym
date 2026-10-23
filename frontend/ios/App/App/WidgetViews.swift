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
    }

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
}

@available(iOS 17.0, *)
extension Color {
    func darker(_ by: CGFloat) -> Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return Color(red: r * (1 - by), green: g * (1 - by), blue: b * (1 - by))
    }

    init?(hex: String?) {
        guard let hex = hex, hex.count == 7, hex.hasPrefix("#"), let n = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
    }
}

/// The accent, a shade darker on a light background so it still reads there.
@available(iOS 17.0, *)
struct AccentText: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    let color: Color
    func body(content: Content) -> some View {
        content.foregroundStyle(scheme == .light ? color.darker(0.28) : color)
    }
}

@available(iOS 17.0, *)
extension View {
    func accentText(_ color: Color) -> some View { modifier(AccentText(color: color)) }
}

// MARK: - pieces

/// A slim bar in the accent (drawn by SwiftUI itself, so it also renders into CI's pictures).
@available(iOS 17.0, *)
struct ProgressBar: View {
    let value: Double
    let accent: Color

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(accent.opacity(0.22))
                Capsule().fill(accent).frame(width: max(6, g.size.width * min(1, max(0, value))))
            }
        }
        .frame(height: 6)
    }
}

@available(iOS 17.0, *)
struct WeekRing: View {
    let done: Int
    let planned: Int
    let accent: Color
    var size: CGFloat = 56

    var body: some View {
        let frac = planned > 0 ? min(1, Double(done) / Double(planned)) : (done > 0 ? 1 : 0)
        ZStack {
            Circle().stroke(accent.opacity(0.22), lineWidth: size / 7)
            Circle().trim(from: 0, to: frac)
                .stroke(accent, style: StrokeStyle(lineWidth: size / 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
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
    let model: WidgetModel

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "dumbbell.fill").font(.caption2.weight(.bold)).accentText(model.accent)
            Text((model.active != nil ? model.labels.running : model.labels.today) ?? "Today")
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
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
                        .font(.title3.weight(.semibold)).monospacedDigit().accentText(model.accent)
                }
                ProgressBar(value: Double(a.done) / Double(max(1, a.total)), accent: model.accent)
            } else if let d = model.day, let name = d.name {
                Text(name).font(big ? .title2.weight(.bold) : .title3.weight(.bold)).lineLimit(2).minimumScaleFactor(0.75)
                if d.done == true {
                    Label(model.labels.done ?? "Done", systemImage: "checkmark.circle.fill")
                        .font(.caption.weight(.semibold)).accentText(model.accent)
                } else if let n = d.count, n > 0 {
                    Label("\(n)", systemImage: "list.bullet").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Text(model.labels.restDay ?? "Rest day").font(big ? .title2.weight(.bold) : .title3.weight(.bold)).lineLimit(1).minimumScaleFactor(0.75)
                if let n = model.next {
                    Text("\(model.labels.upNext ?? "Up next"): \(n.weekday ?? "")")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
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
            Image(systemName: "flame.fill").foregroundStyle(.orange)
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
            Image(systemName: "dumbbell.fill").font(.title3).foregroundStyle(.secondary)
            Text("Open openGym once to see your plan here.").font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

@available(iOS 17.0, *)
struct SmallWidgetView: View {
    let model: WidgetModel
    var body: some View {
        if model.snap == nil { WidgetEmpty() } else {
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
                SmallWidgetView(model: model)
                VStack(spacing: 8) {
                    Text(model.labels.thisWeek ?? "This week").font(.caption2.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary).lineLimit(1)
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
        if model.snap == nil { WidgetEmpty() } else {
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
                                Text(ex.line ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
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
                                Text(model.labels.lastPR ?? "Last PR").font(.caption2).foregroundStyle(.secondary)
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

// MARK: - the Live Activity

@available(iOS 17.0, *)
struct LiveRest: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState
    var font: Font = .title2

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .green
        if let range = state.restRange {
            Text(timerInterval: range, countsDown: true)
                .font(font.weight(.bold)).monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(accent)
        } else if let left = state.restLeft {
            Label(String(format: "%d:%02d", Int(left) / 60, Int(left) % 60), systemImage: "pause.fill")
                .font(font.weight(.bold)).monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }
}

@available(iOS 17.0, *)
struct LiveDoneButton: View {
    let attributes: WorkoutActivityAttributes
    let cur: WorkoutActivityAttributes.SetInfo

    var body: some View {
        Button(intent: DoneSetIntent(wid: attributes.wid, exId: cur.exId, entryIdx: cur.entryIdx, setIdx: cur.setIdx)) {
            Label(attributes.labels.done, systemImage: "checkmark")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color(hex: attributes.ink) ?? .black)
        }
        .buttonStyle(.borderedProminent)
        .tint(Color(hex: attributes.accent) ?? .green)
    }
}

/// The Lock Screen's (and a watch Smart Stack's, through the compact views) workout.
@available(iOS 17.0, *)
struct LiveLockView: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        let accent = Color(hex: attributes.accent) ?? .green
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.cur?.exName ?? attributes.labels.allDone).font(.headline).lineLimit(1)
                    if let c = state.cur {
                        Text([c.setLine, c.target].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    } else {
                        Text(state.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if state.restRange != nil || state.restLeft != nil {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(attributes.labels.rest).font(.caption2.weight(.semibold)).textCase(.uppercase).foregroundStyle(.secondary)
                        LiveRest(attributes: attributes, state: state).frame(maxWidth: 96, alignment: .trailing)
                    }
                }
            }
            HStack(spacing: 10) {
                ProgressBar(value: Double(state.done) / Double(max(1, state.total)), accent: accent)
                Text("\(state.done)/\(state.total)").font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(.secondary)
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
        if state.restRange != nil || state.restLeft != nil {
            LiveRest(attributes: attributes, state: state, font: .caption).frame(width: 46)
        } else {
            Text("\(state.done)/\(state.total)").font(.caption.weight(.bold)).monospacedDigit()
                .foregroundStyle(Color(hex: attributes.accent) ?? .green)
        }
    }
}

@available(iOS 17.0, *)
struct LiveMinimal: View {
    let attributes: WorkoutActivityAttributes
    let state: WorkoutActivityAttributes.ContentState

    var body: some View {
        if let range = state.restRange {
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
