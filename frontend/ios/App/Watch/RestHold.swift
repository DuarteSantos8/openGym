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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// What −15 / +15 just did, summed while taps keep coming: "+30 s" in a small pill over the time (owner 2026-11-12).
    @State private var change = 0
    @State private var changeTap = 0
    /// The screen's height from which the effort label and 38 pt chips fit: 45, 46 and 49 mm (242, 248, 257 pt), not 41 or 44 mm (215, 224).
    private static let roomyHeight: CGFloat = 235

    var body: some View {
        GeometryReader { g in
            let roomy = g.size.height >= Self.roomyHeight && !typeSize.isAccessibilitySize
            let buttonHeight: CGFloat = roomy ? 38 : 36
            // Paused on the phone: only Skip (it ends the phone's rest too); −15 and +15 stand greyed out
            // until the phone's Resume brings the rest back.
            let paused = store.restPausedAt != nil
            VStack(spacing: 3) {
                // Level with the system clock (the page has no title to push it down): the ‹ glass circle,
                // and the heart rate just left of the clock. The row is always there, so the first reading moves nothing.
                HStack(spacing: 4) {
                    if store.lastLogged != nil {
                        Button { store.fixLast() } label: {
                            Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold)).frame(width: 34, height: 34)
                        }
                        .buttonStyle(.plain)
                        .glass(Circle(), fill: Theme.surface, dimmed: false)
                        .opacity(dimmed ? 0 : 1)
                        .accessibilityLabel(Text("Back"))
                    }
                    Spacer(minLength: 0)
                    RestHeart(health: store.health)
                    Color.clear.frame(width: 72, height: 1) // the clock's corner: its time and the workout glyph the system puts before it (65 pt on a 42 mm)
                }
                .offset(y: roomy ? 9 : 4) // the clock sits lower the bigger the case
                .frame(height: 36)
                // The time left fills what the rest leaves: digits are 0.72 of the font size, so the slot is 0.78.
                GeometryReader { t in
                    let digits = countdown
                        .font(.system(size: min(TypeScale.hero, max(28, t.size.height / 0.78)), weight: .semibold, design: .rounded).monospacedDigit())
                        .lineLimit(1)
                        .minimumScaleFactor(typeSize.isAccessibilitySize ? 0.5 : 0.85)
                        .frame(width: t.size.width, height: t.size.height)
                    if dimmed {
                        // Always On: the system ticks the seconds, nothing of ours moves them. A timeline, a content
                        // transition or a keyframe here can roll the digits both ways between the dimmed frames.
                        digits.foregroundStyle(accent.opacity(0.75))
                    } else {
                        // The last three seconds (Direction B): orange, and each one punches in. Redrawn only at those three moments.
                        // 3.5: a timeline's first entry counts as already shown, so 3 would never fire.
                        TimelineView(.explicit([3.5, 3, 2, 1].map { end.addingTimeInterval(-$0) })) { ctx in
                            let left = end.timeIntervalSince(ctx.date > Date() ? Date() : ctx.date) // before its first entry ctx.date is that future entry, not now
                            let last = !paused && left > 0.5 && left < 3.5 ? Int(left.rounded()) : 0
                            digits
                                .foregroundStyle(last > 0 ? Theme.orange : accent)
                                .contentTransition(.numericText(countsDown: true))
                                .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: end) // ±15 rolls the digits
                                .keyframeAnimator(initialValue: 1.0, trigger: reduceMotion ? 0 : last) { digits, s in
                                    digits.scaleEffect(s)
                                } keyframes: { _ in
                                    SpringKeyframe(1.12, duration: 0.1, spring: Spring(response: 0.12, dampingRatio: 0.9))
                                    SpringKeyframe(1.0, duration: 0.45, spring: Spring(response: 0.35, dampingRatio: 0.45))
                                }
                        }
                    }
                }
                .overlay(alignment: .top) {
                    if change != 0 && !dimmed {
                        let color = change > 0 ? accent : Theme.orange
                        Text(verbatim: change > 0 ? "+\(change) s" : "−\(-change) s")
                            .font(TypeScale.label.monospacedDigit())
                            .contentTransition(.numericText(value: Double(change)))
                            .foregroundStyle(color)
                            .padding(.horizontal, 8).frame(height: 20)
                            .background(Capsule().fill(Color.black))
                            .background(Capsule().fill(color.opacity(0.25)).padding(-0.5))
                            .overlay(Capsule().fill(color.opacity(0.2)))
                            .offset(y: -8)
                            // Pops up out of the time, floats up as it goes (Direction B).
                            .transition(reduceMotion ? .opacity : .asymmetric(
                                insertion: .scale(scale: 0.5).combined(with: .opacity).combined(with: .offset(y: 12)),
                                removal: .opacity.combined(with: .offset(y: -10))))
                            .accessibilityHidden(true) // the buttons say what they did
                    }
                }
                .animation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.3, dampingFraction: 0.6), value: change)
                .onChange(of: end) { old, new in
                    let d = Int(new.timeIntervalSince(old).rounded())
                    guard d != 0, abs(d) <= 120 else { return }
                    change += d
                    changeTap += 1
                    let tap = changeTap
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { if changeTap == tap { change = 0 } }
                }
                if store.show.restRing && store.restPausedAt == nil {
                    TimeBar(start: store.restStartedAt ?? end.addingTimeInterval(-90), end: end, color: accent)
                        .frame(height: 4)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 2)
                        .opacity(dimmed ? 0.75 : 1)
                }
                HStack(spacing: 6) {
                    Button { store.minusRest() } label: {
                        Text(verbatim: "−15").font(.system(.body, design: .rounded).weight(.bold)).frame(width: 40)
                    }
                    .buttonStyle(OutlineCapsule(height: buttonHeight))
                    .accessibilityLabel(Text(verbatim: "−15 s"))
                    .disabled(paused).opacity(paused ? 0.35 : 1)
                    Button { store.skipRestAndGo() } label: {
                        // The word when it fits whole, else the symbol: "Überspringen" and "Пропустить" were
                        // cut to "Überspring…" between ±15 on a 40 mm.
                        ViewThatFits(in: .horizontal) {
                            Text("Skip").font(.system(.callout, design: .rounded).weight(.semibold)).lineLimit(1).fixedSize()
                            Text("Skip").font(.system(.footnote, design: .rounded).weight(.semibold)).lineLimit(1).fixedSize()
                            Image(systemName: "forward.end.fill").font(.system(.callout, design: .rounded).weight(.semibold))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(OutlineCapsule(height: buttonHeight))
                    .accessibilityLabel(Text("Skip"))
                    Button { store.addRest(15) } label: {
                        Text(verbatim: "+15").font(.system(.body, design: .rounded).weight(.bold)).frame(width: 40)
                    }
                    .buttonStyle(OutlineCapsule(height: buttonHeight))
                    .accessibilityLabel(Text(verbatim: "+15 s"))
                    .disabled(paused).opacity(paused ? 0.35 : 1)
                }
                // In from the edges: with Up next off the row sits low, where the screen's corners round off.
                .padding(.horizontal, 4)
                .opacity(dimmed ? 0 : 1)
                // Always On hides the chips but keeps their place, so the screen is the same one
                if store.canRateLast {
                    EffortChips(label: roomy, tall: roomy).opacity(dimmed ? 0 : 1).allowsHitTesting(!dimmed)
                        // In from the edges like the ±15 row: on a 42 mm Series 12 the 0 and 3+ chips ran
                        // under the display's rounded edge (fine in a screenshot, cut on the wrist).
                        .padding(.horizontal, 4)
                }
                if store.show.showNext { upNext(roomy: roomy, name: true, bigCase: g.size.height >= Self.roomyHeight).padding(.top, 2) }
            }
            .frame(width: g.size.width, height: g.size.height - 12, alignment: .top) // 12: the page dots
            .overlay(alignment: .bottomLeading) { // the toolbar badges are hidden here (SessionBadges)
                SyncPill().padding(.leading, 16).padding(.bottom, 14) // clear of the rounded bottom corner
            }
        }
        .ignoresSafeArea(edges: [.top, .bottom])
        .padding(.horizontal, 2)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        // The rest's end even if its timer never fired (the app was away then, #1101): the set page
        // comes back instead of a countdown standing at 0:00.
        .task(id: end) {
            let wait = end.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(min(wait, 3600) * 1_000_000_000) + 50_000_000) }
            guard !Task.isCancelled else { return }
            store.restRanOutIfDue()
        }
    }

    /// The time left, counting down; standing still while the phone has the rest paused.
    @ViewBuilder private var countdown: some View {
        if let paused = store.restPausedAt {
            Text(verbatim: RestMath.clock(end.timeIntervalSince(paused)))
                .accessibilityLabel(Text("Rest"))
                .accessibilityValue(Text(verbatim: RestMath.clock(end.timeIntervalSince(paused))))
        } else {
            // The range starts when the rest did, not at Date(): a body that moves its own range is redrawn wrongly in Always On.
            Text(timerInterval: SafeNum.timerRange(store.restStartedAt ?? end.addingTimeInterval(-90), end), countsDown: true)
                .accessibilityLabel(Text("Rest"))
        }
    }

    private var upNextLabel: some View {
        Text("Up next").font(TypeScale.body).foregroundStyle(accent)
            .lineLimit(1).minimumScaleFactor(0.7) // "Als Nächstes" gives way to the readouts on 41 mm
    }

    /// "Up next" in the accent, the set after it ("Bench Press, set 3 · Left") and what to load (#911).
    @ViewBuilder private func upNext(roomy: Bool, name: Bool, bigCase: Bool) -> some View {
        if let e = store.entry, let si = store.setIndex {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 4) { upNextLabel; Spacer(minLength: 4); RestReadouts() }
                if name { // at accessibility sizes too: the countdown above gives way (it fills what is left)
                    Group {
                        if let side = store.sideUp {
                            Text("\(e.name), set \(Int64(SetNav.place(e, si).n))") + Text(verbatim: " · ")
                                + Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                        } else {
                            Text("\(e.name), set \(Int64(SetNav.place(e, si).n))")
                        }
                    }
                    .font(TypeScale.second)
                    .foregroundStyle(Theme.label2)
                    .lineLimit(roomy ? 2 : 1)
                    .truncationMode(.middle)
                    .minimumScaleFactor(0.85)
                }
                if let numbers = store.nextSetNumbers {
                    Text(verbatim: numbers)
                        .font(TypeScale.second.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.label2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        // The lowest line, where the 45-49 mm screens round off: "62.5 kg × 8" lost its 6 there.
                        .padding(.leading, bigCase ? 10 : 0) // by the case, not the text size (roomy is off at the largest sizes)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4) // trailing too: the workout time sat on the right edge (42 mm Series 12)
        }
    }
}

