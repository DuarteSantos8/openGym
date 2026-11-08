import SwiftUI
import WatchKit

/*
 * The rest and a hold, on the set page. Both are about one number, so that number is big and
 * nothing else competes with it:
 *
 *   rest   the time left, a bar draining under it, what is up next (and what to load), the effort
 *          of the set just done as four chips, then −15 s, Skip and +15 s; ‹ opens the set just
 *          done to fix it while the rest runs on
 *   hold   the seconds left, a bar in the hold's teal (orange for the last five), and Stop
 *
 * The buttons wait a second after the rest comes up (the thumb that hit Done is still there).
 * Always On: the time stays, the buttons go.
 */
struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var timeSize: CGFloat = 46

    var body: some View {
        GeometryReader { g in
            let roomy = g.size.height >= 175 && !typeSize.isAccessibilitySize
            VStack(spacing: 4) {
                HStack(spacing: 0) {
                    if store.lastLogged != nil {
                        ArrowButton(left: true, enabled: true) { store.fixLast() }
                            .opacity(dimmed ? 0 : 1)
                    } else {
                        Color.clear.frame(width: 30, height: 1)
                    }
                    VStack(spacing: -2) {
                        Text("Rest").font(.system(.caption2, design: .rounded).weight(.semibold)).foregroundStyle(Theme.label2)
                        Text(timerInterval: SafeNum.timerRange(min(Date(), end), end), countsDown: true)
                            .font(.system(size: timeSize, weight: .semibold, design: .rounded).monospacedDigit())
                            .foregroundStyle(dimmed ? Color.white.opacity(0.75) : Color.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    Color.clear.frame(width: 30, height: 1)
                }
                if store.show.restRing {
                    TimeBar(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end, color: accent)
                        .frame(height: 5)
                        .padding(.horizontal, 6)
                }
                if store.show.showNext { upNext(roomy: roomy) }
                Spacer(minLength: 0)
                if store.canRateLast && !dimmed {
                    EffortChips(roomy: roomy)
                }
                HStack(spacing: 4) {
                    EdgeButton(systemImage: "gobackward.15", label: Text(verbatim: "−15 s"), size: 40) { store.minusRest() }
                    Button { store.skipRestAndGo() } label: {
                        Label { Text("Skip") } icon: { Image(systemName: "forward.end.fill") }
                            .labelStyle(typeSize.isAccessibilitySize ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(RowButtonStyle())
                    .doubleTapTarget(.skipRest)
                    EdgeButton(systemImage: "goforward.15", label: Text(verbatim: "+15 s"), size: 40, target: .addRest) { store.addRest(15) }
                }
                .opacity(dimmed ? 0 : 1)
            }
            .frame(width: g.size.width, height: g.size.height)
        }
        .padding(.horizontal, 2)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    /// "Up next: Bench Press, set 3 · Left", and under it what to load (#911).
    @ViewBuilder private func upNext(roomy: Bool) -> some View {
        if let e = store.entry, let si = store.setIndex {
            VStack(spacing: 0) {
                Group {
                    if let side = store.sideUp {
                        Text("Up next") + Text(verbatim: ": ") + Text("\(e.name), set \(Int64(SetNav.place(e, si).n))") + Text(verbatim: " · ")
                            + Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                    } else {
                        Text("Up next") + Text(verbatim: ": ") + Text("\(e.name), set \(Int64(SetNav.place(e, si).n))")
                    }
                }
                .font(.system(.caption2, design: .rounded))
                .foregroundStyle(Theme.label2)
                .lineLimit(roomy ? 2 : 1)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.center)
                if let numbers = store.nextSetNumbers {
                    Text(verbatim: numbers)
                        .font(.system(.footnote, design: .rounded).weight(.semibold).monospacedDigit())
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
            }
        }
    }
}

/// "RIR · How hard was that set?" and four chips; once rated, the rating in a small capsule
/// that opens the chips again.
struct EffortChips: View {
    @EnvironmentObject var store: SessionStore
    let roomy: Bool
    @State private var again = false

    var body: some View {
        let kind = store.effortKind ?? "rir"
        if let rated = store.lastRated, !again {
            Button { again = true } label: {
                HStack(spacing: 4) {
                    Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, rated))")
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                }
                .font(.system(.caption2, design: .rounded).weight(.semibold).monospacedDigit())
                .foregroundStyle(Effort.color(kind, rated))
                .padding(.horizontal, 10)
                .frame(minHeight: 26)
                .background(Capsule().fill(Effort.color(kind, rated).opacity(0.18)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Effort"))
            .accessibilityValue(Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, rated))"))
            .accessibilityHint(Text("Tap to change it."))
        } else {
            VStack(spacing: 2) {
                if roomy {
                    (Text(verbatim: "\(Effort.name(kind)) · ") + Text("How hard was that set?"))
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(Theme.label2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                HStack(spacing: 4) {
                    ForEach(Effort.chips(kind), id: \.self) { v in
                        Button {
                            store.rateLast(v)
                            again = false
                        } label: {
                            Text(verbatim: Effort.chipLabel(kind, v))
                                .font(.system(.footnote, design: .rounded).weight(.semibold).monospacedDigit())
                                .foregroundStyle(Effort.color(kind, v))
                                .frame(maxWidth: .infinity, minHeight: 28)
                                .background(Capsule().fill(Effort.color(kind, v).opacity(0.18)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, v))"))
                    }
                }
            }
            .onChange(of: store.lastLogged) { _ in again = false }
        }
    }
}

/// A bar that empties from `start` to `end`. With the wrist down it moves once a second, not
/// four times: the screen is updated rarely then anyway, and each update costs.
struct TimeBar: View {
    let start: Date
    let end: Date
    var color: Color
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        TimelineView(.periodic(from: .now, by: dimmed ? 1 : 0.25)) { ctx in
            let left = RestMath.left(start: start, end: end, now: ctx.date)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(color.opacity(dimmed ? 0.6 : 1)).frame(width: max(0, g.size.width * left))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// A timed set running: the seconds left big, the bar, Stop (done with the seconds it lasted).
struct HoldView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .largeTitle) private var timeSize: CGFloat = 52

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Text(verbatim: store.entry?.name ?? "")
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if store.sideUp == "L" { Tag(text: Text("Left"), color: Theme.teal) }
                if store.sideUp == "R" { Tag(text: Text("Right"), color: Theme.teal) }
            }
            Spacer(minLength: 0)
            // The last five seconds in orange: nearly there.
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let close = end.timeIntervalSince(ctx.date) <= 5
                VStack(spacing: 4) {
                    Text(timerInterval: SafeNum.timerRange(min(ctx.date, end), end), countsDown: true)
                        .font(.system(size: timeSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(close ? Theme.orange : Color.white)
                        .opacity(dimmed ? 0.75 : 1)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    TimeBar(start: store.holdStartedAt ?? end, end: end, color: close ? Theme.orange : Theme.teal)
                        .frame(height: 5)
                        .padding(.horizontal, 8)
                }
            }
            Text("Hold").font(.system(.caption2, design: .rounded)).foregroundStyle(Theme.label2)
            Spacer(minLength: 0)
            Button { store.endHold(early: true) } label: {
                Label { Text("Stop") } icon: { Image(systemName: "stop.fill") }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(RowButtonStyle())
            .doubleTapTarget(.stopHold)
            .opacity(dimmed ? 0 : 1)
        }
        .padding(.horizontal, 2)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}
