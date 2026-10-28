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
}

func formatNumber(_ v: Double) -> String {
    v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
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
            } else if let end = store.holdEndsAt {
                HoldView(end: end)
            } else if let end = store.restEndsAt, end > Date() {
                RestView(end: end)
            } else {
                ExercisePager()
            }
        }
        // The app's language, as the phone sends it, not the watch's own (SwiftUI looks every
        // Text's words up by this locale).
        .environment(\.locale, store.locale)
        // No set for 20 minutes. Never a finish in one tap: "Finish workout" goes to the Finish page.
        .alert(Text("All done?"), isPresented: $store.askDone) {
            Button("Continue workout", role: .cancel) { store.keepGoing() }
            Button("Finish workout") {
                store.keepGoing()
                store.show(entry: store.workout?.entries.count ?? 0)
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

    var body: some View {
        text
            .font(.system(.caption2, design: .rounded).weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.18)))
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

/* ---------- a big round primary button ---------- */

struct RoundButton: View {
    let systemImage: String
    let label: Text
    var size: CGFloat = 76
    /// The label under the button, said in words (on by default: "Done" under the check).
    var caption = true
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        VStack(spacing: 3) {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.44, weight: .heavy))
                    .foregroundStyle(dimmed ? Theme.accent : Color.black)
                    .frame(width: size, height: size)
                    .background(Circle().fill(dimmed ? Color.clear : Theme.accent))
                    .overlay(Circle().stroke(Theme.accent, lineWidth: dimmed ? 2 : 0))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            // The word under it in the accent too, so Done reads as the one thing to press.
            if caption { label.font(.caption2.weight(.bold)).foregroundStyle(dimmed ? Color.secondary : Theme.accent).lineLimit(1) }
        }
    }
}

/// A small round secondary button at an edge: an SF Symbol on a dim disc, a 44 pt target.
struct EdgeButton: View {
    let systemImage: String
    let label: Text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: Theme.tap, height: Theme.tap)
                .background(Circle().fill(Theme.dim))
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

    var body: some View {
        if health.running {
            EdgeButton(systemImage: "drop.fill", label: Text("Lock")) { WKInterfaceDevice.current().enableWaterLock() }
        }
    }
}

/// The 3-2-1 before a workout started here: big numbers in a ring that empties once. A tap
/// starts at once; the small button cancels (nothing starts, nothing is logged).
struct CountdownView: View {
    @EnvironmentObject var store: SessionStore
    let from: Date