/// The heart rate (when shown and measured) in the top row, left of the system clock.
struct RestHeart: View {
    @EnvironmentObject var store: SessionStore
    @ObservedObject var health: WorkoutManager // a nested object: the store does not republish it
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    private var dimmed: Bool { luminanceReduced || SessionStore.demoAOD }

    var body: some View {
        if store.show.showHr, let hr = health.heartRate {
            HStack(spacing: 2) {
                Image(systemName: "heart.fill").foregroundStyle(.red)
                Text(verbatim: "\(SafeNum.rounded(hr))")
            }
            .font(.system(.callout, design: .rounded).weight(.bold).monospacedDigit())
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge) // the clock's corner does not grow with the text
            .foregroundStyle(.white)
            .opacity(dimmed ? 0.75 : 1)
            .lineLimit(1)
            .fixedSize()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Heart rate"))
            .accessibilityValue(Text(verbatim: "\(SafeNum.rounded(hr))"))
        }
    }
}

/// The workout time on the Up next line: the Metrics page's, so it need not be opened mid-rest.
struct RestReadouts: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    private var dimmed: Bool { luminanceReduced || SessionStore.demoAOD }

    var body: some View {
        if let start = store.workoutStart {
            Text(timerInterval: SafeNum.timerRange(start, Date.distantFuture), pauseTime: store.workoutPausedAt, countsDown: false)
                .font(TypeScale.second.weight(.bold).monospacedDigit())
                .foregroundStyle(Theme.label2)
                .opacity(dimmed ? 0.75 : 1)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: true, vertical: false)
        }
    }
}

