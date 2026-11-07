import SwiftUI
import WatchKit

/*
 * The screens around the set: the Metrics page beside it and the music after that, the weigh-in
 * before a workout started here, "All done?" when nothing was logged for a while, and the summary
 * at the end. Same look as the rest: black, grey boxes, the accent on the one thing to press.
 */

/* ---------- Metrics: the numbers of the whole workout, like Apple Workout's ---------- */

struct MetricsPage: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.locale) private var locale
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        GeometryReader { g in
            // The time is the hero; the rows follow the screen's height, so 45 mm and up are filled.
            let hero = min(56, max(34, g.size.height * 0.27))
            let row = min(34, max(22, g.size.height * 0.15))
            VStack(alignment: .leading, spacing: 0) {
                if let start = store.workoutStart {
                    // Paused on the phone (#976): the clock stands at the pause.
                    Text(timerInterval: start...Date.distantFuture, pauseTime: store.workoutPausedAt, countsDown: false)
                        .font(.system(size: hero, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.yellow.opacity(dimmed ? 0.75 : 1))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .accessibilityLabel(Text("Time"))
                }
                HealthRows(health: store.health, size: row, showHr: store.show.showHr)
                if let w = store.workout {
                    let s = SessionCore.summary(w, end: Date().timeIntervalSince1970 * 1000)
                    let p = store.progress
                    if s.volume > 0 {
                        metric(Text(verbatim: s.volume.formatted(.number.precision(.fractionLength(0)).locale(locale))),
                               unit: Text(verbatim: w.unit), size: row, color: .white)
                            .accessibilityLabel(Text("Volume"))
                    }
                    metric(Text(verbatim: "\(p.done)/\(p.total)"), unit: Text("Sets"), size: row, color: .white)
                }
                Spacer(minLength: 0)
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
        }
        .padding(.horizontal, 4)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func metric(_ value: Text, unit: Text, size: CGFloat, color: Color) -> some View {
        MetricRow(value: value, unit: unit, size: size, color: color)
    }
}

/// One row of the Metrics page: the number big, its unit small, tight like Apple's.
struct MetricRow: View {
    let value: Text
    let unit: Text
    let size: CGFloat
    let color: Color
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            value.font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
            unit.font(.system(size: max(10, size * 0.42), weight: .semibold, design: .rounded)).textCase(.uppercase)
        }
        .foregroundStyle(color.opacity(dimmed ? 0.75 : 1))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        // Digits have no descenders: the rows sit closer than their font's own height.
        .frame(height: size * 0.95, alignment: .bottomLeading)
        .accessibilityElement(children: .combine)
    }
}

/// The heart rate and the calories, redrawn only when they change (WorkoutManager throttles).
struct HealthRows: View {
    @ObservedObject var health: WorkoutManager
    let size: CGFloat
    let showHr: Bool

    var body: some View {
        if health.enabled || health.running {
            if showHr {
                MetricRow(value: Text(verbatim: health.heartRate.map { "\(Int($0.rounded()))" } ?? "‒‒"),
                          unit: Text(Image(systemName: "heart.fill")), size: size, color: Theme.red)
                    .accessibilityLabel(Text("Heart rate"))
            }
            MetricRow(value: Text(verbatim: health.calories.map { "\(Int($0))" } ?? "‒‒"),
                      unit: Text(verbatim: "kcal"), size: size, color: .white)
                .accessibilityLabel(Text("Calories"))
        }
    }
}

/// Apple's own player, one page after Metrics: play, skip and volume without leaving the workout.
struct MusicPage: View {
    var body: some View {
        NowPlayingView()
    }
}

/* ---------- "Still training?": nothing logged for a while, or the phone left the gym ---------- */

