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
        let store = self.store
        store.health.recover(workoutId: store.state.workout?.id) { store.state.workout != nil }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.scenePhase) private var scenePhase

    /// Which whole screen is up: a change fades (Motion), never cuts.
    private enum Screen: Hashable { case weighIn, summary, countdown, home, prompt, session }

    private var screen: Screen {
        if store.weighInFor != nil { return .weighIn }
        if store.summary != nil { return .summary }
        if store.workout == nil { return store.countdownFrom != nil ? .countdown : .home }
        if store.askDone && store.restEndsAt == nil && store.holdEndsAt == nil { return .prompt }
        return .session
    }

    var body: some View {
        ZStack {
            switch screen {
            case .weighIn: WeighInView().transition(.opacity)
            case .summary:
                if let summary = store.summary { SummaryView(summary: summary).transition(.opacity) }
            case .countdown:
                if let from = store.countdownFrom { CountdownView(from: from).transition(.opacity) }
            case .home: HomeView().transition(.opacity)
            case .prompt: IdlePrompt().transition(.opacity)
            case .session: SessionView().transition(.opacity)
            }
            // GO! over the workout that has just started under it.
            if store.goAt != nil {
                GoView().transition(.opacity).zIndex(1)
            }
        }
        .animation(Motion.fade(reduceMotion, dimmed), value: screen)
        // A removal still in its Undo time goes out the moment the app is not in front.
        .onChange(of: scenePhase) { _, p in if p != .active { store.flushRemoval() } }
        .animation(Motion.fade(reduceMotion, dimmed), value: store.goAt)
        // The app's language, as the phone sends it, not the watch's own (SwiftUI looks every
        // Text's words up by this locale), and the app's accent.
        .environment(\.locale, store.locale)
        .environment(\.accent, store.accent)
        .environment(\.onAccent, store.onAccent)
        .tint(store.accent)
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

extension Effort {
    /// The phone's band colours (index.css --purple … --green, then the accent's soft tone).
    static func color(_ kind: String, _ value: Double) -> Color {
        [Theme.purple, Theme.red, Theme.orange, Theme.yellow, Theme.accent, Theme.teal][band(kind, value)]
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
                    let i = max(0, min(clip.images.count - 1, SafeNum.int(t / max(0.1, clip.duration) * Double(clip.images.count))))
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
                Text(verbatim: "\(SafeNum.rounded(hr))").font(.caption2.monospacedDigit())
            }
            .foregroundStyle(.red)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Heart rate"))
            .accessibilityValue(Text(verbatim: "\(SafeNum.rounded(hr))"))
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
