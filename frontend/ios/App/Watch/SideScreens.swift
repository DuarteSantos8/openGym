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
            let live = health.enabled || health.running
            let rows = (store.workoutStart != nil ? 1 : 0) + (live && store.show.showHr ? 1 : 0) + (live && store.show.showKcal ? 1 : 0)
                + (volume > 0 ? 1 : 0) + (w != nil ? 1 : 0)
            // Apple Workout's summary: every row one size, 1.02 of it apart, filling the page down to the dots
            // (fewer rows do not grow past five's size).
            let size = (g.size.height - 10) / (WorkoutRow.pitch * CGFloat(max(rows, 5)))
            VStack(alignment: .leading, spacing: 0) {
                if let start = store.workoutStart {
                    // Kept by the system, whole seconds (no hundredths at the gym, owner 11-10); paused on the phone (#976): it stands.
                    Text(timerInterval: SafeNum.timerRange(start, Date.distantFuture), pauseTime: store.workoutPausedAt, countsDown: false)
                        .font(.system(size: size, weight: .medium).monospacedDigit())
                        .foregroundStyle(Theme.yellow.opacity(dimmed ? 0.75 : 1))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(height: size * WorkoutRow.pitch, alignment: .leading)
                        .accessibilityLabel(Text("Time"))
                }
                HealthRows(health: health, size: size, showHr: store.show.showHr, showKcal: store.show.showKcal)
                if let w {
                    let p = store.progress
                    if volume > 0 {
                        WorkoutRow(value: Text(verbatim: volume.formatted(.number.precision(.fractionLength(0)).locale(locale))),
                                   unit: .word(Text(verbatim: w.unit)), size: size)
                            .accessibilityLabel(Text("Volume"))
                    }
                    WorkoutRow(value: Text(verbatim: "\(p.done)/\(p.total)"), unit: .label(Text("Sets")), size: size)
                }
                Spacer(minLength: 0)
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea(edges: .bottom)
        .clearOfPageDots()
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// One row of the summary as Apple's Workout draws it: the number in SF Compact medium, and beside it a
/// heart, a short unit as a word on the baseline ("KG"), or a longer one in small capitals ending on it ("ACTIVE / KCAL").
struct WorkoutRow: View {
    enum Unit { case heart, word(Text), label(Text) }
    static let pitch: CGFloat = 1.02
    let value: Text
    let unit: Unit
    let size: CGFloat
    var color: Color = .white
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: size * 0.06) {
            value.font(.system(size: size, weight: .medium).monospacedDigit())
                .foregroundStyle(color.opacity(dimmed ? 0.75 : 1))
            switch unit {
            case .heart:
                Text(Image(systemName: "heart.fill")).font(.system(size: size * 0.52)).baselineOffset(size * 0.06)
                    .foregroundStyle(Theme.red.opacity(dimmed ? 0.75 : 1))
            case .word(let t):
                t.font(.system(size: size * 0.6, weight: .medium)).textCase(.uppercase)
                    .foregroundStyle(.white.opacity(dimmed ? 0.75 : 1))
            case .label(let t):
                t.font(.system(size: max(12, size * 0.3), weight: .semibold)).textCase(.uppercase)
                    .lineSpacing(-size * 0.04).lineLimit(2).fixedSize()
                    .foregroundStyle(.white.opacity(dimmed ? 0.75 : 1))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6) // a long number shrinks to the width, never to the row's height
        .fixedSize(horizontal: false, vertical: true)
        // Rows sit closer than the font's own line (digits have no descenders), as Apple's do.
        .frame(height: size * Self.pitch, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// openGym's mark in a circle where Apple's Workout shows the workout's symbol: brand green on a dark tint of it.
struct WorkoutBadge: View {
    let size: CGFloat
    var body: some View {
        OpenGymLogo().fill(OpenGymLogo.green)
            .frame(width: size * 0.62, height: size * 0.31)
            .frame(width: size, height: size)
            .background(Circle().fill(OpenGymLogo.green.opacity(0.22)))
            .accessibilityHidden(true)
    }
}

/// Metrics is a vertical stack: Summary, Pulse, Effort. The Crown or a vertical swipe moves it (the system's
/// page dots); sideways still goes to the neighbouring pages. Wrist down: back to the Summary.
struct MetricsStack: View {
    enum Part { case summary, pulse, effort, zones }
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var part = SessionStore.demoMetricsPart
    /// Without Apple Health (off, or no reading allowed) there is no heart rate to chart, and the setting can hide it.
    private var hasPulse: Bool { store.health.running && store.show.showHr }

    var body: some View {
        TabView(selection: $part) {
            // CI: the pager does not pass Always On or the text size down to its pages, so each takes DemoEnvironment itself.
            MetricsPage(health: store.health).workoutBadge().modifier(DemoEnvironment()).tag(Part.summary)
            if hasPulse { PulsePage(health: store.health).metricsTitle(Text("Heart rate"), Theme.red).modifier(DemoEnvironment()).tag(Part.pulse) }
            EffortPage().metricsTitle(Text("Effort"), .white).modifier(DemoEnvironment()).tag(Part.effort)
            if hasPulse, store.show.showZones, let age = store.health.age { ZonesPage(health: store.health, age: age).metricsTitle(Text("Zones"), .white).modifier(DemoEnvironment()).tag(Part.zones) }
        }
        .tabViewStyle(.verticalPage)
        .onChange(of: dimmed) { down in if down { part = .summary } }
        .onChange(of: hasPulse) { on in if !on && (part == .pulse || part == .zones) { part = .summary } }
        .onChange(of: store.show.showZones) { on in if !on && part == .zones { part = .summary } }
    }
}

extension View {
    /// The page's name in the empty row under the clock (wrist 11-10: the space the system keeps for the top bar).
    /// Hung just above the page's top, so the page keeps its height and its layout.
    func metricsTitle(_ title: Text, _ color: Color) -> some View {
        overlay(alignment: .topLeading) {
            title.font(TypeScale.title)
                .foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
                .padding(.leading, 4) // 10 pt from the edge, as on every page
                .clearOfPageDots()
                .alignmentGuide(.top) { $0[.bottom] }
        }
    }

    /// The summary's badge in the clock's row, top-left, as Apple's Workout has its workout symbol there.
    func workoutBadge() -> some View {
        overlay(alignment: .topLeading) {
            WorkoutBadge(size: 40).clearOfPageDots().alignmentGuide(.top) { $0[.bottom] + 2 }
        }
    }

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
            VStack(alignment: .leading, spacing: 4) {
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

/// Time in each heart-rate zone, Z5 on top: a bar each, as long as its share of the longest; the zone the
/// heart is in now in full colour, the others dimmed. Max from age (Tanaka), age from Apple Health.
struct ZonesPage: View {
    @ObservedObject var health: WorkoutManager
    let age: Int
    @Environment(\.isLuminanceReduced) private var dimmed
    private static let colors = [Theme.teal, Theme.green, Theme.yellow, Theme.orange, Theme.red]

    var body: some View {
        let max = Metrics.maxHeartRate(age: age)
        let time = Metrics.timeInZones(health.heartSamples, max: max)
        let longest = Swift.max(time.max() ?? 0, 1)
        let now = health.heartRate.flatMap { Metrics.zone($0, max: max) }
        let bands = Metrics.zoneBands(max: max)
        GeometryReader { g in
            // Apple Workout's rhythm: fat rows 4 pt apart, the labels inside the bars, nothing left empty.
            let gap: CGFloat = 4
            let row = (g.size.height - 14 - gap * 4) / 5
            let text = Swift.min(17, Swift.max(13, row * 0.42))
            VStack(spacing: gap) {
                ForEach((1...5).reversed(), id: \.self) { z in
                    let color = Self.colors[z - 1]
                    let on = z == now
                    let share = time[z - 1] / longest
                    ZStack(alignment: .leading) {
                        // The track, the time's share filled in, and the current zone outlined.
                        RoundedRectangle(cornerRadius: row * 0.3).fill(color.opacity(0.22))
                        GeometryReader { b in
                            RoundedRectangle(cornerRadius: row * 0.3).fill(color.opacity(dimmed ? 0.3 : 0.55))
                                .frame(width: time[z - 1] > 0 ? Swift.max(row * 0.6, b.size.width * share) : 0)
                        }
                        if on { RoundedRectangle(cornerRadius: row * 0.3).strokeBorder(color, lineWidth: 2) }
                        HStack(spacing: 6) {
                            Text(verbatim: "Z\(z)").font(.system(size: text, weight: .bold, design: .rounded))
                            // The band in bpm, so a lifter knows the number to aim for (wrist 11-10).
                            Text(verbatim: band(bands[z - 1]))
                                .font(.system(size: text * 0.85, weight: .medium, design: .rounded).monospacedDigit())
                                .opacity(0.85)
                            Spacer(minLength: 4)
                            Text(Duration.seconds(time[z - 1].rounded(.down)).formatted(.time(pattern: time[z - 1] >= 3600 ? .hourMinuteSecond : .minuteSecond)))
                                .font(.system(size: text, weight: .semibold, design: .rounded).monospacedDigit())
                        }
                        .foregroundStyle(.white)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .padding(.horizontal, 8)
                    }
                    .frame(height: row)
                    .opacity((now == nil || on ? 1 : 0.7) * (dimmed ? 0.6 : 1))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: "Z\(z), \(band(bands[z - 1]))"))
                    .accessibilityValue(Text(Duration.seconds(time[z - 1].rounded(.down)).formatted(.units(allowed: [.hours, .minutes, .seconds], width: .wide))))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .frame(width: g.size.width, height: g.size.height - 14, alignment: .top)
        }
        .ignoresSafeArea(edges: .bottom)
        .clearOfPageDots()
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private func band(_ b: (lo: Int?, hi: Int?)) -> String {
        switch (b.lo, b.hi) {
        case (nil, let hi?): return "<\(hi + 1)"
        case (let lo?, nil): return "\(lo)+"
        case (let lo?, let hi?): return "\(lo)–\(hi)"
        default: return ""
        }
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

    private func one(_ v: Double) -> String { ((v * 10).rounded() / 10).formatted(.number.precision(.fractionLength(1))) }

    var body: some View {
        let rows = Metrics.effort(store.state)
        // In a GeometryReader like the other pages, so all of them start at the same height (the titles line up).
        GeometryReader { _ in VStack(alignment: .leading, spacing: 4) {
            if let kind = store.effortKind, !rows.isEmpty {
                // The latest few: a page that scrolls would fight the Crown, which pages the stack.
                ForEach(rows.suffix(type.isAccessibilitySize ? 2 : 4), id: \.id) { r in
                    let color = Effort.color(kind, r.value)
                    HStack(spacing: 6) {
                        Text(verbatim: r.name)
                            .font(TypeScale.body)
                            .foregroundStyle(.white.opacity(dimmed ? 0.75 : 1))
                            .lineLimit(2).minimumScaleFactor(0.8)
                            .fixedSize(horizontal: false, vertical: true) // wrap a long name before shrinking it
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(verbatim: one(r.value))
                            .font(TypeScale.body.monospacedDigit())
                            .foregroundStyle(dimmed ? color : .black)
                            .padding(.horizontal, 8).frame(minWidth: 38).frame(height: TypeScale.pill)
                            .background(Capsule().fill(dimmed ? Color.clear : color))
                            .overlay(Capsule().stroke(color, lineWidth: dimmed ? 1.5 : 0))
                    }
                    .padding(.leading, 8).padding(.trailing, 3).padding(.vertical, 3)
                    // Rows share the page's height (a long name gets its second line), never taller than 56 pt.
                    .frame(minHeight: 34, maxHeight: 56)
                    .background(RoundedRectangle(cornerRadius: Theme.radius).fill(dimmed ? Color.clear : Theme.dim))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.label3, lineWidth: dimmed ? 1 : 0))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(verbatim: r.name))
                    .accessibilityValue(Text(verbatim: "\(Effort.name(kind)) \(one(r.value))"))
                }
            } else {
                Text("No effort rated yet")
                    .font(TypeScale.body)
                    .foregroundStyle(.secondary)
            }
        }
        .clearOfPageDots()
        .padding(.bottom, 14) }
        // Down to the page dots like the other pages, and from the same top, so the title does not jump.
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea(edges: .bottom)
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
                WorkoutRow(value: Text(verbatim: health.heartRate.map { "\(SafeNum.rounded($0))" } ?? "‒‒"), unit: .heart, size: size)
                    .accessibilityLabel(Text("Heart rate"))
            }
            if showKcal {
                WorkoutRow(value: Text(verbatim: health.calories.map { "\(SafeNum.int($0))" } ?? "‒‒"),
                           unit: .label(Text("Active\nkcal")), size: size)
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
                        // A record: the mark bounces and sparks go out, at the top where the summary opens (Direction B).
                        SavedMark(symbol: summary.endedOnPhone ? "iphone" : "checkmark.circle.fill", color: accent, record: !summary.prs.isEmpty)
                        Text(summary.endedOnPhone ? LocalizedStringKey("Ended on your iPhone") : LocalizedStringKey("Workout saved"))
                            .font(TypeScale.title)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(verbatim: summary.name).font(TypeScale.second).foregroundStyle(Theme.label2)
                    if let d = summary.duration {
                        VStack(alignment: .leading, spacing: -2) {
                            Text("Time").font(TypeScale.label).textCase(.uppercase).foregroundStyle(Theme.label2)
                            Text(verbatim: SummaryView.duration(d, locale: locale))
                                .font(.system(size: TypeScale.number, weight: .semibold, design: .rounded).monospacedDigit())
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
                                .font(TypeScale.label).textCase(.uppercase)
                            ForEach(summary.prs, id: \.self) { name in
                                Text(verbatim: name).font(TypeScale.body)
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
                .padding(.horizontal, 10) // 10 pt from the edge, as on every page
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
            label.font(TypeScale.label).textCase(.uppercase).foregroundStyle(Theme.label2)
            value.font(TypeScale.title.monospacedDigit()).foregroundStyle(color)
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

/// The summary's mark: when a record was set it bounces once and a short burst of sparks goes out
/// behind it (Direction B, owner 2026-11-11). Once, on arrival; still with Reduce Motion or the wrist down.
struct SavedMark: View {
    let symbol: String
    let color: Color
    let record: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var burst = false
    private static let colors = [Theme.yellow, Theme.orange, Theme.green]

    var body: some View {
        Image(systemName: symbol).foregroundStyle(color)
            .symbolEffect(.bounce, value: burst)
            .background {
                ZStack {
                    ForEach(0..<10, id: \.self) { i in
                        let a = Double(i) / 10 * 2 * .pi
                        Circle().fill(Self.colors[i % 3])
                            .frame(width: 5, height: 5)
                            .offset(x: burst ? cos(a) * 26 : 0, y: burst ? sin(a) * 26 : 0)
                            .scaleEffect(burst ? 0.5 : 1)
                            // Bright on the way out, then gone: a fade from the start hid them.
                            .opacity(burst ? 0 : 1)
                            .animation(.easeIn(duration: 0.3).delay(0.3), value: burst)
                    }
                }
                .opacity(reduceMotion || dimmed || !record ? 0 : 1)
                .allowsHitTesting(false)
            }
            .onAppear {
                guard record, !reduceMotion, !dimmed else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { withAnimation(.easeOut(duration: 0.6)) { burst = true } }
            }
            .accessibilityHidden(true)
    }
}