/// A card instead of a system alert (forgotten workouts, the phone's lib/forgotten-workout.js).
/// Finish goes to the Overview's hold, so nothing ends in one tap; a set logged on the phone (or a
/// rest, a hold) takes the card away by itself. Nobody answers: the workout ends by itself at the
/// time it says, saved at its last set plus the rest.
struct IdlePrompt: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent

    private var endsAt: String {
        (store.idleEndsAt ?? Date()).formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(store.locale))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: store.idleLeft ? "figure.walk.departure" : "hourglass")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(accent)
                    .accessibilityHidden(true)
                Text(store.idleLeft ? LocalizedStringKey("Looks like you left the gym") : LocalizedStringKey("Still training?"))
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Group {
                    if store.idleLeft {
                        Text("Finish the workout now? Otherwise it ends by itself at \(endsAt).")
                    } else {
                        Text("Nothing logged for a while. If you’re done, it ends by itself at \(endsAt), saved at your last set.")
                    }
                }
                .font(.footnote)
                .foregroundStyle(Theme.label2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                if store.idleLeft {
                    Button {
                        store.keepGoing()
                        store.tab = .overview
                    } label: { Text("Finish now").frame(maxWidth: .infinity) }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 4)
                    Button { store.keepGoing() } label: { Text("Keep going").frame(maxWidth: .infinity) }
                        .buttonStyle(RowButtonStyle())
                } else {
                    Button { store.keepGoing() } label: { Text("Keep going") }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 4)
                    Button {
                        store.keepGoing()
                        store.tab = .overview
                    } label: {
                        Text("Finish workout").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(RowButtonStyle())
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

/* ---------- the weigh-in ---------- */

/// The weigh-in before a workout started here, as the phone asks for it: the body weight in one
/// box, the crown on the whole units, a tap on the tenth hands the crown to it (one crown in
/// tenths ran a whole kilo away in a flick). Save & start, or start without.
struct WeighInView: View {
    @EnvironmentObject var store: SessionStore
    enum Part: Hashable { case whole, tenth }
    @FocusState private var part: Part?
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 40
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed

    private var whole: Binding<Double> {
        Binding(get: { WeighIn.parts(store.bodyWeight).whole },
                set: { store.bodyWeight = WeighIn.join(whole: $0, tenth: WeighIn.parts(store.bodyWeight).tenth) })
    }
    private var tenth: Binding<Double> {
        Binding(get: { WeighIn.parts(store.bodyWeight).tenth },
                set: { store.bodyWeight = WeighIn.join(whole: WeighIn.parts(store.bodyWeight).whole, tenth: $0) })
    }

    var body: some View {
        let p = WeighIn.parts(store.bodyWeight)
        NavigationStack {
            ScrollView {
                VStack(spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        digits(String(Int(p.whole)), .whole, whole, 20...(store.unit == "lb" ? 700 : 320))
                        Text(verbatim: ".").font(.system(size: size, weight: .semibold, design: .rounded)).foregroundStyle(Theme.label2)
                        digits(String(Int(p.tenth)), .tenth, tenth, 0...9)
                        Text(verbatim: " " + store.unit).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundStyle(Theme.label2)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(dimmed ? Color.clear : Theme.surface))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.surface2, lineWidth: dimmed ? 1 : 0))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text("Body weight"))
                    .accessibilityValue(Text(verbatim: String(format: "%.1f %@", store.bodyWeight, store.unit)))
                    .accessibilityHint(Text("Turn the Digital Crown to change it."))
                    .accessibilityAdjustableAction { d in
                        let v = store.bodyWeight + (d == .increment ? 0.1 : -0.1)
                        let q = WeighIn.parts(v)
                        store.bodyWeight = WeighIn.join(whole: q.whole, tenth: q.tenth)
                    }
                    Button { store.finishWeighIn(save: true) } label: { Text("Save & start workout") }
                        .buttonStyle(PrimaryButtonStyle())
                    Button { store.finishWeighIn(save: false) } label: {
                        Text("Start without weighing in").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(RowButtonStyle())
                    Button(role: .cancel) { store.cancelWeighIn() } label: {
                        Text("Cancel").font(.footnote).frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.label2)
                }
                .padding(.horizontal, 2)
            }
            .navigationTitle(Text("Quick check-in"))
        }
        .onAppear { part = .whole }
    }

    /// One part of the number: the one the crown turns is in the accent on a lighter tile, a tap
    /// on the other one hands the crown to it.
    private func digits(_ text: String, _ which: Part, _ value: Binding<Double>, _ range: ClosedRange<Double>) -> some View {
        let on = part == which
        return Text(verbatim: text)
            .font(.system(size: which == .whole ? size : size * 0.8, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(on ? accent : Color.white)
            .contentTransition(.numericText())
            .padding(.horizontal, 4)
            .frame(minWidth: Theme.tap * 0.7, minHeight: Theme.tap)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on && !dimmed ? Theme.surface2 : Color.clear))
            .contentShape(Rectangle())
            .focusable()
            .focused($part, equals: which)
            .digitalCrownRotation(value, from: range.lowerBound, through: range.upperBound, by: 1,
                                  sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
            .onTapGesture { part = which }
    }
}

