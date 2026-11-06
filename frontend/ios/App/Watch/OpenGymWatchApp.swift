import HealthKit
import SwiftUI
import WatchKit
import WidgetKit

/*
 * openGym on the Apple Watch, laid out like the watch's own apps: one primary action per screen
 * as a big round button in the middle, secondary actions small at the edges, the Digital Crown as
 * the obvious value control, black background, the accent colour only on the primary action.
 *
 *   start   today's workout as one big Start, the other routines in a short list below
 *   3-2-1   with Apple Health on, a countdown before it starts (the heart-rate sensor warms up)
 *   set     weight × reps in big rounded numerals, the round Done, the set dots; the crown turns
 *           the reps (or the weight, after a tap on it), marked by the crown symbol under it
 *           and, when the profile rates effort, RPE or RIR in a small disc beside Done
 *   rest    a full-screen ring around a huge countdown, +15 s and Skip as small round buttons
 *   hold    a timed set: the seconds on the crown, Start, then a ring counting down, Stop
 *   finish  after the last exercise, one round button
 *   summary the workout at its end: time, sets, volume, heart rate, calories, records; Done
 * Exercises are vertical pages (swipe), with the system's page indicator. Each kind of set has its
 * own look: a warm-up is orange and says so, a per-side set says Left or Right, a bodyweight set
 * shows the reps (and added weight, when there is some), a superset says so and goes in turns.
 *
 * Battery: nothing ticks while nothing runs (no timers at the start screen), the animation and the
 * rest ring slow down or stop with the wrist down (Always On), the heart rate redraws at most every
 * few seconds (WorkoutManager), and each animation is decoded once when it arrives.
 */
@main
struct OpenGymWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchAppDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(delegate.store)
                .background(Color.black)
                .modifier(DemoEnvironment())
        }
    }
}

/// Owns the session, so HealthKit's launch for a workout started on the iPhone (WatchBridgePlugin
/// openOnWatch → startWatchApp) reaches it even before the first view is drawn.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    let store = SessionStore()

    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        store.openedForWorkout(workoutConfiguration.activityType)
    }

    /// Relaunched after being killed mid-workout: the Apple Health session watchOS kept running.
    func handleActiveWorkoutRecovery() {
        store.health.recover(workoutId: store.state.workout?.id)
    }
}

