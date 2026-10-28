import HealthKit
import SwiftUI
import WatchKit
import WidgetKit

/*
 * openGym on the Apple Watch, laid out like the watch's own apps: one primary action per screen
 * as a big button, secondary actions small at the edges, the Digital Crown as
 * the obvious value control, black background, the accent colour only on the primary action.
 *
 *   start   today's workout as one big Start, the other routines in a short list below
 *   3-2-1   with Apple Health on, a countdown before it starts (the heart-rate sensor warms up)
 *   set     laid out like Apple's Workout: a band with the time and heart rate, the exercise's name,
 *           "Set 2 of 4" with its tags, last time, weight and reps as two boxes (a tap opens the
 *           value on the crown), what is planned, a Done pill (RPE or RIR in a small disc beside
 *           it, when the profile rates effort) and the set dots; the crown pages the exercises
 *   rest    the time left beside the clock, a bar draining under it, −15 s · Skip · +15 s, what is next
 *   hold    a timed set: the seconds on the crown, Start, then a ring counting down, Stop
 *   summary the workout at its end: time, sets, volume, heart rate, calories, records; Done
 * Overview ← the exercises: swipe right from a set for every exercise with its sets done (tap one to
 * jump to it) and Finish workout, a one-second hold at its bottom, Discard workout apart below it.
 * The exercises are vertical pages (swipe, the crown pages them), with the system's page indicator;
 * the rest comes up over them, so the exercises never leave. Each kind of set has its
 * own look: a warm-up is orange and says so, a per-side set says Left or Right, a bodyweight set
 * shows the reps (and added weight, when there is some), a superset says so and goes in turns.
 *
 * Battery: nothing ticks while nothing runs (no timers at the start screen), the animation and the
 * rest bar slow down or stop with the wrist down (Always On), the heart rate redraws at most every
 * few seconds (WorkoutManager), and each animation is decoded once when it arrives.
 */
@main
struct OpenGymWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: WatchAppDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(delegate.store)
                .tint(Theme.accent)
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

enum Theme {
    /// The app's default accent (frontend/src/index.css --green, dark).
    static let accent = Color(red: 0x30 / 255, green: 0xd1 / 255, blue: 0x58 / 255)
    /// Warm-up sets (the app's --orange).
    static let warmup = Color(red: 1, green: 0x9f / 255, blue: 0x0a / 255)
    static let dim = Color.white.opacity(0.14)
    /// The smallest a thing a finger has to hit may be.
    static let tap: CGFloat = 44
    /// What replaces a fill in Always On. White 40 % is 3.7:1 on black; the app's --label-3 is 2.4:1.
    static let outline = Color.white.opacity(0.4)
    /// The app's --r: rows.
    static let radius: CGFloat = 12
    /// The app's --r-xl: full-width buttons.
    static let radiusLarge: CGFloat = 22
    /// The app's --fast: a press.
    static let fast = 0.14
    /// Side margin on the 41 mm rounded screen (the old 4 pt is too tight).
    static let side: CGFloat = 9
    /// Always On: bright text and strokes drop to this. On black: white 11:1, accent 6:1.
    static let aod = 0.75

    static func ink(_ c: Color, _ dimmed: Bool) -> Color { dimmed ? c.opacity(aod) : c }
}

/// The app's .btn:active: 97.5 % in 140 ms, ease-out, no spring. Reduce Motion or wrist down: dim only.
private struct Press: ViewModifier {
    let on: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    func body(content: Content) -> some View {
        content
            .scaleEffect(on && !reduceMotion && !dimmed ? 0.975 : 1)
            .opacity(on ? 0.8 : 1)
            .animation(dimmed ? nil : .easeOut(duration: Theme.fast), value: on)
    }
}

/// .btn.primary: solid accent, black label, full width, 44 pt. Wrist down: 2 pt accent outline, no fill.
struct PrimaryButton: ButtonStyle {
    var minHeight = Theme.tap
    @Environment(\.isLuminanceReduced) private var dimmed
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous)
        let accent = Theme.ink(Theme.accent, dimmed)
        configuration.label
            .foregroundStyle(dimmed ? accent : Color.black)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .background(shape.fill(dimmed ? Color.clear : Theme.accent))
            .overlay(shape.stroke(accent, lineWidth: dimmed ? 2 : 0))
            .contentShape(shape)
            .modifier(Press(on: configuration.isPressed))
    }
}

/// .btn (secondary): system glass on watchOS 26, the dim fill before. Wrist down: 1 pt outline.
struct SecondaryButton: ButtonStyle {
    @Environment(\.isLuminanceReduced) private var dimmed
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
        let row = configuration.label
            .background { if !dimmed { fill(shape) } }
            .overlay(shape.stroke(Theme.outline, lineWidth: dimmed ? 1 : 0))
            .contentShape(shape)
        // Interactive glass answers a touch by itself; the dim fill, and Always On, get the app's press.
        if #available(watchOS 26, *), !dimmed { row } else { row.modifier(Press(on: configuration.isPressed)) }
    }
    @ViewBuilder private func fill(_ shape: RoundedRectangle) -> some View {
        if #available(watchOS 26, *) { Color.clear.glassEffect(.regular.interactive(), in: shape) }
        else { shape.fill(Theme.dim) }
    }
}

/// A button that draws itself and only answers a touch with the app's press (the boxes, the effort disc).
private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.modifier(Press(on: configuration.isPressed))
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
                IdleView()
            } else if let from = store.holdCountFrom {
                CountdownView(from: from, label: Text("Start hold"), start: { store.startHold(auto: true) }, cancel: { store.stopHoldCount() })
            } else if let end = store.holdEndsAt {
                HoldView(end: end)
            } else {
                SessionScreen()
            }
        }
        // The app's language, as the phone sends it, not the watch's own (SwiftUI looks every
        // Text's words up by this locale).
        .environment(\.locale, store.locale)
        // No set for 20 minutes. Never a finish in one tap: "Finish workout" goes to the Overview's Finish.
        .alert(Text("All done?"), isPresented: $store.askDone) {
            Button("Continue workout", role: .cancel) { store.keepGoing() }
            Button("Finish workout") {
                store.keepGoing()
                store.showFinish()
            }
        }
        // Any touch: the rest-over alarm was noticed (it would tap once more otherwise).
        .simultaneousGesture(TapGesture().onEnded { store.ackRestOver() })
        // The complication's Start: today's workout, when none runs yet.
        .onOpenURL { url in
            if url.host == "start", store.workout == nil, let today = store.ready?.today { store.start(today) }
        }
        .onChange(of: store.widgetState) { state in
            guard !store.isDemo else { return }
            state.write()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}

/// A word in a small capsule: "Warm-up", "Left", "Superset".
struct Tag: View {
    let text: Text
    let color: Color
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        text
            .font(.system(.caption2, design: .rounded).weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink(color, dimmed))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            // Always On: an outline, no lit fill.
            .background(Capsule().fill(dimmed ? Color.clear : color.opacity(0.18)))
            .overlay(Capsule().stroke(Theme.outline, lineWidth: dimmed ? 1 : 0))
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

/// A small round secondary button at an edge: an SF Symbol on a dim disc, a 44 pt target.
struct EdgeButton: View {
    let systemImage: String
    let label: Text
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.ink(.white, dimmed))
                .frame(width: Theme.tap, height: Theme.tap)
                // Always On: an outline, no lit fill.
                .background(Circle().fill(dimmed ? Color.clear : Theme.dim))
                .overlay(Circle().stroke(Theme.outline, lineWidth: dimmed ? 1 : 0))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// Water Lock, as Apple's Workout has it: the screen and the crown's press stop doing anything
/// (a sleeve or a bent wrist no longer leaves the workout or taps Done); turning the crown unlocks.
/// watchOS allows it only while a workout session runs, so without Apple Health there is none.
struct LockButton: View {
    @ObservedObject var health: WorkoutManager
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if health.running {
            EdgeButton(systemImage: "drop.fill", label: Text("Lock")) { if store.touchAllowed { WKInterfaceDevice.current().enableWaterLock() } }
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

/* ---------- no workout: start one ---------- */

struct IdleView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.dynamicTypeSize) private var type
    @State private var debug = false