    var body: some View {
        VStack(spacing: 2) {
            TimelineView(.periodic(from: from, by: 1)) { ctx in
                let n = max(1, Countdown.number(at: ctx.date.timeIntervalSince(from)))
                Button { store.startNow() } label: {
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
                .accessibilityLabel(Text("Start workout"))
                .accessibilityValue(Text(verbatim: "\(n)"))
            }
            .padding(.horizontal, 6)
            HStack {
                EdgeButton(systemImage: "xmark", label: Text("Cancel")) { store.cancelCountdown() }
                Spacer()
            }
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

/* ---------- no workout: start one ---------- */

struct IdleView: View {
    @EnvironmentObject var store: SessionStore
    @State private var debug = false

    var body: some View {
        content
            // Hidden: a long press shows what arrived from the phone (animations, sync, heart rate).
            .onLongPressGesture(minimumDuration: 2) { debug = true }
            .sheet(isPresented: $debug) { DebugView() }
    }

    @ViewBuilder private var content: some View {
        if let ready = store.ready, ready.today != nil || !ready.others.isEmpty {
            ScrollView {
                VStack(spacing: 10) {
                    if let today = ready.today {
                        Text(today.name)
                            .font(.system(.headline, design: .rounded))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                            .multilineTextAlignment(.center)
                        RoundButton(systemImage: "play.fill", label: Text("Start workout")) { store.start(today) }
                    }
                    if !ready.others.isEmpty {
                        VStack(spacing: 4) {
                            ForEach(Array(ready.others.enumerated()), id: \.offset) { pair in
                                Button { store.start(pair.element) } label: {
                                    HStack {
                                        Text(pair.element.name).lineLimit(1).minimumScaleFactor(0.8)
                                        Spacer(minLength: 4)
                                        Image(systemName: "play.fill").font(.caption2).foregroundStyle(.secondary)
                                    }
                                    .frame(minHeight: Theme.tap)
                                    .padding(.horizontal, 10)
                                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.dim))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.top, 6)
                    }
                }
                .padding(.horizontal, 4)
            }
        } else {
            // Nothing from the phone yet (it sends only while openGym runs there): say so, rather
            // than a "no workout" that reads as if the two were in touch.
            let fresh = !store.heardFromPhone && store.ready == nil
            VStack(spacing: 10) {
                OpenGymLogo()
                    .fill(Theme.accent)
                    .frame(width: 60, height: 30)
                    .accessibilityHidden(true)
                Text(fresh ? LocalizedStringKey("Not synced yet") : LocalizedStringKey("No workout running"))
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text(fresh ? LocalizedStringKey("Open openGym on your iPhone once and your routines show up here.")
                     : LocalizedStringKey("Start one on your iPhone and it shows up here."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 8)
        }
    }
}

/* ---------- the exercises, one per page ---------- */

struct ExercisePager: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        // Vertical pages, swiped; the crown belongs to the numbers on the page (like a volume).
        TabView(selection: Binding(get: { store.entryIndex }, set: { store.show(entry: $0) })) {
            ForEach(Array((store.workout?.entries ?? []).enumerated()), id: \.offset) { pair in
                ExercisePage(index: pair.offset).tag(pair.offset)
            }
            FinishPage().tag(store.workout?.entries.count ?? 0)
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
 * One exercise, one set up next. The numbers are two big tiles (weight, reps); a tap on one opens
 * it on a screen of its own, where the Digital Crown turns only that value, in the exercise's own
 * steps with a tap of the crown at each, and − and + do the same by hand. On this page the crown
 * belongs to the pages (the next exercise), as in Apple's Workout app.
 */
struct ExercisePage: View {
    @EnvironmentObject var store: SessionStore
    let index: Int
    @State private var editing: EditField?
    @State private var confirmSkip = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .title) private var doneSizeScaled: CGFloat = 58
    /// Large enough to hit, small enough to leave room for the numbers at the largest text sizes.
    private var doneSize: CGFloat { min(doneSizeScaled, typeSize.isAccessibilitySize ? 56 : 66) }

    var body: some View {
        if let w = store.workout, w.entries.indices.contains(index) {
            let entry = w.entries[index]
            let si = store.setIndex(in: index)
            let current = index == store.entryIndex
            VStack(spacing: 0) {
                header(entry)
                Spacer(minLength: 2)
                if let si = si {
                    let row = entry.sets[si]
                    tags(entry, row)
                    if entry.isCardio {
                        Text("Log this one on your iPhone.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .minimumScaleFactor(0.7)
                    } else if entry.isTimed {
                        ValueTile(value: formatNumber(current ? store.seconds : (row.sec ?? 0)), unit: "s", label: Text("Hold"),
                                  tint: .white, large: true) { if current { editing = .seconds } }
                    } else {
                        numbers(entry, row, unit: w.unit, current: current)
                    }
                    if store.show.showLast, let last = entry.last, !last.isEmpty {
                        Text("Last time: \(last)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .padding(.top, 1)
                            .dynamicTypeSize(...DynamicTypeSize.large)
                    }
                    Spacer(minLength: 2)
                    primaryButton(entry, current: current)
                    Spacer(minLength: 3)
                    SetDots(entry: entry, current: si, skipped: { store.isSkipped(entry.id, $0) }) { store.pick(set: $0, in: index) }
                } else {
                    let left = entry.sets.contains { !$0.done }
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
            .padding(.horizontal, 4)
            // The set's layout is fixed (numbers, Done, dots on one screen): text grows up to a size
            // that still fits on 41 mm; the start screen and the summary scroll and grow all the way.
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            .onAppear {
                if current, SessionStore.demoScreen == "edit-weight" { editing = .weight }
                if current, SessionStore.demoScreen == "edit-reps" { editing = .reps }
            }
            .sheet(item: $editing) { field in
                ValueEditor(field: field, entry: entry, unit: w.unit)
            }
            .confirmationDialog(Text("Skip this set?"), isPresented: $confirmSkip) {
                Button("Skip set") { store.skipSet() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    /// Weight × reps as two tiles; a bodyweight set: the reps big, the added weight small.
    @ViewBuilder private func numbers(_ entry: Entry, _ row: SetRow, unit: String, current: Bool) -> some View {
        let side = row.sideUp.flatMap { row.sides?[$0] }
        let weight = current ? store.weight : (side?.w ?? row.w ?? 0)
        let reps = current ? store.reps : (side?.r ?? row.r ?? 0)
        let tint = row.warmup ? Theme.warmup : Color.white
        if entry.isBodyweight {
            VStack(spacing: 3) {
                ValueTile(value: formatNumber(reps), unit: nil, label: Text("Reps"), tint: tint, large: true) { if current { editing = .reps } }
                Button { if current { editing = .weight } } label: {
                    Group {
                        if weight > 0 { Text(verbatim: "+\(formatNumber(weight)) \(unit)") } else { Text("Bodyweight") }
                    }
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 22)
                    .background(Capsule().fill(Theme.dim))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(weight > 0 ? Text(verbatim: "+\(formatNumber(weight)) \(unit)") : Text("Bodyweight"))
                .accessibilityHint(Text("Tap to change it."))
            }
        } else {
            HStack(spacing: 6) {
                ValueTile(value: formatNumber(weight), unit: unit, label: Text("Weight"), tint: tint) { if current { editing = .weight } }
                ValueTile(value: formatNumber(reps), unit: nil, label: Text("Reps"), tint: tint) { if current { editing = .reps } }
            }
        }
    }

    @ViewBuilder private func header(_ entry: Entry) -> some View {
        HStack(alignment: .top, spacing: 6) {
            if store.show.showClip, let clip = store.clips[entry.id] {
                ClipView(clip: clip, animating: index == store.entryIndex).frame(width: 30, height: 30)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.name)
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    // One line at the large sizes (shrunk to fit): two would push the page up into the clock.
                    .lineLimit(typeSize.isAccessibilitySize ? 1 : 2)
                    .minimumScaleFactor(typeSize.isAccessibilitySize ? 0.6 : 0.8)
                    .fixedSize(horizontal: false, vertical: true)
                WorkoutExtras()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            OfflineSign()
            if store.show.showHr { HeartRateBadge(health: store.health) }
        }
        // The top row sits just under the clock: it grows less than the numbers do.
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    /// Warm-up, the side up next, superset: what kind of set this is, above the numbers.
    @ViewBuilder private func tags(_ entry: Entry, _ row: SetRow) -> some View {
        let side = row.sideUp
        if row.warmup || side != nil || entry.group != nil {
            HStack(spacing: 4) {
                if row.warmup { Tag(text: Text("Warm-up"), color: Theme.warmup) }
                if side == "L" { Tag(text: Text("Left"), color: .cyan) }
                if side == "R" { Tag(text: Text("Right"), color: .cyan) }
                if entry.group != nil { Tag(text: Text("Superset"), color: .purple) }
            }
            .padding(.bottom, 2)
            .dynamicTypeSize(...DynamicTypeSize.xLarge)
        }
    }

    /// Done in the middle; with a profile that rates effort, the RPE / RIR button at its left (the
    /// same room again on the right keeps Done centred under the numbers).
    @ViewBuilder private func primaryButton(_ entry: Entry, current: Bool) -> some View {
        if let kind = store.effortKind, !entry.isCardio, let si = store.setIndex(in: index), !entry.sets[si].warmup {
            HStack(spacing: 6) {
                EffortButton(kind: kind, value: current ? store.effort : nil) { if current { editing = .effort } }
                    .disabled(!current)
                doneButton(entry, current: current)
                Color.clear.frame(width: Theme.tap, height: Theme.tap).accessibilityHidden(true)
            }
        } else {
            doneButton(entry, current: current)
        }
    }

    @ViewBuilder private func doneButton(_ entry: Entry, current: Bool) -> some View {
        Group {
            if entry.isTimed {
                RoundButton(systemImage: "play.fill", label: Text("Start hold"), size: doneSize,
                            caption: !typeSize.isAccessibilitySize) { store.startHold() }
            } else {
                // At the accessibility sizes the word under the check goes (VoiceOver still says it):
                // the room it takes is what pushed the page up into the clock on 41 mm.
                RoundButton(systemImage: "checkmark", label: Text("Done"), size: doneSize,
                            caption: !typeSize.isAccessibilitySize) { store.completeSet() }
            }
        }
        .disabled(!current)
        // A long press: skip this set instead (VoiceOver: an action of its own).
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in if current { confirmSkip = true } })
        .accessibilityAction(named: Text("Skip set")) { store.skipSet() }
    }
}

/// The time so far and the calories, under the exercise's name, when the phone says to show them.
struct WorkoutExtras: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        let show = store.show
        if show.showElapsed || show.showKcal {
            HStack(spacing: 6) {
                if show.showElapsed, let start = store.workoutStart {
                    Text(timerInterval: start...Date.distantFuture, countsDown: false)
                        .monospacedDigit()
                }
                if show.showKcal { CaloriesText(health: store.health) }
            }
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundStyle(Theme.warmup)
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

    var body: some View {
        let color = value.map { Effort.color(kind, $0) } ?? Color.white
        Button(action: tap) {
            VStack(spacing: -1) {
                Text(verbatim: Effort.name(kind)).font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                Text(verbatim: value.map(formatNumber) ?? "–")
                    .font(.system(size: 16, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(width: Theme.tap, height: Theme.tap)
            .background(Circle().fill(value == nil ? Theme.dim : color.opacity(0.22)))
            .overlay(Circle().stroke(color.opacity(value == nil ? 0 : 0.9), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .dynamicTypeSize(...DynamicTypeSize.large)
        .accessibilityLabel(Text("Effort"))
        .accessibilityValue(value.map { Text(verbatim: "\(Effort.name(kind)) \(formatNumber($0))") } ?? Text("None"))
        .accessibilityHint(Text("Tap to change it."))
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

/// A number you can tap to change: big, in a soft rounded tile so it reads as a control, its unit
/// small beside it and what it is in words under it.
struct ValueTile: View {
    let value: String
    let unit: String?
    let label: Text
    var tint: Color = .white
    var large = false
    let tap: () -> Void
    // The numbers are what a glance between sets is for: as big as the tile lets them be.
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 34
    @ScaledMetric(relativeTo: .largeTitle) private var largeSize: CGFloat = 42
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button(action: tap) {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(verbatim: value)
                        .font(.system(size: large ? largeSize : size, weight: .semibold, design: .rounded).monospacedDigit())
                    if let u = unit {
                        Text(verbatim: u).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                label.font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                    .dynamicTypeSize(...DynamicTypeSize.large)
            }
            .foregroundStyle(tint.opacity(dimmed ? 0.7 : 1))
            .frame(maxWidth: .infinity, minHeight: Theme.tap)
            .padding(.vertical, 3)
            // Always On: no lit tiles, only their outline (less light, the numbers still read).
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(dimmed ? Color.clear : Theme.dim))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.dim, lineWidth: dimmed ? 1 : 0))
        }
        .buttonStyle(.plain)
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
        case .weight: return entry.step.flatMap { $0 > 0 ? $0 : nil } ?? store.weightStep
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
        // VoiceOver: "Set 2 of 4, 1 done", swipe up or down to pick another set.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Set \((current ?? 0) + 1) of \(entry.sets.count)"))
        .accessibilityValue(Text("\(entry.sets.filter { $0.done }.count) done"))
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

/// After the last exercise: one round button, finish and save (on the phone, as its Finish and save).
struct FinishPage: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirming = false

    var body: some View {
        VStack(spacing: 8) {
            Text(verbatim: store.workout?.name ?? "")
                .font(.system(.footnote, design: .rounded).weight(.semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
            RoundButton(systemImage: "flag.checkered", label: Text("Finish workout")) { confirming = true }
            let p = store.progress
            if p.total > 0 {
                Text("\(p.done) of \(p.total) sets").font(.caption2).foregroundStyle(.secondary)
            }
            if store.offline {
                Text("Saved on the watch, syncs later").font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            LockButton(health: store.health)
        }
        .padding(.horizontal, 6)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .confirmationDialog("Finish workout?", isPresented: $confirming) {
            Button("Finish and save") { store.finish() }
            Button("Discard workout", role: .destructive) { store.discard() }
            Button("Cancel", role: .cancel) {}
        }
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
                    Text(timerInterval: Date()...end, countsDown: true)
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
                EdgeButton(systemImage: "forward.end.fill", label: Text("Skip")) { store.skipRest() }
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