/// CI's screenshots: the largest text size, or the screen as in Always On, when asked for.
struct DemoEnvironment: ViewModifier {
    func body(content: Content) -> some View {
        if SessionStore.demoAX {
            content.environment(\.dynamicTypeSize, .accessibility5)
        } else if SessionStore.demoAOD {
            content.environment(\.isLuminanceReduced, true)
        } else {
            content
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        Group {
            if store.weighInFor != nil {
                WeighInView()
            } else if let summary = store.summary {
                SummaryView(summary: summary)
            } else if store.workout == nil, let from = store.countdownFrom {
                CountdownView(from: from)
            } else if store.workout == nil {
                HomeView()
            } else {
                SessionView()
            }
        }
        // The app's language, as the phone sends it, not the watch's own (SwiftUI looks every
        // Text's words up by this locale), and the app's accent.
        .environment(\.locale, store.locale)
        .environment(\.accent, store.accent)
        .environment(\.onAccent, store.onAccent)
        .tint(store.accent)
        // No set for 20 minutes. Never a finish in one tap: "Finish workout" goes to the Overview's hold.
        .alert(Text("All done?"), isPresented: $store.askDone) {
            Button("Continue workout", role: .cancel) { store.keepGoing() }
            Button("Finish workout") {
                store.keepGoing()
                store.tab = .overview
            }
        }
        // Any touch: the rest-over alarm was noticed (it would tap once more otherwise).
        .simultaneousGesture(TapGesture().onEnded { store.ackRestOver() })
        // The complication's Start: today's workout, when none runs yet.
        .onOpenURL { url in
            if url.host == "start", store.workout == nil, let today = store.ready?.today { store.start(today, fromLink: true) }
        }
        .onChange(of: store.widgetState) { state in
            guard !store.isDemo else { return }
            state.write()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

/// The phone is out of reach and events wait on the watch: a small sign, said in words to VoiceOver.
struct OfflineSign: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if store.offline {
            Image(systemName: "iphone.slash")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .accessibilityLabel(Text("Saved on the watch, syncs later"))
        }
    }
}

/// The 3-2-1 before a workout started here: big numbers in a ring that empties once. A tap
/// starts at once; the small button cancels (nothing starts, nothing is logged).
struct CountdownView: View {
    @EnvironmentObject var store: SessionStore
    let from: Date
    /// The same 3-2-1 before a hold that starts by itself (the phone's setting): its own words and actions.
    var label: Text? = nil
    var start: (() -> Void)? = nil
    var cancel: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 2) {
            TimelineView(.periodic(from: from, by: 1)) { ctx in
                let n = max(1, Countdown.number(at: ctx.date.timeIntervalSince(from)))
                Button { if let start = start { start() } else { store.startNow() } } label: {
                    ZStack {
                        CountdownRing(start: from, end: from.addingTimeInterval(Double(Countdown.seconds)))
                        Text(verbatim: "\(n)")
                            .font(.system(size: 64, weight: .bold, design: .rounded).monospacedDigit())
                            .foregroundStyle(Theme.accent)
                    }
                    .aspectRatio(1, contentMode: .fit)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label ?? Text("Start workout"))
                .accessibilityValue(Text(verbatim: "\(n)"))
            }
            .padding(.horizontal, 6)
            HStack {
                EdgeButton(systemImage: "xmark", label: Text("Cancel")) { if let cancel = cancel { cancel() } else { store.cancelCountdown() } }
                Spacer()
            }
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

extension Effort {
    /// The phone's band colours (index.css --purple … --green, then the accent's soft tone).
    static func color(_ kind: String, _ value: Double) -> Color {
        [Color.purple, .red, .orange, .yellow, Theme.accent, .teal][band(kind, value)]
    }
}

/// The workout's active calories so far, redrawn only when they change (WorkoutManager throttles).
struct CaloriesText: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if let kcal = health.calories { Text(verbatim: "\(Int(kcal)) kcal") }
    }
}

/// The weigh-in before a workout started here, as the phone asks for it: the body weight on the
/// crown in two parts (whole units, then a tap on the tenth for the tenth), Save and start, or
/// start without. One crown in tenths ran a whole kilo away in a flick.
struct WeighInView: View {
    @EnvironmentObject var store: SessionStore
    enum Part: Hashable { case whole, tenth }
    @FocusState private var part: Part?
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 40

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
        ScrollView {
            VStack(spacing: 6) {
                Text("Quick check-in").font(.system(.headline, design: .rounded))
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    digits(String(Int(p.whole)), .whole, whole, 20...(store.unit == "lb" ? 700 : 320))
                    Text(verbatim: ".").font(.system(size: size, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
                    digits(String(Int(p.tenth)), .tenth, tenth, 0...9)
                    Text(verbatim: " " + store.unit).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(maxWidth: .infinity, minHeight: Theme.tap)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Body weight"))
                .accessibilityValue(Text(verbatim: String(format: "%.1f %@", store.bodyWeight, store.unit)))
                .accessibilityHint(Text("Turn the Digital Crown to change it."))
                .accessibilityAdjustableAction { d in
                    let v = store.bodyWeight + (d == .increment ? 0.1 : -0.1)
                    let q = WeighIn.parts(v)
                    store.bodyWeight = WeighIn.join(whole: q.whole, tenth: q.tenth)
                }
                Button { store.finishWeighIn(save: true) } label: {
                    Text("Save & start workout").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .tint(Theme.accent)
                Button { store.finishWeighIn(save: false) } label: {
                    Text("Start without weighing in").font(.footnote).frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                Button(role: .cancel) { store.cancelWeighIn() } label: {
                    Text("Cancel").font(.footnote).frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
        .onAppear { part = .whole }
    }

    /// One part of the number: the one the crown turns is in the accent colour on a soft tile,
    /// a tap on the other one hands the crown to it.
    private func digits(_ text: String, _ which: Part, _ value: Binding<Double>, _ range: ClosedRange<Double>) -> some View {
        let on = part == which
        return Text(verbatim: text)
            .font(.system(size: which == .whole ? size : size * 0.8, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(on ? Theme.accent : Color.white)
            .contentTransition(.numericText())
            .padding(.horizontal, 4)
            .frame(minWidth: Theme.tap * 0.7, minHeight: Theme.tap)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? Theme.dim : Color.clear))
            .contentShape(Rectangle())
            .focusable()
            .focused($part, equals: which)
            .digitalCrownRotation(value, from: range.lowerBound, through: range.upperBound, by: 1,
                                  sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
            .onTapGesture { part = which }
    }
}

/* ---------- the rest, and a hold: a ring counting down ---------- */

/// A ring that empties from `start` to `end`. With the wrist down (Always On) it moves once a
/// second, not four times: the screen is updated rarely then anyway, and each update costs.
struct CountdownRing: View {
    let start: Date
    let end: Date
    var color: Color = Theme.accent
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.periodic(from: .now, by: dimmed ? 1 : 0.25)) { ctx in
            let total = max(1, end.timeIntervalSince(start))
            let left = max(0, end.timeIntervalSince(ctx.date))
            ZStack {
                Circle().stroke(Theme.dim, lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(left / total))
                    .stroke(color.opacity(dimmed ? 0.6 : 1), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
        .accessibilityHidden(true)
    }
}

struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize: CGFloat = 42

    var body: some View {
        // The ring and the countdown in it take the space above the two corner buttons, so nothing
        // overlaps on any size (it did on 46 mm when the ring filled the whole screen).
        VStack(spacing: 2) {
            ZStack {
                if store.show.restRing {
                    CountdownRing(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end)
                }
                VStack(spacing: 1) {
                    Text("Rest").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    Text(timerInterval: min(Date(), end)...end, countsDown: true)
                        .font(.system(size: store.show.restRing ? countdownSize : countdownSize * 1.35, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                    if store.show.showNext, let e = store.entry, let si = store.setIndex {
                        Group {
                            if let side = store.sideUp {
                                Text("Next: \(e.name), set \(si + 1)") + Text(verbatim: " · ") + Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                            } else {
                                Text("Next: \(e.name), set \(si + 1)")
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                        .multilineTextAlignment(.center)
                        // What to load during the rest (#911): the next set's weight and reps,
                        // brighter than the line above, the thing you walk to the rack for.
                        if let numbers = store.nextSetNumbers {
                            Text(verbatim: numbers)
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                    }
                    if store.offline {
                        Text("Saved on the watch, syncs later")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
                .padding(.horizontal, 18)
            }
            .aspectRatio(1, contentMode: .fit)
            .padding(.horizontal, 6)
            // Always On: the countdown stays, the buttons go (nothing to tap with the wrist down).
            HStack {
                EdgeButton(systemImage: "goforward.15", label: Text("+15s")) { store.addRest(15) }
                Spacer()
                LockButton(health: store.health)
                Spacer()
                EdgeButton(systemImage: "forward.end.fill", label: Text("Skip")) { store.skipRestAndGo() }
            }
            .opacity(dimmed ? 0 : 1)
        }
        .ignoresSafeArea(edges: .bottom)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

/// A timed set running: the ring counts the hold down; Stop ends it early with what it lasted.
struct HoldView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize: CGFloat = 42

    var body: some View {
        VStack(spacing: 2) {
            ZStack {
                CountdownRing(start: store.holdStartedAt ?? end, end: end, color: .cyan)
                VStack(spacing: 1) {
                    Text(store.entry?.name ?? "").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    Text(timerInterval: min(Date(), end)...end, countsDown: true)
                        .font(.system(size: countdownSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                        .multilineTextAlignment(.center)
                    Text("Hold").font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 18)
            }
            .aspectRatio(1, contentMode: .fit)
            .padding(.horizontal, 6)
            HStack {
                LockButton(health: store.health)
                Spacer()
                EdgeButton(systemImage: "stop.fill", label: Text("Stop")) { store.endHold(early: true) }
            }
            .opacity(dimmed ? 0 : 1)
        }
        .ignoresSafeArea(edges: .bottom)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}

/* ---------- the end of a workout ---------- */

struct SummaryView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.locale) private var locale
    let summary: WorkoutSummary

    var body: some View {
        ScrollViewReader { reader in
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: summary.endedOnPhone ? "iphone" : "checkmark.circle.fill")
                        .foregroundStyle(Theme.accent)
                        .accessibilityHidden(true)
                    Text(summary.endedOnPhone ? LocalizedStringKey("Ended on your iPhone") : LocalizedStringKey("Workout saved"))
                        .font(.system(.headline, design: .rounded))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(verbatim: summary.name).font(.footnote).foregroundStyle(.secondary)
                if let d = summary.duration { stat(Text("Time"), Text(verbatim: SummaryView.duration(d, locale: locale))) }
                stat(Text("Sets"), Text(verbatim: "\(summary.sets)"))
                if summary.volume > 0 {
                    stat(Text("Volume"), Text(verbatim: "\(summary.volume.formatted(.number.precision(.fractionLength(0)))) \(summary.unit)"))
                }
                if let avg = summary.hrAvg, let top = summary.hrMax {
                    stat(Text("Heart rate"), Text("\(Int(avg)) avg · \(Int(top)) max"), color: .red)
                }
                if let kcal = summary.calories {
                    stat(Text("Calories"), Text(Measurement(value: kcal, unit: UnitEnergy.kilocalories),
                                                format: .measurement(width: .abbreviated, usage: .asProvided,
                                                                     numberFormatStyle: .number.precision(.fractionLength(0))).locale(locale)))
                }
                if !summary.prs.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Label { Text("Personal records") } icon: { Image(systemName: "trophy.fill").foregroundStyle(.yellow) }
                            .font(.caption.weight(.semibold))
                        ForEach(summary.prs, id: \.self) { name in
                            Text(verbatim: name).font(.footnote)
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .padding(.top, 2)
                }
                if store.offline {
                    Label { Text("Saved on the watch, syncs later") } icon: { Image(systemName: "iphone.slash") }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Button { store.closeSummary() } label: {
                    Text("Done").frame(maxWidth: .infinity, minHeight: Theme.tap)
                }
                .tint(Theme.accent)
                .padding(.top, 4)
                .id("done")
            }
            .padding(.horizontal, 4)
            // The title starts under the clock, not beside it (it ran into the time on 41 mm).
            .padding(.top, 14)
        }
        // CI: the end of the summary too (heart rate, calories, records).
        .onAppear { if SessionStore.demoScreen == "summary-end" { reader.scrollTo("done", anchor: .bottom) } }
        }
    }

    private func stat(_ label: Text, _ value: Text, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            label.font(.caption2).foregroundStyle(.secondary)
            value.font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit()).foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    /// "52 min", "1 h 5 min", in the watch's language.
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

/* ---------- an exercise's animation, sent by the phone for this workout ---------- */

/// Decoded once, when it arrived (SessionStore.frames); here only cycled through, and not at all
/// with the wrist down.
struct ClipView: View {
    let clip: ClipFrames
    /// Only the exercise on screen moves; the pages next to it (kept alive by the pager) stand still.
    var animating = true
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Group {
            // (SessionStore.demoAOD: CI's Always On, which the pager's pages don't get as an environment value)
            if dimmed || SessionStore.demoAOD || !animating || clip.images.count < 2 {
                // Wrist down or off screen: one still frame, no timeline at all.
                frame(clip.images[0])
            } else {
                TimelineView(.animation(minimumInterval: max(1.0 / 12, clip.duration / Double(clip.images.count)))) { ctx in
                    let t = ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: max(0.1, clip.duration))
                    let i = min(clip.images.count - 1, Int(t / max(0.1, clip.duration) * Double(clip.images.count)))
                    frame(clip.images[i])
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func frame(_ image: UIImage) -> some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

/* ---------- Apple Health ---------- */

/// "♥ 128" while the workout session measures it; nothing otherwise.
struct HeartRateBadge: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if let hr = health.heartRate {
            HStack(spacing: 2) {
                Image(systemName: "heart.fill").font(.system(size: 9))
                Text(verbatim: "\(Int(hr.rounded()))").font(.caption2.monospacedDigit())
            }
            .foregroundStyle(.red)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Heart rate"))
            .accessibilityValue(Text(verbatim: "\(Int(hr.rounded()))"))
        } else if health.measuring {
            HStack(spacing: 2) {
                Image(systemName: "heart").font(.system(size: 9))
                Text("measuring").font(.caption2)
            }
            .foregroundStyle(.secondary)
        }
    }
}

/* ---------- hidden: what arrived from the phone ---------- */

struct DebugView: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "workout: \(store.workout?.id ?? "none")").font(.caption2)
                Text(verbatim: "pending ticks: \(store.state.pending.count)").font(.caption2)
                Text(verbatim: "started here: \(store.state.startedHere ?? "-")").font(.caption2)
                Text(verbatim: "clips: \(store.clips.count)").font(.caption2)
                Text(verbatim: "health: \(store.health.enabled ? "on" : "off"), \(store.health.running ? "running" : "idle")").font(.caption2)
                Divider()
                ForEach(Array(store.clipLog.reversed().enumerated()), id: \.offset) { pair in
                    Text(verbatim: pair.element).font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }
}