    var body: some View {
        content
            // Hidden: a long press shows what arrived from the phone (animations, sync, heart rate).
            .onLongPressGesture(minimumDuration: 2) { debug = true }
            .sheet(isPresented: $debug) { DebugView() }
    }

    /// "Exercises 5 · Sets 17", or nothing for a routine without sets. Too wide: a size smaller, then two lines, no dot.
    @ViewBuilder private func counts(_ session: ReadySession) -> some View {
        let n = SessionCore.size(session)
        if n.sets > 0 {
            let e = "\(store.L("Exercises")) \(n.exercises)", s = "\(store.L("Sets")) \(n.sets)"
            ViewThatFits(in: .horizontal) {
                Text(verbatim: "\(e) · \(s)").font(.footnote)
                Text(verbatim: "\(e) · \(s)").font(.caption)
                VStack(alignment: .leading, spacing: 0) { Text(verbatim: e); Text(verbatim: s) }.font(.footnote)
            }
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(e), \(s)"))
        }
    }

    @ViewBuilder private var content: some View {
        if let ready = store.ready, ready.today != nil || !ready.others.isEmpty {
            // The stack only gives the clock row a word to carry; nothing is pushed.
            NavigationStack {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            if let today = ready.today {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(today.name)
                                        .font(.title3.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8)
                                        .foregroundStyle(Theme.ink(.white, dimmed))
                                    // Largest text: the rows below say it, so Start stays whole on a 40 mm screen.
                                    if !type.isAccessibilitySize { counts(today) }
                                }
                                .accessibilityElement(children: .combine)
                                Button { store.startFromTouch(today) } label: {
                                    // The short word fits beside the glyph in every language; at large text the word stands alone.
                                    HStack(spacing: 6) {
                                        if !type.isAccessibilitySize { Image(systemName: "play.fill").accessibilityHidden(true) }
                                        Text("Start").multilineTextAlignment(.center)
                                    }
                                    .font(.headline.weight(.semibold))
                                    .padding(.horizontal, 6).padding(.vertical, 6)
                                }
                                .buttonStyle(PrimaryButton(minHeight: 52))
                                .accessibilityValue(Text(verbatim: today.name))
                            }
                            if !ready.others.isEmpty {
                                VStack(spacing: 6) {
                                    if ready.today != nil {
                                        Text("Routines").font(.footnote).foregroundStyle(.secondary)
                                            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 10)
                                            .accessibilityAddTraits(.isHeader)
                                    }
                                    ForEach(Array(ready.others.enumerated()), id: \.offset) { pair in
                                        Button { store.startFromTouch(pair.element) } label: {
                                            // The glyph sits by the name so the counts line below gets the whole row's width.
                                            VStack(alignment: .leading, spacing: 0) {
                                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                                    Text(pair.element.name).font(.subheadline.weight(.semibold))
                                                        .foregroundStyle(Theme.ink(.white, dimmed))
                                                    Spacer(minLength: 4)
                                                    if !type.isAccessibilitySize {
                                                        Image(systemName: "play.fill").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).accessibilityHidden(true)
                                                    }
                                                }
                                                counts(pair.element)
                                            }
                                            .padding(.horizontal, 10).padding(.vertical, 4)
                                            .frame(maxWidth: .infinity, minHeight: Theme.tap, alignment: .leading)
                                        }
                                        .buttonStyle(SecondaryButton())
                                        .accessibilityHint(Text("Start workout"))
                                    }
                                }
                                .id("end")
                            }
                        }
                        .padding(.horizontal, Theme.side)
                        .padding(.bottom, 12)
                        .id("top")
                    }
                    .scrollBounceBehavior(.basedOnSize)
                    // Wrist down shows the start screen's top, where Today and Start are (never on a timer).
                    .onChange(of: dimmed) { _, on in if on { proxy.scrollTo("top", anchor: .top) } }
                    .onAppear { if SessionStore.demoScreen == "idle-end" { proxy.scrollTo("end", anchor: .bottom) } }
                    // The stack's content gets the system's luminance, not the screenshots' (CI only).
                    .modifier(DemoEnvironment())
                }
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        // The same white in both states: the colour marks nothing, the word does.
                        Text(ready.today != nil ? LocalizedStringKey("Today") : LocalizedStringKey("Routines"))
                            .foregroundStyle(Theme.ink(.white, dimmed)).accessibilityAddTraits(.isHeader)
                    }
                }
            }
        } else {
            // Nothing from the phone yet (it sends only while openGym runs there): say so, rather
            // than a "no workout" that reads as if the two were in touch.
            let fresh = !store.heardFromPhone && store.ready == nil
            // Centred when it fits; when the text is too big for that, a scroll that gives the words the logo's room.
            ViewThatFits(in: .vertical) {
                empty(fresh: fresh, logo: true).frame(maxHeight: .infinity)
                ScrollView { empty(fresh: fresh, logo: false).padding(.bottom, 12) }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
    }

    private func empty(fresh: Bool, logo: Bool) -> some View {
        VStack(spacing: 10) {
            if logo {
                Group {
                    if dimmed { OpenGymLogo().fill(Theme.accent.opacity(0.5)) } else { OpenGymLogo().fill(Theme.accent) }
                }
                    .frame(width: 60, height: 30)
                    .accessibilityHidden(true)
            }
            Text(fresh ? LocalizedStringKey("Not synced yet") : LocalizedStringKey("No workout running"))
                .font(.headline)
                .foregroundStyle(Theme.ink(.white, dimmed))
                .multilineTextAlignment(.center)
            Text(fresh ? LocalizedStringKey("Open openGym on your iPhone once and your routines show up here.")
                 : LocalizedStringKey("Start one on your iPhone and it shows up here."))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
        .padding(.horizontal, Theme.side)
    }
}

/* ---------- the session: Overview ← the exercises, the rest over them ---------- */

struct SessionScreen: View {
    enum Page { case overview, set }
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page: Page = SessionStore.demoOpensOverview ? .overview : .set

    var body: some View {
        let end = store.restEndsAt.flatMap { $0 > Date() ? $0 : nil }
        if store.workout?.entries.isEmpty ?? true {
            OverviewPage()      // no exercises: the Overview alone
        } else {
            TabView(selection: $page) {
                OverviewPage(onPick: { page = .set }).tag(Page.overview)
                ZStack {
                    ExercisePager(covered: end != nil || page != .set)
                        .disabled(end != nil || page != .set)       // nothing under the rest or the Overview takes the crown
                        .opacity(end == nil ? 1 : 0)
                        .accessibilityHidden(end != nil)
                    if let end { RestView(end: end).transition(.opacity) }
                }
                .animation(reduceMotion || dimmed ? nil : .easeInOut(duration: 0.2), value: end != nil)
                .tag(Page.set)
            }
            // PageTabViewStyle, not .page(...): that one draws the pages too wide.
            .tabViewStyle(PageTabViewStyle(indexDisplayMode: dimmed || end != nil ? .never : .automatic))
            // Wrist down or the app left: back to the live set. Nothing else moves the page, and never on a timer.
            .onChange(of: dimmed) { _, on in if on { page = .set } }
            .onChange(of: scenePhase) { _, p in if p != .active { page = .set } }
            // The end of the workout, at the moment the lifter is looking.
            .onChange(of: store.finishWanted) { _, want in
                if want && dimmed { store.finishWanted = false } else if want { page = .overview }
            }
            // Raised while this screen was away (a hold's last set swaps the root): it is up when it returns.
            .onAppear { if store.finishWanted && !dimmed { page = .overview } }
            // Back from the Overview at the end: the last exercise is the one up.
            .onChange(of: page) { _, p in
                if p == .set, SessionCore.atEnd(store.state), let n = store.workout?.entries.count { store.show(entry: n - 1) }
            }
        }
    }
}

/* ---------- the exercises, one per page ---------- */

struct ExercisePager: View {
    @EnvironmentObject var store: SessionStore
    /// The rest or the Overview is over the pager: nothing on it animates.
    let covered: Bool

    var body: some View {
        // Vertical pages, swiped; the crown pages them too (as in Apple's Workout).
        let n = store.workout?.entries.count ?? 0
        TabView(selection: Binding(get: { min(store.entryIndex, max(0, n - 1)) }, set: { store.show(entry: $0) })) {
            ForEach(Array((store.workout?.entries ?? []).enumerated()), id: \.offset) { pair in
                ExercisePage(index: pair.offset, covered: covered).tag(pair.offset)
            }
        }
        .tabViewStyle(.verticalPage)
    }
}

/// What a tap on a number opens for editing.
enum EditField: String, Identifiable {
    case weight, reps, seconds, effort
    var id: String { rawValue }
}

/*
 * One exercise, one set up next. The numbers are two big boxes (weight, reps); a tap on one opens
 * it on a screen of its own, where the Digital Crown turns only that value, in the exercise's own
 * steps with a tap of the crown at each, and − and + do the same by hand. On this page the crown
 * belongs to the pages (the next exercise), as in Apple's Workout app.
 */
struct ExercisePage: View {
    @EnvironmentObject var store: SessionStore
    let index: Int
    let covered: Bool
    @State private var editing: EditField?
    @State private var confirmSkip = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.isLuminanceReduced) private var dimmed

    /// How many of the two extra lines (last time, planned) a layout carries; the page takes the first that fits.
    private enum Lines { case both, one, none }

    var body: some View {
        if let w = store.workout, w.entries.indices.contains(index) {
            let entry = w.entries[index]
            let si = store.setIndex(in: index)
            let current = index == store.entryIndex
            GeometryReader { g in
                let inset = g.safeAreaInsets
                VStack(spacing: 0) {
                    band(inset: inset.top, width: g.size.width + inset.leading + inset.trailing)
                    if let si = si {
                        // The lines drop first when the screen is small (41 mm: one line, or none at a two-line name),
                        // then the name goes to one line (40 mm).
                        ViewThatFits(in: .vertical) {
                            VStack(spacing: 0) { nameRow(entry, lines: 2); setBlock(entry, si, unit: entry.weightUnit(w.unit), current: current, lines: .both) }
                            VStack(spacing: 0) { nameRow(entry, lines: 2); setBlock(entry, si, unit: entry.weightUnit(w.unit), current: current, lines: .one) }
                            VStack(spacing: 0) { nameRow(entry, lines: 2); setBlock(entry, si, unit: entry.weightUnit(w.unit), current: current, lines: .none) }
                            VStack(spacing: 0) { nameRow(entry, lines: 1); setBlock(entry, si, unit: entry.weightUnit(w.unit), current: current, lines: .none) }
                        }
                        .frame(maxHeight: .infinity, alignment: .top)
                    } else {
                        nameRow(entry, lines: 2)
                        let left = entry.sets.contains { !$0.done }
                        Spacer(minLength: 2)
                        Image(systemName: left ? "forward.circle" : "checkmark.circle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        Text(left ? LocalizedStringKey("Tap a dot to do a skipped set.") : LocalizedStringKey("All sets done"))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.7)
                        Spacer(minLength: 4)
                        SetDots(entry: entry, current: nil, skipped: { store.isSkipped(entry.id, $0) }) { store.pick(set: $0, in: index) }
                    }
                }
                .padding(.horizontal, Theme.side)
                .padding(.bottom, 8)        // the horizontal page dots sit about 6 pt from the bottom edge
                // Outside the candidates above, so only one animation runs; level with the name's first line.
                .overlay(alignment: .topLeading) {
                    if hasClip(entry), let clip = store.clips[entry.id] {
                        ClipView(clip: clip, animating: index == store.entryIndex && !covered)
                            .frame(width: 22, height: 22)
                            .padding(.leading, Theme.side + 4)
                            .padding(.top, bandHeight(inset.top))
                    }
                }
                // The whole screen, not what the system leaves: the band sits beside the clock, not under it.
                .frame(width: g.size.width + inset.leading + inset.trailing, height: g.size.height + inset.top + inset.bottom, alignment: .top)
                .offset(x: -inset.leading, y: -inset.top)
                // The set's layout is fixed (numbers, Done, dots on one screen): text grows up to a size
                // that still fits on 41 mm; the start screen and the summary scroll and grow all the way.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .modifier(DemoEnvironment())        // CI's Always On reaches a pager page only this way
                .onAppear {
                    if current, SessionStore.demoScreen == "edit-weight" { editing = .weight }
                    if current, SessionStore.demoScreen == "edit-reps" { editing = .reps }
                }
                .sheet(item: $editing) { field in
                    ValueEditor(field: field, entry: entry, unit: entry.weightUnit(w.unit))
                }
                .confirmationDialog(Text("Skip this set?"), isPresented: $confirmSkip) {
                    Button("Skip set") { store.skipSet() }
                    Button("Cancel", role: .cancel) {}
                }
            }
        }
    }

    /// The top band: the time and heart rate, then the offline sign. It is as high as the clock (the system's
    /// inset less 17 pt: 29 pt on 41 mm) and its right 30 % of the screen (52 pt on 41 mm) is the clock's, so
    /// nothing is ever under it; what does not fit is left out (calories first, then the time). The 17 pt and
    /// the 30 % were measured on 41 and 49 mm.
    private func band(inset: CGFloat, width: CGFloat) -> some View {
        ViewThatFits(in: .horizontal) {
            bandItems(elapsed: true, kcal: true)
            bandItems(elapsed: true, kcal: false)
            bandItems(elapsed: false, kcal: false)
        }
        .lineLimit(1)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .padding(.top, 7)
        .padding(.leading, 4)
        .padding(.trailing, width * 0.3 - Theme.side)
        .frame(maxWidth: .infinity, minHeight: bandHeight(inset), alignment: .leading)
    }

    private func bandHeight(_ inset: CGFloat) -> CGFloat { max(29, inset - 17) }

    private func bandItems(elapsed: Bool, kcal: Bool) -> some View {
        HStack(spacing: 6) {
            if elapsed { WorkoutExtras(kcal: kcal) }
            if store.show.showHr { HeartRateBadge(health: store.health) }
            OfflineSign()
        }
    }

    private func hasClip(_ entry: Entry) -> Bool { store.show.showClip && store.clips[entry.id] != nil }

    /// The exercise's name under the band, two lines when it needs them (the animation, drawn over the page, sits before it).
    private func nameRow(_ entry: Entry, lines: Int) -> some View {
        Text(entry.name)
            .font(.headline)
            .foregroundStyle(Theme.ink(.white, dimmed))
            .lineLimit(lines)
            .minimumScaleFactor(lines == 1 ? 0.75 : 0.8)
            .fixedSize(horizontal: false, vertical: true)
            // As high as the animation, so a shrunk one-line name does not leave it over the row below.
            .frame(maxWidth: .infinity, minHeight: lines == 1 && hasClip(entry) ? 22 : nil, alignment: .leading)
            .padding(.leading, hasClip(entry) ? 32 : 4)        // the 22 pt animation, 6 pt, the 4 pt margin
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
            .accessibilityAddTraits(.isHeader)
    }

    /// Everything under the name for the set up next: its place, the lines, the boxes, Done, the dots.
    @ViewBuilder private func setBlock(_ entry: Entry, _ si: Int, unit: String, current: Bool, lines: Lines) -> some View {
        let row = entry.sets[si]
        let pos = SetPage.position(entry, set: si)
        let last = store.show.showLast ? SetPage.lastTime(entry.last, pos) : nil
        let plan = SetPage.planned(entry, set: si, unit: unit) { store.isSkipped(entry.id, $0) }
        VStack(spacing: 0) {
            positionRow(entry, row, pos)
            Spacer(minLength: 1)
            if lines != .none, let last { lastLine(last) }
            boxes(entry, row, unit: unit, current: current)
            if let plan, lines == .both || (lines == .one && last == nil) { plannedLine(plan) }
            Spacer(minLength: 1)
            primaryRow(entry, current: current)
            Spacer(minLength: 1)
            SetDots(entry: entry, current: si, skipped: { store.isSkipped(entry.id, $0) }) { store.pick(set: $0, in: index) }
        }
        .frame(maxHeight: .infinity)        // the spare room goes between the rows
    }

    /// "Set 2 of 4", or Warm-up, then Left / Right and Superset. Short of room, Superset is a link glyph,
    /// then the place is "2/4" (long words: ru has "Подход 2 из 4" beside "ПРАВАЯ"). VoiceOver says it in full.
    private func positionRow(_ entry: Entry, _ row: SetRow, _ pos: SetPage.Position) -> some View {
        ViewThatFits(in: .horizontal) {
            positionItems(entry, row, pos, glyph: false, short: false)
            positionItems(entry, row, pos, glyph: true, short: false)
            positionItems(entry, row, pos, glyph: true, short: true)
        }
        .frame(maxWidth: .infinity, minHeight: 16, alignment: .leading)
        .padding(.leading, 4)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    private func positionItems(_ entry: Entry, _ row: SetRow, _ pos: SetPage.Position, glyph: Bool, short: Bool) -> some View {
        let side = row.sideUp
        return HStack(spacing: 4) {
            if let n = pos.number {
                (short ? Text(verbatim: "\(n)/\(pos.total)") : Text("Set \(n) of \(pos.total)"))
                    .font(.footnote.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .accessibilityLabel(Text("Set \(n) of \(pos.total)"))
            } else {
                Tag(text: Text("Warm-up"), color: Theme.warmup)
            }
            if side == "L" { Tag(text: Text("Left"), color: .cyan) }
            if side == "R" { Tag(text: Text("Right"), color: .cyan) }
            if entry.group != nil {
                if glyph { Tag(text: Text(Image(systemName: "link")), color: .purple).accessibilityLabel(Text("Superset")) }
                else { Tag(text: Text("Superset"), color: .purple) }
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// What was lifted in this place last time; a symbol for the label where the words do not fit.
    private func lastLine(_ piece: String) -> some View {
        ViewThatFits(in: .horizontal) {
            Text("Last time: \(piece)")
            Label { Text(verbatim: piece) } icon: { Image(systemName: "clock.arrow.circlepath") }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 1)
        .padding(.leading, 4)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityLabel(Text("Last time: \(piece)"))
    }

    /// The plan still ahead: "62.5 kg × 8-8-7", the reps of this set in bold.
    private func plannedLine(_ p: SetPage.Planned) -> some View {
        let ladder = Text("\(Text(verbatim: p.head))\(Text(verbatim: p.now).bold().foregroundStyle(Theme.ink(.white, dimmed)))\(Text(verbatim: p.tail))")
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) { Text("Planned"); ladder }
            Label { ladder } icon: { Image(systemName: "target") }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 1)
        .padding(.leading, 4)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityLabel(Text("\(Text("Planned")) \(Text(verbatim: p.spoken))"))
    }

    /// Weight and reps as two boxes (a hold: the seconds in one wide box); a tap opens it for editing.
    @ViewBuilder private func boxes(_ entry: Entry, _ row: SetRow, unit: String, current: Bool) -> some View {
        if entry.isCardio {
            Text("Log this one on your iPhone.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 50)
        } else if entry.isTimed {
            ValueTile(value: formatNumber(current ? store.seconds : (row.sec ?? 0)), unit: "s", label: Text("Hold"),
                      tint: .white) { if current { editing = .seconds } }
        } else {
            numbers(entry, row, unit: unit, current: current)
        }
    }

    /// Weight × reps; a bodyweight set shows its added weight (or Bodyweight) in the weight box.
    private func numbers(_ entry: Entry, _ row: SetRow, unit: String, current: Bool) -> some View {
        let side = row.sideUp.flatMap { row.sides?[$0] }
        let weight = current ? store.weight : (side?.w ?? row.w ?? 0)
        let reps = current ? store.reps : (side?.r ?? row.r ?? 0)
        let tint = row.warmup ? Theme.warmup : Color.white
        return HStack(spacing: 6) {
            if entry.isBodyweight {
                ValueTile(value: weight > 0 ? "+\(formatNumber(weight))" : "0", unit: unit,
                          label: weight > 0 ? Text("Added weight") : Text("Bodyweight"), short: Text("Weight"), tint: tint) { if current { editing = .weight } }
            } else {
                ValueTile(value: formatNumber(weight), unit: unit, label: Text("Weight"), tint: tint) { if current { editing = .weight } }
            }
            ValueTile(value: formatNumber(reps), unit: nil, label: Text("Reps"), tint: tint) { if current { editing = .reps } }
                .frame(width: 62)
        }
    }

    /// With a profile that rates effort, the RPE / RIR disc, then the Done pill (a hold: Start hold). A set
    /// that gets a rest is rated in it instead (RestView's chips), so Done has the row to itself.
    @ViewBuilder private func primaryRow(_ entry: Entry, current: Bool) -> some View {
        HStack(spacing: 6) {
            if let kind = store.effortKind, !entry.isCardio, let si = store.setIndex(in: index), !entry.sets[si].warmup,
               Effort.ratesBeforeDone(store.state, entry: index, set: si) {
                EffortButton(kind: kind, value: current ? store.effort : nil) { if current { editing = .effort } }
                    .disabled(!current)
            }
            doneButton(entry, current: current)
        }
    }

    @ViewBuilder private func doneButton(_ entry: Entry, current: Bool) -> some View {
        let timed = entry.isTimed
        Button { if timed { store.startHold() } else { store.completeSet() } } label: {
            // At the accessibility sizes the glyph goes and the word stands alone.
            HStack(spacing: 6) {
                if !typeSize.isAccessibilitySize { Image(systemName: timed ? "play.fill" : "checkmark").accessibilityHidden(true) }
                if timed { Text("Start hold") } else { Text("Done") }
            }
            .font(.headline.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
        }
        .buttonStyle(PrimaryButton(minHeight: Theme.tap))
        .disabled(!current)
        // A long press: skip this set instead (VoiceOver: an action of its own).
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in if current { confirmSkip = true } })
        .accessibilityAction(named: Text("Skip set")) { store.skipSet() }
    }
}

/// The time so far and the calories, when the phone says to show them (`kcal: false`: the time alone).
struct WorkoutExtras: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    var kcal = true

    var body: some View {
        let show = store.show
        if show.showElapsed || (kcal && show.showKcal) {
            HStack(spacing: 6) {
                if show.showElapsed, let start = store.workoutStart {
                    Text(timerInterval: start...Date.distantFuture, countsDown: false)
                        .monospacedDigit()
                }
                if kcal && show.showKcal { CaloriesText(health: store.health) }
            }
            .font(.system(.footnote, design: .rounded).weight(.medium))
            .foregroundStyle(Theme.ink(Theme.warmup, dimmed))
            .lineLimit(1)
        }
    }
}

/// The set's effort as a small disc beside Done: the scale's name over the number, in the phone's
/// colour for it (lib/effort.js), or a dash while it is not rated. A tap opens it on the crown.
struct EffortButton: View {
    let kind: String
    let value: Double?
    let tap: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let color = value.map { Effort.color(kind, $0) } ?? Color.white
        Button(action: tap) {
            VStack(spacing: -2) {
                Text(verbatim: Effort.name(kind)).font(.system(size: 12, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                Text(verbatim: value.map(formatNumber) ?? "–")
                    .font(.system(size: 16, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(Theme.ink(color, dimmed))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: Theme.tap, height: Theme.tap)
            // Always On: the outline only.
            .background(Circle().fill(dimmed ? Color.clear : (value == nil ? Theme.dim : color.opacity(0.22))))
            .overlay(Circle().stroke(value == nil ? Theme.outline : Theme.ink(color, dimmed).opacity(0.9), lineWidth: value == nil ? (dimmed ? 1 : 0) : 1.5))
        }
        .buttonStyle(PressStyle())
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityLabel(Text("Effort"))
        .accessibilityValue(value.map { Text(verbatim: "\(Effort.name(kind)) \(formatNumber($0))") } ?? Text("None"))
        .accessibilityHint(Text("Tap to change it."))
    }
}

/// The four chips of the rest, hardest first, in the phone's bands. Four columns of 40 pt are the touch areas;
/// the chips inside are 36 × 38. The chosen one is solid with a black digit; Always On draws outlines only.
struct EffortChips: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    let kind: String
    let chosen: Double?
    let pick: (Double) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<4, id: \.self) { i in chip(i, Effort.chips(kind)?[i] ?? 0) }
        }
        // As the controls above: clear of the system's page dots.
        .padding(.leading, 5).padding(.trailing, 11)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("How hard was that set?"))
    }

    private func chip(_ i: Int, _ v: Double) -> some View {
        let color = Effort.color(kind, v)
        let on = chosen == v
        let shape = RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
        return Button { pick(v) } label: {
            Text(verbatim: Effort.chipLabel(kind, i))
                .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(dimmed ? Theme.ink(on ? color : .white, true) : (on ? Color.black : color))
                .frame(width: 36, height: 38)
                .background(shape.fill(dimmed ? Color.clear : (on ? color : color.opacity(0.22))))
                .overlay(shape.stroke(on ? Theme.ink(color, dimmed) : Theme.outline, lineWidth: dimmed ? (on ? 2 : 1) : 0))
                .frame(maxWidth: .infinity, minHeight: 38)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(Text(verbatim: "\(Effort.name(kind)) \(formatNumber(v))"))
        .accessibilityHint(Text(verbatim: store.L(Effort.feel(i))))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The rating just given, "RIR 2", in its band colour; a tap opens the chips again.
struct RatedEffort: View {
    let kind: String
    let value: Double
    let tap: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let color = Theme.ink(Effort.color(kind, value), dimmed)
        Button(action: tap) {
            HStack(spacing: 6) {
                Text(verbatim: "\(Effort.name(kind)) \(formatNumber(value))")
                    .font(.system(size: 15, weight: .semibold, design: .rounded).monospacedDigit())
                Image(systemName: "pencil").font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Capsule().fill(dimmed ? Color.clear : color.opacity(0.22)))
            .overlay(Capsule().stroke(color, lineWidth: dimmed ? 1 : 0))
            // The look stays 32 high; the touch area is 44 (the padding is taken back outside).
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .padding(.vertical, -6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityLabel(Text("Effort"))
        .accessibilityValue(Text(verbatim: "\(Effort.name(kind)) \(formatNumber(value))"))
        .accessibilityHint(Text("Tap to change it."))
    }
}

extension Effort {
    /// The phone's band colours (index.css --purple … --green, then a soft tone).
    static func color(_ kind: String, _ value: Double) -> Color {
        [Color.purple, .red, .orange, .yellow, .green, .teal][band(kind, value)]
    }
}

/// The workout's active calories so far, redrawn only when they change (WorkoutManager throttles).
struct CaloriesText: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if let kcal = health.calories { Text(verbatim: "\(Int(kcal)) kcal") }
    }
}

/// A number you can tap to change: big, in a soft rounded tile so it reads as a control, its unit
/// small beside it and what it is in words under it.
struct ValueTile: View {
    let value: String
    let unit: String?
    let label: Text
    /// A shorter caption for where the label does not fit (ru, pl: "Bodyweight").
    var short: Text? = nil
    var tint: Color = .white
    let tap: () -> Void
    // The numbers are what a glance between sets is for: as big as the box lets them be.
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 30
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button(action: tap) {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(verbatim: value)
                        .font(.system(size: min(size, 32), weight: .semibold, design: .rounded).monospacedDigit())
                    if let u = unit {
                        Text(verbatim: u).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                ViewThatFits(in: .horizontal) {
                    label
                    short ?? label
                }
                .font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                .dynamicTypeSize(...DynamicTypeSize.large)
            }
            .foregroundStyle(tint.opacity(dimmed ? Theme.aod : 1))
            .frame(maxWidth: .infinity, minHeight: 50)
            // Always On: no lit tiles, only their outline (less light, the numbers still read).
            .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(dimmed ? Color.clear : Theme.dim))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.outline, lineWidth: dimmed ? 1 : 0))
        }
        .buttonStyle(PressStyle())
        // VoiceOver: "Weight, 62.5 kg, button: tap to change it".
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(Text(verbatim: unit.map { "\(value) \($0)" } ?? value))
        .accessibilityHint(Text("Tap to change it."))
        .accessibilityAddTraits(.isButton)
    }
}

