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
    @ObservedObject var health: WorkoutManager // its rows come and go, and the sizes follow how many there are
    @Environment(\.locale) private var locale
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        GeometryReader { g in
            let w = store.workout
            let volume = w.map { SessionCore.summary($0, end: Date().timeIntervalSince1970 * 1000).volume } ?? 0
            let healthRows = health.enabled || health.running ? (store.show.showHr ? 1 : 0) + (store.show.showKcal ? 1 : 0) : 0
            let rows = healthRows + (volume > 0 ? 1 : 0) + (w != nil ? 1 : 0)
            // The time is the hero (1.7 rows, 1.2 of its size tall); the rows share what is left of the
            // screen's height, so the page is filled down to the dots whatever the settings hide.
            // The page runs under the bottom safe area, down to the page dots (12 pt); the top stays below the system badges.
            let unit = (g.size.height - 12) / (2.04 + 0.95 * CGFloat(max(rows, 1)))
            let hero = min(68, 1.7 * unit)
            let row = min(40, unit)
            VStack(alignment: .leading, spacing: 0) {
                if let start = store.workoutStart {
                    // Paused on the phone (#976): the clock stands at the pause.
                    Text(timerInterval: SafeNum.timerRange(start, Date.distantFuture), pauseTime: store.workoutPausedAt, countsDown: false)
                        .font(.system(size: hero, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.yellow.opacity(dimmed ? 0.75 : 1))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .accessibilityLabel(Text("Time"))
                }
                HealthRows(health: health, size: row, showHr: store.show.showHr, showKcal: store.show.showKcal)
                if let w {
                    let p = store.progress
                    if volume > 0 {
                        metric(Text(verbatim: volume.formatted(.number.precision(.fractionLength(0)).locale(locale))),
                               unit: Text(verbatim: w.unit), size: row, color: .white)
                            .accessibilityLabel(Text("Volume"))
                    }
                    metric(Text(verbatim: "\(p.done)/\(p.total)"), unit: Text("Sets"), size: row, color: .white)
                }
                Spacer(minLength: 0)
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea(edges: .bottom)
        .clearOfPageDots()
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func metric(_ value: Text, unit: Text, size: CGFloat, color: Color) -> some View {
        MetricRow(value: value, unit: unit, size: size, color: color)
    }
}

/// Metrics is a vertical stack: Summary, Pulse, Effort. The Crown or a vertical swipe moves it (the system's
/// page dots); sideways still goes to the neighbouring pages. Wrist down: back to the Summary.
struct MetricsStack: View {
    enum Part { case summary, pulse, effort }
    @EnvironmentObject var store: SessionStore
    @ObservedObject var health: WorkoutManager // store.health is a plain let: the pager must see `running` itself to add Pulse
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var part = SessionStore.demoMetricsPart
    /// Without Apple Health (off, or no reading allowed) there is no heart rate to chart, and the setting can hide it.
    private var hasPulse: Bool { health.running && store.show.showHr }

    var body: some View {
        TabView(selection: $part) {
            // CI: the pager does not pass Always On or the text size down to its pages, so each takes DemoEnvironment itself.
            MetricsPage(health: store.health).modifier(DemoEnvironment()).tag(Part.summary)
            if hasPulse { PulsePage(health: store.health).modifier(DemoEnvironment()).tag(Part.pulse) }
            EffortPage().modifier(DemoEnvironment()).tag(Part.effort)
        }
        .tabViewStyle(.verticalPage)
        .onChange(of: dimmed) { down in if down { part = .summary } }
        .onChange(of: hasPulse) { on in if !on && part == .pulse { part = .summary } }
    }
}

extension View {
    /// Clear of the Metrics stack's vertical page dots, which sit on the Digital Crown's side: the left when the
    /// watch is worn with the Crown on the left (owner's Series 10, 2026-11-09).
    func clearOfPageDots() -> some View {
        let left = WKInterfaceDevice.current().crownOrientation == .left
        return padding(.leading, left ? 16 : 4).padding(.trailing, left ? 4 : 16)
    }
}

/// The whole workout's heart rate: its average as the big number, and the line of every reading.
struct PulsePage: View {
    @ObservedObject var health: WorkoutManager
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let samples = health.heartSamples
        GeometryReader { g in
            // Same hero as the Metrics page; the line takes whatever height is left, down to the page dots.
            let hero = min(68, max(40, g.size.height * 0.3))
            VStack(alignment: .leading, spacing: 8) {
                MetricRow(value: Text(verbatim: Metrics.average(samples).map(String.init) ?? "‒‒‒"),
                          unit: Text(Image(systemName: "heart.fill")) + Text(verbatim: " ") + Text("avg"),
                          size: hero, color: Theme.red)
                    .accessibilityLabel(Text("Heart rate"))
                if let r = Metrics.range(samples) {
                    HStack(spacing: 14) {
                        MetricRow(value: Text(verbatim: "\(r.upperBound)"), unit: Text("max"), size: hero * 0.6, color: .white)
                        MetricRow(value: Text(verbatim: "\(r.lowerBound)"), unit: Text("min"), size: hero * 0.6, color: .white)
                    }
                }
                Sparkline(points: Metrics.downsample(samples.filter { $0.1 > 0 }, to: 60), color: Theme.red.opacity(dimmed ? 0.75 : 1), dot: !dimmed)
                    .frame(maxHeight: .infinity)
                    .padding(.bottom, 14)
                    .accessibilityHidden(true)
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea(edges: .bottom)
        .clearOfPageDots()
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// A line through readings in time order, scaled to its own range. Static: nothing animates, and in Always On no end dot.
private struct Sparkline: View {
    let points: [Metrics.Sample]
    let color: Color
    let dot: Bool

    var body: some View {
        GeometryReader { g in
            if let first = points.first, let last = points.last, points.count > 1 {
                let t0 = first.0.timeIntervalSinceReferenceDate
                let span = max(last.0.timeIntervalSinceReferenceDate - t0, 1)
                let lo = points.map(\.1).min() ?? 0, hi = points.map(\.1).max() ?? 1
                let range = max(hi - lo, 10)
                let pad: CGFloat = 4
                let xy: (Metrics.Sample) -> CGPoint = { p in
                    CGPoint(x: pad + (g.size.width - 2 * pad) * (p.0.timeIntervalSinceReferenceDate - t0) / span,
                            y: pad + (g.size.height - 2 * pad) * (1 - (p.1 - lo) / range))
                }
                Path { path in
                    path.move(to: xy(first))
                    for p in points.dropFirst() { path.addLine(to: xy(p)) }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                if dot { Circle().fill(color).frame(width: 7, height: 7).position(xy(last)) }
            }
        }
    }
}

/// Today's effort: one chip per exercise rated, its mean in the phone's colour for it.
struct EffortPage: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.dynamicTypeSize) private var type
    @ScaledMetric(relativeTo: .body) private var nameScaled: CGFloat = 16
    @ScaledMetric(relativeTo: .headline) private var chipScaled: CGFloat = 18

    private func one(_ v: Double) -> String { ((v * 10).rounded() / 10).formatted(.number.precision(.fractionLength(1))) }

    var body: some View {
        let rows = Metrics.effort(store.state)
        VStack(alignment: .leading, spacing: 6) {
            if let kind = store.effortKind, !rows.isEmpty {
                // The latest few: a page that scrolls would fight the Crown, which pages the stack.
                ForEach(rows.suffix(type.isAccessibilitySize ? 2 : 4), id: \.id) { r in
                    let color = Effort.color(kind, r.value)
                    HStack(spacing: 6) {
                        Text(verbatim: r.name)
                            .font(.system(size: min(nameScaled, 22), weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(dimmed ? 0.75 : 1))
                            .lineLimit(2).minimumScaleFactor(0.8)
                            .fixedSize(horizontal: false, vertical: true) // wrap a long name before shrinking it
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(verbatim: one(r.value))
                            .font(.system(size: min(chipScaled, 24), weight: .heavy, design: .rounded).monospacedDigit())
                            .foregroundStyle(dimmed ? color : .black)
                            .padding(.horizontal, 6).frame(minWidth: 38, minHeight: 24)
                            .background(Capsule().fill(dimmed ? Color.clear : color))
                            .overlay(Capsule().stroke(color, lineWidth: dimmed ? 1.5 : 0))
                    }
                    .padding(.leading, 8).padding(.trailing, 3).padding(.vertical, 3)
                    // Rows share the page's height (a long name gets its second line), never taller than 56 pt.
                    .frame(minHeight: 34, maxHeight: 56)
                    .background(RoundedRectangle(cornerRadius: 16).fill(dimmed ? Color.clear : Theme.dim))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.label3, lineWidth: dimmed ? 1 : 0))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: r.name))
                    .accessibilityValue(Text(verbatim: "\(Effort.name(kind)) \(one(r.value))"))
                }
            } else {
                Text("No effort rated yet")
                    .font(.system(size: min(nameScaled, 22), weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .clearOfPageDots()
        .padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            unit.font(.system(size: max(12, size * 0.42), weight: .semibold, design: .rounded)).textCase(.uppercase)
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
    let showKcal: Bool

    var body: some View {
        if health.enabled || health.running {
            if showHr {
                MetricRow(value: Text(verbatim: health.heartRate.map { "\(SafeNum.rounded($0))" } ?? "‒‒"),
                          unit: Text(Image(systemName: "heart.fill")), size: size, color: Theme.red)
                    .accessibilityLabel(Text("Heart rate"))
            }
            if showKcal {
                MetricRow(value: Text(verbatim: health.calories.map { "\(SafeNum.int($0))" } ?? "‒‒"),
                          unit: Text(verbatim: "kcal"), size: size, color: .white)
                    .accessibilityLabel(Text("Calories"))
            }
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
                        digits(String(SafeNum.int(p.whole)), .whole, whole, 20...(store.unit == "lb" ? 700 : 320))
                        Text(verbatim: ".").font(.system(size: size, weight: .semibold, design: .rounded)).foregroundStyle(Theme.label2)
                        digits(String(SafeNum.int(p.tenth)), .tenth, tenth, 0...9)
                        Text(verbatim: " " + store.unit).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundStyle(Theme.label2)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .glass(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous), fill: dimmed ? Color.clear : Theme.surface, dimmed: dimmed)
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
                        stat(Text("Heart rate"), Text("\(SafeNum.int(avg)) avg · \(SafeNum.int(top)) max"), color: Theme.red)
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
