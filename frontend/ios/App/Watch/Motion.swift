import SwiftUI
import WatchKit

/*
 * Motion on the wrist, calm and with a reason (a glance mid-set is a second long):
 *
 *   screens   whole screens (start, 3-2-1, session, summary) and the set page's set, rest and
 *             hold fade into each other, ease-out 0.2 s, instead of cutting
 *   ‹ ›       the set's lines come in 12 pt from the side you went to while they fade in; the
 *             arrows and the button stay still under the thumb
 *   3-2-1     a ring that drains smoothly, each number springs in and the last one swells away,
 *             then GO! in the full ring for a moment while the workout starts under it
 *
 * Reduce Motion: no slides, no springs, no scaling, only short fades. Always On: nothing moves.
 */
enum Motion {
    static func fade(_ reduceMotion: Bool, _ dimmed: Bool) -> Animation? {
        dimmed ? nil : .easeOut(duration: reduceMotion ? 0.15 : 0.2)
    }

    /// The set's lines after ‹ (-1) or › (+1): in from that side, or just a fade.
    static func nudge(_ direction: Int, reduceMotion: Bool) -> AnyTransition {
        guard !reduceMotion else { return AnyTransition.opacity }
        return AnyTransition.asymmetric(insertion: AnyTransition.offset(x: CGFloat(12 * direction)).combined(with: .opacity),
                                        removal: AnyTransition.identity)
    }
}

/// The 3-2-1 before a workout started here (or before a hold that starts by itself). A tap starts
/// at once; the small button cancels (nothing starts, nothing is logged).
struct CountdownView: View {
    @EnvironmentObject var store: SessionStore
    let from: Date
    /// The same 3-2-1 before a hold that starts by itself (the phone's setting): its own words and actions.
    var label: Text? = nil
    var start: (() -> Void)? = nil
    var cancel: (() -> Void)? = nil
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 2) {
            Button { if let start = start { start() } else { store.startNow() } } label: {
                ZStack {
                    SmoothRing(from: from, seconds: Double(Countdown.seconds), color: accent)
                    TimelineView(.periodic(from: from, by: 1)) { ctx in
                        let n = max(1, Countdown.number(at: ctx.date.timeIntervalSince(from)))
                        ZStack {
                            Text(verbatim: "\(n)")
                                .font(.system(size: TypeScale.hero, weight: .bold, design: .rounded).monospacedDigit())
                                .foregroundStyle(accent)
                                .id(n)
                                .transition(reduceMotion || dimmed ? AnyTransition.opacity
                                            : AnyTransition.asymmetric(insertion: AnyTransition.scale(scale: 0.4).combined(with: .opacity),
                                                                       removal: AnyTransition.scale(scale: 1.35).combined(with: .opacity)))
                        }
                        .animation(dimmed ? nil : (reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.3, dampingFraction: 0.55)), value: n) // a punch, then settle (Direction B)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(label ?? Text("Start workout"))
                        .accessibilityValue(Text(verbatim: "\(n)"))
                    }
                }
                .aspectRatio(1, contentMode: .fit)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 6)
            HStack {
                EdgeButton(systemImage: "xmark", label: Text("Cancel")) { if let cancel = cancel { cancel() } else { store.cancelCountdown() } }
                Spacer()
            }
        }
        .ignoresSafeArea(edges: .bottom)
    }
}

/// A ring that empties once over `seconds`, drawn from the clock every frame so it drains in one
/// smooth line (it ran in visible jumps at four redraws a second). Three seconds of frames is
/// cheap; with the wrist down it moves once a second.
struct SmoothRing: View {
    let from: Date
    let seconds: Double
    let color: Color
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.animation(minimumInterval: dimmed ? 1 : nil)) { ctx in
            let left = RestMath.left(start: from, end: from.addingTimeInterval(seconds), now: ctx.date)
            ZStack {
                Circle().stroke(Theme.surface2, lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(left))
                    .stroke(color.opacity(dimmed ? 0.6 : 1), style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .padding(4)
        }
        .accessibilityHidden(true)
    }
}

/// GO! in the full ring, for a moment as the workout (or a hold) starts under it.
struct GoView: View {
    @Environment(\.accent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        ZStack {
            Color.black
            Circle()
                .stroke(accent, style: StrokeStyle(lineWidth: shown || reduceMotion ? 7 : 14, lineCap: .round))
                .padding(10)
            // The ring flashes out as GO! lands (Direction B).
            Circle()
                .stroke(accent, lineWidth: 3)
                .padding(10)
                .scaleEffect(shown ? 1.15 : 1)
                .opacity(shown || reduceMotion ? 0 : 0.8)
            Text("Go!")
                .font(.system(size: 52, weight: .heavy, design: .rounded))
                .foregroundStyle(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .padding(.horizontal, 26)
                .scaleEffect(shown || reduceMotion ? 1 : 0.7)
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .ignoresSafeArea()
        .onAppear {
            withAnimation(reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.5)) { shown = true }
        }
        .accessibilityHidden(true)
    }
}