/*
 * One value on a screen of its own, like setting a timer in Apple's apps: the value huge in the
 * middle in the accent colour (so it is clear what changes), − and + either side, the Digital
 * Crown turning it in the exercise's own steps (a tap of the crown at each), Done at the bottom.
 */
struct ValueEditor: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    let field: EditField
    let entry: Entry
    let unit: String
    @State private var value: Double = 0
    /// Effort: where the crown was when the editor opened (left untouched, nothing is rated).
    @State private var opened: Double = 0
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 54

    /// The profile's effort scale; the effort editor turns a crown position (Effort.value).
    private var kind: String { store.effortKind ?? "rpe" }
    private var step: Double {
        switch field {
        case .weight: return entry.step.flatMap { $0 > 0 ? $0 : nil } ?? (unit == "lb" ? 5 : 2.5)
        case .reps, .effort: return 1
        case .seconds: return 5
        }
    }
    private var range: ClosedRange<Double> {
        switch field {
        case .weight: return 0...(unit == "lb" ? 1500 : 700)
        case .reps: return 0...200
        case .seconds: return 5...3600
        case .effort: return 0...Double(Effort.notches(kind)?.count ?? 0)
        }
    }
    private var title: Text {
        switch field {
        case .weight: return entry.isBodyweight ? Text("Added weight") : Text("Weight")
        case .reps: return Text("Reps")
        case .seconds: return Text("Hold")
        case .effort: return Text(verbatim: Effort.name(kind))
        }
    }
    private var suffix: String? {
        switch field {
        case .weight: return unit
        case .reps, .effort: return nil
        case .seconds: return "s"
        }
    }
    /// What the big number says: the value, or for effort the rating at the crown (a dash: none).
    private var shown: String {
        guard field == .effort else { return formatNumber(value) }
        return Effort.value(kind, at: Int(value.rounded())).map(formatNumber) ?? "–"
    }
    private var shownColor: Color {
        guard field == .effort else { return Theme.accent }
        return Effort.value(kind, at: Int(value.rounded())).map { Effort.color(kind, $0) } ?? .secondary
    }

    var body: some View {
        VStack(spacing: 4) {
            title.font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                stepButton("minus", Text("Less")) { nudge(-step) }
                VStack(spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(verbatim: shown)
                            .font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
                            .foregroundStyle(shownColor)
                            .contentTransition(.numericText())
                        if let s = suffix { Text(verbatim: s).font(.system(size: 13, weight: .medium, design: .rounded)).foregroundStyle(.secondary) }
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    Image(systemName: "digitalcrown.arrow.clockwise.fill").font(.system(size: 10)).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity)
                .focusable()
                .focused($focused)
                .digitalCrownRotation($value, from: range.lowerBound, through: range.upperBound, by: step,
                                      sensitivity: field == .weight ? DigitalCrownRotationalSensitivity.medium : DigitalCrownRotationalSensitivity.low, isContinuous: false, isHapticFeedbackEnabled: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(title)
                .accessibilityValue(field == .effort && shown == "–" ? Text("None") : Text(verbatim: suffix.map { "\(shown) \($0)" } ?? shown))
                .accessibilityAdjustableAction { d in
                    switch d {
                    case .increment: nudge(step)
                    case .decrement: nudge(-step)
                    @unknown default: break
                    }
                }
                stepButton("plus", Text("More")) { nudge(step) }
            }
            if field == .weight {
                Text(verbatim: "± \(formatNumber(step)) \(unit)").font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 2)
            Button { save(); dismiss() } label: {
                Text("Done").font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: Theme.tap)
            }
            .tint(Theme.accent)
        }
        .padding(.horizontal, 2)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .onAppear {
            switch field {
            case .weight: value = store.weight
            case .reps: value = store.reps
            case .seconds: value = store.seconds
            // a set not rated yet opens on a hard working set; turned down to the dash it is none again
            case .effort: value = Double(Effort.position(kind, of: store.effort ?? Effort.start(kind)))
            }
            opened = value
            focused = true
        }
        // Effort: swiped away untouched, the set stays unrated (Done rates it as shown).
        .onDisappear { if field != .effort || value != opened || store.effort != nil { save() } }
    }

    private func nudge(_ d: Double) {
        // On the step's grid, so + and − land on the same numbers the crown does.
        let next = ((value + d) / step).rounded() * step
        value = min(range.upperBound, max(range.lowerBound, next))
        WKInterfaceDevice.current().play(.click)
    }

    private func save() {
        switch field {
        case .weight: store.weight = max(0, value)
        case .reps: store.reps = max(0, value.rounded())
        case .seconds: store.seconds = max(5, value)
        case .effort: store.rate(Effort.value(kind, at: Int(value.rounded())))
        }
    }

    private func stepButton(_ symbol: String, _ label: Text, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Theme.dim))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
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