/* ---------- the end of a workout ---------- */

/// "Workout saved", the time big, sets and volume, the records, then heart rate and calories,
/// which Apple Health fills in a moment later (last, so nothing above moves when they come).
/// Done ignores taps for its first second: the thumb on Finish is still on the glass.
struct SummaryView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.locale) private var locale
    @Environment(\.accent) private var accent
    @State private var shownAt = Date()
    let summary: WorkoutSummary

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Image(systemName: summary.endedOnPhone ? "iphone" : "checkmark.circle.fill")
                            .foregroundStyle(accent)
                            .accessibilityHidden(true)
                        Text(summary.endedOnPhone ? LocalizedStringKey("Ended on your iPhone") : LocalizedStringKey("Workout saved"))
                            .font(.system(.headline, design: .rounded))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(verbatim: summary.name).font(.footnote).foregroundStyle(Theme.label2)
                    if let d = summary.duration {
                        VStack(alignment: .leading, spacing: -2) {
                            Text("Time").font(.caption2).foregroundStyle(Theme.label2)
                            Text(verbatim: SummaryView.duration(d, locale: locale))
                                .font(.system(size: 32, weight: .semibold, design: .rounded).monospacedDigit())
                                .foregroundStyle(Theme.yellow)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    HStack(alignment: .top, spacing: 12) {
                        stat(Text("Sets"), Text(verbatim: "\(summary.sets)"))
                        if summary.volume > 0 {
                            stat(Text("Volume"), Text(verbatim: "\(summary.volume.formatted(.number.precision(.fractionLength(0)).locale(locale))) \(summary.unit)"))
                        }
                    }
                    if !summary.prs.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Label { Text("Personal records") } icon: { Image(systemName: "trophy.fill").foregroundStyle(Theme.yellow) }
                                .font(.caption.weight(.semibold))
                            ForEach(summary.prs, id: \.self) { name in
                                Text(verbatim: name).font(.footnote)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .padding(.top, 2)
                    }
                    if let avg = summary.hrAvg, let top = summary.hrMax {
                        stat(Text("Heart rate"), Text("\(Int(avg)) avg · \(Int(top)) max"), color: Theme.red)
                    }
                    if let kcal = summary.calories {
                        stat(Text("Calories"), Text(Measurement(value: kcal, unit: UnitEnergy.kilocalories),
                                                    format: .measurement(width: .abbreviated, usage: .asProvided,
                                                                         numberFormatStyle: .number.precision(.fractionLength(0))).locale(locale)))
                    }
                    SyncLine().padding(.top, 2)
                    Button {
                        guard Date().timeIntervalSince(shownAt) >= 1 else { return }
                        store.closeSummary()
                    } label: { Text("Done") }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.top, 4)
                        .id("done")
                }
                .padding(.horizontal, 4)
                // The title starts under the clock, not beside it (it ran into the time on 41 mm).
                .padding(.top, 14)
            }
            // CI: the end of the summary too (heart rate, calories, records).
            .onAppear {
                shownAt = Date()
                if SessionStore.demoScreen == "summary-end" { reader.scrollTo("done", anchor: .bottom) }
            }
        }
    }

    private func stat(_ label: Text, _ value: Text, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label.font(.caption2).foregroundStyle(Theme.label2)
            value.font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit()).foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    /// "52 min", "1 h 5 min", in the app's language.
    static func duration(_ seconds: Double, locale: Locale = .current) -> String {
        let f = DateComponentsFormatter()
        var calendar = Calendar.current
        calendar.locale = locale
        f.calendar = calendar
        f.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        f.unitsStyle = .short
        return f.string(from: max(60, seconds)) ?? ""
    }
}