/// The rest screen's buttons: a thin white outline, no fill, 38 pt tall (36 on a short screen; the look of the old Coaich app).
struct OutlineCapsule: ButtonStyle {
    var height: CGFloat = 38

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .foregroundStyle(.white)
            .frame(height: height)
            .glass(Capsule(), fill: configuration.isPressed ? Theme.surface2 : Color.clear, dimmed: false)
            .overlay(Capsule().strokeBorder(.white.opacity(Theme.hasGlass ? 0 : 0.5), lineWidth: 1.5))
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
    @Namespace private var chip
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The tapped chip grows into the rated capsule, and back (Direction B).
    private var morph: Animation? { reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.62) }
    /// The label's line grows with the text size (it is footnote, allowed up to accessibility2).
    @ScaledMetric(relativeTo: .footnote) private var labelHeight: CGFloat = 22

    /// The exercise and set the chips rate: the one just done.
    private var rated: Text? {
        guard let ref = store.lastLogged, let w = store.workout, w.entries.indices.contains(ref.entry) else { return nil }
        let e = w.entries[ref.entry]
        guard e.sets.indices.contains(ref.set) else { return nil }
        return Text("\(e.name), set \(Int64(SetNav.place(e, ref.set).n))")
    }

    var body: some View {
        content.frame(height: (label ? labelHeight : 0) + (tall ? 38 : 34)) // fixed: the rated capsule must not move what is below
    }

    @ViewBuilder private var content: some View {
        let kind = store.effortKind ?? "rir"
        if let rated = store.lastRated, !again {
            Button { withAnimation(morph) { again = true } } label: {
                HStack(spacing: 4) {
                    Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, rated))")
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                }
                .font(.system(.footnote, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(Effort.color(kind, rated))
                .padding(.horizontal, 10)
                .frame(minHeight: tall ? 38 : 34)
                .glass(Capsule(), tint: Effort.color(kind, rated).opacity(0.35), fill: Effort.color(kind, rated).opacity(0.18), dimmed: false)
                .matchedGeometryEffect(id: rated, in: chip)
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
                            withAnimation(morph) { store.rateLast(v); again = false }
                        } label: {
                            Text(verbatim: Effort.chipLabel(kind, v))
                                .font(.system(.body, design: .rounded).weight(.bold).monospacedDigit())
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: tall ? 38 : 34, maxHeight: tall ? 38 : 34)
                                .overlay(Capsule().strokeBorder(Effort.color(kind, v), lineWidth: 1.5))
                                .contentShape(Capsule())
                                .matchedGeometryEffect(id: v, in: chip)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: dimmed ? 1 : 0.25)) { ctx in
            let left = RestMath.left(start: start, end: end, now: ctx.date)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(color.opacity(dimmed ? 0.6 : 1)).frame(width: max(0, g.size.width * left))
                        .animation(dimmed || reduceMotion ? nil : .spring(response: 0.35, dampingFraction: 0.7), value: end) // ±15 slides, not jumps
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
    @ScaledMetric(relativeTo: .largeTitle) private var timeSize: CGFloat = TypeScale.hero

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Text(verbatim: store.entry?.name ?? "")
                    .font(TypeScale.title)
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
            Text("Hold").font(TypeScale.label).textCase(.uppercase).foregroundStyle(Theme.label2)
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