/// One dot per set: filled when done, ringed when it is the one up, orange and small for a warm-up,
/// half-filled for a per-side set with one side done, hollow and dim when skipped. A tap picks a set.
struct SetDots: View {
    let entry: Entry
    let current: Int?
    let skipped: (Int) -> Bool
    let pick: (Int) -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let position = SetPage.position(entry, set: current ?? -1)
        HStack(spacing: 4) {
            ForEach(Array(entry.sets.enumerated()), id: \.offset) { pair in
                let s = pair.element
                let color = s.warmup ? Theme.warmup : Color.white
                let half = !s.done && (s.sides.map { $0.L.done || $0.R.done } ?? false)
                Circle()
                    .fill(s.done ? color : (half ? color.opacity(0.5) : Theme.dim))
                    .overlay(Circle().stroke(color, lineWidth: pair.offset == current ? 1.5 : 0))
                    .overlay(Circle().stroke(Color.white.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [1.5, 1.5]))
                        .opacity(skipped(pair.offset) && !s.done ? 1 : 0))
                    .frame(width: s.warmup ? 6 : 9, height: s.warmup ? 6 : 9)
                    .frame(width: 16, height: 16)
                    .contentShape(Rectangle())
                    .onTapGesture { if !s.done { pick(pair.offset) } }
            }
        }
        .opacity(dimmed ? 0.6 : 1)
        // VoiceOver: "Set 2 of 4, 1 done" (a warm-up: "Warm-up"), swipe up or down to pick another set.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(current == nil ? Text("Sets") : position.number.map { Text("Set \($0) of \(position.total)") } ?? Text("Warm-up"))
        .accessibilityValue(Text("\(position.done) done"))
        .accessibilityAdjustableAction { direction in
            let open = entry.sets.indices.filter { !entry.sets[$0].done }
            guard let cur = current, let at = open.firstIndex(of: cur) else { return }
            switch direction {
            case .increment: if at + 1 < open.count { pick(open[at + 1]) }
            case .decrement: if at > 0 { pick(open[at - 1]) }
            @unknown default: break
            }
        }
    }
}

