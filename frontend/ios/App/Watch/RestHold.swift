import SwiftUI
import WatchKit

/*
 * The rest and a hold, on the set page. Both are about one number, so that number is big and
 * nothing else competes with it:
 *
 *   rest   the time left in the accent, a bar draining under it, −15, Skip and +15 as outlined
 *          capsules, the effort of the set just done as four chips, then what is up next (and what
 *          to load); ‹ opens the set just done to fix it while the rest runs on
 *   hold   the seconds left, a bar in the hold's teal (orange for the last five), and Stop
 *
 * The buttons wait a second after the rest comes up (the thumb that hit Done is still there).
 * Always On: the time stays, the buttons go.
 */
struct RestView: View {
    @EnvironmentObject var store: SessionStore
    let end: Date
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    // CI's Always On, which the pager's pages don't get as an environment value (see ClipView)
    private var dimmed: Bool { luminanceReduced || SessionStore.demoAOD }
    @Environment(\.accent) private var accent
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var timeSize: CGFloat = 40

    var body: some View {
        GeometryReader { g in
            let roomy = g.size.height >= 175 && !typeSize.isAccessibilitySize
            VStack(spacing: 4) {
                // The time left in the accent, at the left; the corner is the system clock's.
                HStack(spacing: 0) {
                    if store.lastLogged != nil {
                        ArrowButton(left: true, enabled: true) { store.fixLast() }
                            .opacity(dimmed ? 0 : 1)
                    }
                    Text(timerInterval: SafeNum.timerRange(min(Date(), end), end), countsDown: true)
                        .font(.system(size: timeSize, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundStyle(accent.opacity(dimmed ? 0.75 : 1))
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .padding(.leading, 4)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Color.clear.frame(width: 36, height: 1)
                }
                .frame(height: Theme.tap) // the same with and without the ‹
                if store.show.restRing {
                    TimeBar(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end, color: accent)
                        .frame(height: 4)
                        .padding(.horizontal, 4)
                }
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    Button { store.minusRest() } label: {
                        Text(verbatim: "−15").font(.system(.body, design: .rounded).weight(.bold)).frame(width: 40)
                    }
                    .buttonStyle(OutlineCapsule())
                    .accessibilityLabel(Text(verbatim: "−15 s"))
                    Button { store.skipRestAndGo() } label: {
                        Text("Skip").font(.system(.callout, design: .rounded).weight(.semibold)).lineLimit(1).minimumScaleFactor(0.6).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(OutlineCapsule())
                    Button { store.addRest(15) } label: {
                        Text(verbatim: "+15").font(.system(.body, design: .rounded).weight(.bold)).frame(width: 40)
                    }
                    .buttonStyle(OutlineCapsule())
                    .accessibilityLabel(Text(verbatim: "+15 s"))
                }
                .opacity(dimmed ? 0 : 1)
                let chips = store.canRateLast && !dimmed
                if chips {
                    EffortChips(label: roomy, tall: roomy)
                }
                // With the chips there is no room for the exercise's name (the chips' label has it),
                // and on a small watch none for "Up next" either.
                if store.show.showNext && (roomy || !chips) { upNext(roomy: roomy, name: !chips) }
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .top)
        }
        .padding(.horizontal, 2)
        .padding(.bottom, 12) // the page dots
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    /// "Up next" in the accent, the set after it ("Bench Press, set 3 · Left") and what to load (#911).
    @ViewBuilder private func upNext(roomy: Bool, name: Bool) -> some View {
        if let e = store.entry, let si = store.setIndex {
            VStack(alignment: .leading, spacing: 0) {
                Text("Up next").font(.system(.footnote, design: .rounded).weight(.bold)).foregroundStyle(accent)
                if name && !typeSize.isAccessibilitySize {
                    Group {
                        if let side = store.sideUp {
                            Text("\(e.name), set \(Int64(SetNav.place(e, si).n))") + Text(verbatim: " · ")
                                + Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                        } else {
                            Text("\(e.name), set \(Int64(SetNav.place(e, si).n))")
                        }
                    }
                    .font(.system(.footnote, design: .rounded))
                    .foregroundStyle(Theme.label2)
                    .lineLimit(roomy ? 2 : 1)
                    .truncationMode(.middle)
                    .minimumScaleFactor(0.85)
                }
                if let numbers = store.nextSetNumbers {
                    Text(verbatim: numbers)
                        .font(.system(roomy ? .callout : .footnote, design: .rounded).weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.label2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 4)
        }
    }
}

/// The rest screen's buttons: a thin white outline, no fill, 38 pt tall (the look of the old Coaich app).
struct OutlineCapsule: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .foregroundStyle(.white)
            .frame(height: 38)
            .background(Capsule().fill(configuration.isPressed ? Theme.surface2 : Color.clear))
            .overlay(Capsule().strokeBorder(.white.opacity(0.5), lineWidth: 1.5))
            .contentShape(Capsule())
    }
}

/// "RIR · Bench Press, set 2" and four round chips outlined in their effort colour; once rated,
/// the rating in a small capsule that opens the chips again.
struct EffortChips: View {
    @EnvironmentObject var store: SessionStore
    let label: Bool // the "RIR · exercise" line above the chips
    let tall: Bool // 38 pt chips; 34 where the screen is short
    @State private var again = false

    /// The exercise and set the chips rate: the one just done.
    private var rated: Text? {
        guard let ref = store.lastLogged, let w = store.workout, w.entries.indices.contains(ref.entry) else { return nil }
        let e = w.entries[ref.entry]
        guard e.sets.indices.contains(ref.set) else { return nil }
        return Text("\(e.name), set \(Int64(SetNav.place(e, ref.set).n))")
    }

    var body: some View {
        content.frame(height: (label ? 26 : 0) + (tall ? 38 : 34)) // fixed: the rated capsule must not move what is below
    }

    @ViewBuilder private var content: some View {
        let kind = store.effortKind ?? "rir"
        if let rated = store.lastRated, !again {
            Button { again = true } label: {
                HStack(spacing: 4) {
                    Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, rated))")
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                }
                .font(.system(.footnote, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(Effort.color(kind, rated))
                .padding(.horizontal, 10)
                .frame(minHeight: tall ? 38 : 34)
                .background(Capsule().fill(Effort.color(kind, rated).opacity(0.18)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Effort"))
            .accessibilityValue(Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, rated))"))
            .accessibilityHint(Text("Tap to change it."))
        } else {
            VStack(spacing: 2) {
                if label {
                    (Text(verbatim: "\(Effort.name(kind)) · ") + (self.rated ?? Text("How hard was that set?")))
                        .font(.system(.footnote, design: .rounded).weight(.bold))
                        .foregroundStyle(Theme.label2)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 4)
                }
                HStack(spacing: 4) {
                    ForEach(Effort.chips(kind), id: \.self) { v in
                        Button {
                            store.rateLast(v)
                            again = false
                        } label: {
                            Text(verbatim: Effort.chipLabel(kind, v))
                                .font(.system(.body, design: .rounded).weight(.bold).monospacedDigit())
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: tall ? 38 : 34, maxHeight: tall ? 38 : 34)
                                .overlay(Capsule().strokeBorder(Effort.color(kind, v), lineWidth: 1.5))
                                .contentShape(Capsule())
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
            .opacity(dimmed ? 0 : 1)
        }
        .padding(.horizontal, 2)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }
}