/* ---------- the Overview: every exercise, then Finish and Discard ---------- */

struct OverviewPage: View {
    /// A row was picked: the session screen moves to the Set page.
    var onPick: () -> Void = {}
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var confirmDiscard = SessionStore.demoScreen == "discard"
    /// How far the Finish hold has filled the screen (0...1); CI's finish-hold shots start part-way.
    @State private var cover: CGFloat = SessionStore.demoScreen == "finish-hold" ? 0.6 : SessionStore.demoScreen == "finish-hold-full" ? 1 : 0

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    header
                    ForEach(Overview.rows(store.state)) { row in
                        OverviewRow(row: row, onPick: onPick)
                    }
                    FinishHoldButton(cover: $cover).id("finish")
                    Color.clear.frame(height: 18).accessibilityHidden(true)    // Finish and Discard stay 24 pt apart
                    Button { if store.touchAllowed { confirmDiscard = true } } label: {
                        Label { Text("Discard workout") } icon: { Image(systemName: "trash") }
                            .font(.body.weight(.semibold))
                            .foregroundStyle(Theme.ink(.red, dimmed))
                            .frame(maxWidth: .infinity, minHeight: Theme.tap)
                    }
                    .buttonStyle(SecondaryButton())
                    HStack { Spacer(); LockButton(health: store.health); Spacer() }.padding(.top, 6)
                }
                .padding(.horizontal, Theme.side)
                .padding(.top, 14)
                .padding(.bottom, 24)       // keeps the last control clear of the page dots
            }
            .scrollBounceBehavior(.basedOnSize)
            .overlay { FinishFlood(cover: cover) }
            // The workout ended: Finish in view, once the page has settled.
            .task(id: store.finishWanted) {
                guard store.finishWanted else { return }
                try? await Task.sleep(for: .seconds(0.4))
                withAnimation { proxy.scrollTo("finish", anchor: .bottom) }
                store.finishWanted = false
            }
            .onAppear { if ["finish", "finish-hold", "finish-hold-full", "discard"].contains(SessionStore.demoScreen) { proxy.scrollTo("finish", anchor: .bottom) } }
        }
        .confirmationDialog(Text("Discard workout?"), isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Continue workout", role: .cancel) {}
            Button("Discard workout", role: .destructive) { store.discard() }
        } message: {
            if store.progress.done > 0 { Text("The sets you logged in this session will be lost.") }
        }
    }

    private func headerExtras(kcal: Bool) -> some View {
        HStack(spacing: 6) {
            WorkoutExtras(kcal: kcal)
            if store.show.showHr { HeartRateBadge(health: store.health) }
        }
    }

    private var header: some View {
        let p = store.progress
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: store.workout?.name ?? "")
                .font(.system(.footnote, design: .rounded).weight(.semibold))
                .lineLimit(2)
                .foregroundStyle(Theme.ink(.white, dimmed))
                .accessibilityAddTraits(.isHeader)
            // The calories go first when the three do not fit side by side (41 mm).
            ViewThatFits(in: .horizontal) {
                headerExtras(kcal: true)
                headerExtras(kcal: false)
            }
            if p.total > 0 {
                Text("\(p.done) of \(p.total) sets").font(.footnote.monospacedDigit()).foregroundStyle(.secondary)
            }
            if store.offline {
                Text("Saved on the watch, syncs later").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 10)
    }
}

/// One exercise: a glyph for its state, its name, the sets done. A tap jumps to it.
struct OverviewRow: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    let row: Overview.Row
    let onPick: () -> Void

    var body: some View {
        Button { if store.choose(entry: row.index) { onPick() } } label: {
            HStack(alignment: .top, spacing: 8) {
                glyph.font(.body).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: row.name)
                        .font(.subheadline.weight(row.state == .current ? .bold : .semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .foregroundStyle(row.state == .done ? AnyShapeStyle(.secondary) : AnyShapeStyle(Theme.ink(.white, dimmed)))
                    if row.total > 0 {
                        Text(verbatim: "\(row.done)/\(row.total)")
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(row.state == .current ? AnyShapeStyle(Theme.ink(Theme.accent, dimmed)) : AnyShapeStyle(.secondary))
                    }
                    if row.superset { Text("Superset").font(.footnote).foregroundStyle(Theme.ink(.purple, dimmed)) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: Theme.tap, alignment: .leading)
        }
        .buttonStyle(SecondaryButton())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.name))
        .accessibilityValue(row.total > 0 ? Text("\(row.done) of \(row.total) sets") : Text(verbatim: ""))
        .accessibilityAddTraits(row.state == .current ? [.isButton, .isSelected] : .isButton)
    }

    // Done is white, not green: the accent reads as an action. Shape and weight carry the state too.
    @ViewBuilder private var glyph: some View {
        switch row.state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ink(.white, dimmed))
        case .current: Image(systemName: "play.circle.fill").foregroundStyle(Theme.ink(Theme.accent, dimmed))
        case .todo: Image(systemName: "circle").foregroundStyle(.secondary)
        }
    }
}

/// Finish workout: hold for a second. The fill (FinishFlood) shows it coming; a tap only bolds the hint.
struct FinishHoldButton: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var cover: CGFloat
    @State private var confirming = false
    @State private var hinted = false
    @State private var pressing = false
    @State private var ticks: Task<Void, Never>?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.radiusLarge, style: .continuous)
        let accent = Theme.ink(Theme.accent, dimmed)
        VStack(spacing: 0) {
            Text("Finish workout").font(.headline).lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.center)
            Text("Hold to finish").font(.footnote.weight(hinted || pressing ? .heavy : .regular))
                .lineLimit(2).minimumScaleFactor(0.75).multilineTextAlignment(.center)
        }
        .foregroundStyle(dimmed ? accent : Color.black)
        .padding(.horizontal, 6).padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(shape.fill(dimmed ? Color.clear : Theme.accent))
        // Reduce Motion: no flood, a pale sweep inside the button instead, behind the label.
        .background(alignment: .leading) {
            if reduceMotion && !dimmed && cover > 0 {
                GeometryReader { g in Color.white.opacity(0.4).frame(width: g.size.width * cover) }.clipShape(shape)
            }
        }
        .overlay(shape.stroke(accent, lineWidth: dimmed ? 2 : 0))
        .contentShape(shape)
        .onTapGesture {
            hinted = true
            Task { try? await Task.sleep(for: .seconds(1.5)); hinted = false }
        }
        // No .interactive() glass here: it cancelled holds inside scrolling lists. A scroll cancels the hold (6 pt).
        .onLongPressGesture(minimumDuration: 1, maximumDistance: 6, perform: fire, onPressingChanged: { down in
            pressing = down
            down ? begin() : release()
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Finish workout"))
        .accessibilityHint(Text("Hold to finish"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default) { confirming = true }       // VoiceOver cannot hold: it asks first
        .confirmationDialog(Text("Finish workout?"), isPresented: $confirming) {
            Button("Finish and save") { store.finish() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func begin() {
        guard !dimmed else { return }
        withAnimation(.linear(duration: reduceMotion ? 1 : 0.85)) { cover = 1 }
        // Soft ticks while it fills; Haptics.finished() starts 250 ms after the last one.
        ticks = Task {
            for _ in 0..<3 {
                try? await Task.sleep(for: .seconds(0.25))
                if Task.isCancelled { return }
                Haptics.count()
            }
        }
    }

    private func release() {
        ticks?.cancel()
        withAnimation(.easeOut(duration: 0.2)) { cover = 0 }
    }

    private func fire() {
        ticks?.cancel()
        var t = Transaction(); t.disablesAnimations = true
        withTransaction(t) { cover = 0 }
        // Finishing an empty workout keeps its dialog.
        if store.progress.done == 0 { confirming = true } else { store.finish() }
    }
}

/// The screen filling from the bottom while Finish is held, full as the hold fires: the words in
/// white on the dimmed page, in black on the fill (white on the accent is about 2:1, black 10:1).
struct FinishFlood: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let cover: CGFloat

    var body: some View {
        if cover > 0 && !dimmed && !reduceMotion {
            GeometryReader { g in
                let h = g.size.height * cover
                ZStack(alignment: .bottom) {
                    // fully black by a quarter of the hold, so no list text shows through the words
                    Color.black.opacity(min(cover * 4, 1))
                    Rectangle().fill(Theme.accent).frame(height: h)
                    words.foregroundStyle(.white)
                    words.foregroundStyle(.black).mask(alignment: .bottom) { Rectangle().frame(height: h) }
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var words: some View {
        let p = store.progress
        return VStack(spacing: 2) {
            Text("Finish workout").font(.title3.bold())
            Text("Hold to finish").font(.headline)
            if p.total > 0 { Text("\(p.done) of \(p.total) sets").font(.footnote.weight(.semibold)) }
        }
        .multilineTextAlignment(.center)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/* ---------- a hold: a ring counting down (the rest has its own bar, below) ---------- */

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

/// A bar that drains from `start` to `end`, a step on each second the digits change. It never animates
/// (Reduce Motion or not). Wrist down the screen updates about once a minute, so a fill would stand at a
/// stale fraction: only the outline stays, the digits are the truth.
struct RestBar: View {
    let start: Date
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Group {
            if dimmed {
                Capsule().strokeBorder(Theme.outline, lineWidth: 1)
            } else {
                TimelineView(.periodic(from: end, by: 1)) { ctx in
                    let full = Rest.progress(left: end.timeIntervalSince(ctx.date), total: end.timeIntervalSince(start))
                    Capsule().fill(Theme.dim)
                        .overlay(alignment: .leading) {
                            GeometryReader { g in Capsule().fill(Theme.accent).frame(width: g.size.width * full) }
                        }
                }
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// The rest over the set: the time left beside the clock, a bar draining under it, −15 · Skip · +15, and what
/// comes next (read-only). The Crown does here what it did: nothing on this layer.
struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.locale) private var locale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var countdownSize: CGFloat = 42
    /// The chips are open on a set that already has a rating (the capsule was tapped).
    @State private var changing = SessionStore.demoScreen == "rest-effort-change"

    var body: some View {
        GeometryReader { g in
            let inset = g.safeAreaInsets
            let width = g.size.width + inset.leading + inset.trailing
            let up = upNext
            let rating = store.effortKind.flatMap { k in store.rating.map { (kind: k, target: $0) } }
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Text(timerInterval: min(Date(), end)...end, countsDown: true)
                        // With no Next block below, the time left takes the room.
                        .font(.system(size: up == nil && rating == nil ? min(countdownSize * 1.35, 64) : min(countdownSize, 52), weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.ink(.white, dimmed))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .accessibilityLabel(Text("\(Text("Rest")) \(Text(timerInterval: min(Date(), end)...end, countsDown: true))"))
                    OfflineSign()
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 42)
                .padding(.top, 2)
                // The clock's 30 % of the screen is the system's, as on the set page.
                .padding(.trailing, width * 0.3 - Theme.side)
                .padding(.horizontal, Theme.side)
                if store.show.restRing {
                    RestBar(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end)
                        .padding(.horizontal, Theme.side)
                        .padding(.top, 4)
                }
                // The system's page dots sit at the trailing edge; the row stops short of them.
                controls.padding(.leading, 5).padding(.trailing, 11).padding(.top, 8)
                // Takes what is left, so the Next block is offered that much height (ViewThatFits).
                if let rating {
                    effort(rating.kind, rating.target, up)
                } else {
                    HStack(alignment: .bottom, spacing: 8) {
                        next(up)
                        LockButton(health: store.health)
                    }
                    .padding(.horizontal, Theme.side)
                    .padding(.top, 8)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                }
            }
            .padding(.bottom, 12)
            .frame(width: width, height: g.size.height + inset.top + inset.bottom, alignment: .top)
            .offset(x: -inset.leading, y: -inset.top)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .modifier(DemoEnvironment())        // CI's Always On reaches a layer over the pager only this way
    }

    /// −15 s, Skip, +15 s: 44 pt high, 8 pt apart. Skip is the wide one, with a word (a symbol where the word
    /// does not fit), so a thumb aimed at an adjust does not end the rest.
    private var controls: some View {
        HStack(spacing: 8) {
            step(-Rest.step)
            Button { if store.touchAllowed { store.skipRestAndGo(lock: true) } } label: {
                ViewThatFits(in: .horizontal) {
                    Text("Skip")
                    Image(systemName: "forward.end.fill")
                }
                .font(.headline)
                .lineLimit(1)
                .foregroundStyle(Theme.ink(.white, dimmed))
                .frame(maxWidth: .infinity, minHeight: Theme.tap)
            }
            .buttonStyle(SecondaryButton())
            .accessibilityLabel(Text("Skip"))
            step(Rest.step)
        }
    }

    private func step(_ seconds: TimeInterval) -> some View {
        Button { if store.touchAllowed { store.addRest(seconds) } } label: {
            Text(verbatim: "\(seconds < 0 ? "−" : "+")\(Int(Rest.step))s")
                .font(.system(.subheadline, design: .rounded).weight(.semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(Theme.ink(.white, dimmed))
                .padding(.horizontal, 4)
                .frame(minWidth: Theme.tap, minHeight: Theme.tap)
        }
        .buttonStyle(SecondaryButton())
        .accessibilityLabel(Text(seconds < 0 ? "Less" : "More"))
        .accessibilityValue(Text(Measurement(value: Rest.step, unit: UnitDuration.seconds),
                                 format: .measurement(width: .wide, usage: .asProvided,
                                                      numberFormatStyle: .number.precision(.fractionLength(0))).locale(locale)))
    }

    /// The set just done, rated in the rest: the chips asking, or the rating with Up next above it. They swap in
    /// one container with a cross-fade (instantly under Reduce Motion or in Always On). The Lock sits at the
    /// same y in both, 3 pt under the controls: at 41 mm that is what lets it stay while the chips are open.
    private func effort(_ kind: String, _ t: Effort.Target, _ up: Rest.Next?) -> some View {
        let asking = t.value == nil || changing
        return ZStack(alignment: .top) {
            if asking {
                // Short of room: the Lock goes, then the prompt shrinks to a line, then it goes too.
                ViewThatFits(in: .vertical) {
                    prompt(kind, t, lock: true, lines: 3).padding(.top, 3)
                    prompt(kind, t, lock: false, lines: 2).padding(.top, 8)
                    prompt(kind, t, lock: false, lines: 1).padding(.top, 8)
                    EffortChips(kind: kind, chosen: t.value, pick: pick(kind, t)).padding(.top, 12)
                }
                .transition(.opacity)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .top, spacing: 8) {
                        next(up)
                        LockButton(health: store.health)
                    }
                    .frame(maxHeight: .infinity, alignment: .top)
                    RatedEffort(kind: kind, value: t.value ?? 0) { changing = true }
                }
                .padding(.horizontal, Theme.side)
                .padding(.top, 3)
                .transition(.opacity)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .animation(reduceMotion || dimmed ? nil : .easeInOut(duration: 0.2), value: asking)
    }

    /// "How hard was that set?" with the Lock, then the four chips under it.
    private func prompt(_ kind: String, _ t: Effort.Target, lock: Bool, lines: Int) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("How hard was that set?")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(lines)
                    .minimumScaleFactor(lines == 1 ? 0.7 : 1)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .dynamicTypeSize(...DynamicTypeSize.large)
                if lock { LockButton(health: store.health) }
            }
            .padding(.horizontal, Theme.side)
            .frame(minHeight: lock ? Theme.tap : nil)
            Spacer(minLength: lock ? 2 : 6)
            EffortChips(kind: kind, chosen: t.value, pick: pick(kind, t))
        }
    }

    /// A chip: a new rating is sent; the chosen one again only closes the chips.
    private func pick(_ kind: String, _ t: Effort.Target) -> (Double) -> Void {
        { v in
            if v != t.value {
                store.rateDone(v)
                // The chips go and focus with them: say what was saved.
                if store.rating?.value == v { AccessibilityNotification.Announcement("\(Effort.name(kind)) \(formatNumber(v))").post() }
            }
            changing = false
        }
    }

    private var upNext: Rest.Next? {
        guard store.show.showNext, let e = store.entry, let si = store.setIndex else { return nil }
        return Rest.next(e, set: si, unit: e.weightUnit(store.unit))
    }

    /// "Up next", the exercise, then its place, side and load, each on a line of its own. Short of room the
    /// label goes, then the place, then the name shrinks to one line: a line is dropped, never cut in half.
    @ViewBuilder private func next(_ n: Rest.Next?) -> some View {
        if let n {
            ViewThatFits(in: .vertical) {
                nextLines(n, label: true, nameLines: 2, place: true)
                nextLines(n, label: false, nameLines: 2, place: true)
                nextLines(n, label: false, nameLines: 2, place: false)
                nextLines(n, label: false, nameLines: 1, place: false)
                nextLines(n, label: false, nameLines: 1, place: false, details: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // Whichever lines fit, VoiceOver gets all of them.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: ([store.L("Up next"), n.name, place(n), side(n), load(n)] as [String?]).compactMap { $0 }.joined(separator: ", ")))
        } else {
            Spacer(minLength: 0)
        }
    }

    private func nextLines(_ n: Rest.Next, label: Bool, nameLines: Int, place showsPlace: Bool, details: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if label { Text("Up next").font(.footnote.weight(.semibold)).foregroundStyle(.secondary) }
            Text(verbatim: n.name)
                .font(.headline)
                .foregroundStyle(Theme.ink(.white, dimmed))
                .lineLimit(nameLines)
                .minimumScaleFactor(nameLines == 1 ? 0.75 : 1)      // the last resort: smaller, before cut off
            if showsPlace { detail(place(n), lines: 1) }
            if details, let s = side(n) { detail(s, lines: 1) }
            if details, let l = load(n) { detail(l, lines: 2) }
        }
        .multilineTextAlignment(.leading)
    }

    private func detail(_ text: String, lines: Int) -> some View {
        Text(verbatim: text).font(.footnote).foregroundStyle(.secondary).lineLimit(lines)
    }

    private func place(_ n: Rest.Next) -> String {
        n.position.number.map { String(format: store.L("Set %lld of %lld"), Int64($0), Int64(n.position.total)) } ?? store.L("Warm-up")
    }

    private func side(_ n: Rest.Next) -> String? { n.side.map { store.L($0 == "L" ? "Left" : "Right") } }

    /// A line breaks after a word, never inside the load ("62.5 kg × 8" stays whole).
    private func load(_ n: Rest.Next) -> String? {
        n.load.map { (n.bodyweight ? store.L("Bodyweight") + " " : "") + $0.replacingOccurrences(of: " ", with: "\u{00A0}") }
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
                    Text(timerInterval: Date()...end, countsDown: true)
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
        // Always On: a dimmer still frame.
        .opacity(dimmed || SessionStore.demoAOD ? 0.5 : 1)
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
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        if let hr = health.heartRate {
            HStack(spacing: 2) {
                Image(systemName: "heart.fill").font(.system(size: 9))
                Text(verbatim: "\(Int(hr.rounded()))").font(.caption2.monospacedDigit())
            }
            .foregroundStyle(Theme.ink(.red, dimmed))
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
