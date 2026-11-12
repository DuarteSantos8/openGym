import SwiftUI
import WatchKit

/*
 * A running workout, as one screen with pages side by side, like Apple's Workout:
 *
 *   Overview  ←  Set  →  …
 *
 * The set page is where the workout happens: the set up next, the rest after it, a hold while it
 * runs. Swipe right for the Overview: every exercise with its sets, a tap jumps there, and Finish
 * is a hold at its bottom, so a workout never ends on a stray tap. After the last set the Overview
 * comes up by itself. With the wrist down the screen goes back to the set page.
 */
enum SessionTab: Hashable {
    case overview, set, metrics, music
}

struct SessionView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        ZStack {
        NavigationStack {
            TabView(selection: $store.tab) {
                OverviewPage().tag(SessionTab.overview)
                LivePage().tag(SessionTab.set)
                MetricsStack().tag(SessionTab.metrics)
                MusicPage().tag(SessionTab.music)
            }
            .tabViewStyle(.page)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    // On a hold or its countdown the pill stays beside the clock (review 2026-11-12).
                    if !store.ownTopRow { SessionBadges(pill: store.tab == .set).environmentObject(store) }
                }
            }
        }
        // The set menu, over everything but the system clock.
        if let r = store.menuFor { MenuLayer(ref: r).zIndex(1) }
        DoneRipple().zIndex(2)
        }
        // Wrist down on the Overview: the set is what the next glance is for.
        .onChange(of: dimmed) { down in
            if down && (store.tab == .overview || store.tab == .music) { store.tab = .set }
        }
    }
}

/// A set done with Done: a ring in the accent, the button's shape, ripples out from it and fades while
/// the rest comes in (Direction B, owner 2026-11-11). Over everything, never in the way of a touch.
struct DoneRipple: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var out = false
    @State private var shown = false

    var body: some View {
        GeometryReader { g in
            let f = store.doneFrame, o = g.frame(in: .global).origin
            Capsule()
                .stroke(accent, lineWidth: out ? 1 : 4)
                .frame(width: f.width, height: f.height)
                .scaleEffect(out ? 1.55 : 1)
                .opacity(shown && !out ? 0.9 : 0)
                .position(x: f.midX - o.x, y: f.midY - o.y)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: store.doneRipple) { _, _ in
            guard !reduceMotion, !dimmed, store.doneFrame != .zero else { return }
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { out = false; shown = true }
            DispatchQueue.main.async { withAnimation(.easeOut(duration: 0.5)) { out = true } }
        }
    }
}

/// Beside the clock: whether sets wait for the phone, and the heart rate. The set and rest pages
/// draw their own row (`ownTopRow`), so the set pill slides with its page (owner 2026-11-11).
struct SessionBadges: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    private var still: Bool { reduceMotion || dimmed }
    var pill = false

    var body: some View {
        HStack(spacing: 4) {
            if pill { SetPill() }
            SyncPill().transition(.scale(scale: 0.6).combined(with: .opacity))
            // Metrics shows the heart rate big itself.
            if store.show.showHr && store.tab != .metrics { HeartRateBadge(health: store.health) }
        }
        // The waiting badge pops in and out, its count rolls, the heart rate slides over (Direction B).
        .animation(still ? nil : .spring(response: 0.3, dampingFraction: 0.6), value: store.sync.count)
    }
}

/// The set up next as Apple Workout shows it beside the clock: "2/4" in the accent, on a glass pill.
struct SetPill: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The place shown before this pill appeared (after a rest the pill is new): it rolls from there (owner 2026-11-12).
    @State private var from: [Int]?

    var body: some View {
        if let ref = store.shownRef, let e = store.shownEntry, e.sets.indices.contains(ref.set) {
            let place = SetNav.place(e, ref.set)
            let now = [place.n, place.of]
            // A rest just began: the fading pill keeps the set just done, so the next one rolls in after the rest.
            let resting = store.restPanel && store.viewing == nil
            let shown = from ?? (resting ? (store.pillPlace ?? now) : now)
            let still = reduceMotion || dimmed
            let open = store.menuFor != nil
            let row = e.sets[ref.set]
            let marks = SetPill.marks(row)
            let menu = store.menuShown
            // A tap on the set number opens the set menu, as the phone's set number does. Not a corner button:
            // a top-right item makes watchOS drop the clock on 42 mm (owner 2026-11-11).
            Button { store.openMenu() } label: {
                HStack(spacing: 3) {
                    Text(verbatim: "\(shown[0])/\(shown[1])")
                        .contentTransition(.numericText(value: Double(shown[0])))
                        // The new number rolls in and punches (Direction B).
                        .keyframeAnimator(initialValue: 1.0, trigger: still ? 0 : shown[0]) { digits, s in
                            digits.scaleEffect(s)
                        } keyframes: { _ in
                            SpringKeyframe(1.15, duration: 0.12, spring: Spring(response: 0.12, dampingRatio: 0.9))
                            SpringKeyframe(1.0, duration: 0.4, spring: Spring(response: 0.32, dampingRatio: 0.5))
                        }
                    // The set's marks as small discs in the pill, as in the menu (owner 2026-11-11): no tag line for them.
                    ForEach(marks, id: \.self) { m in
                        SetPill.disc(m, dimmed: dimmed, word: store.L(m == .warmup ? "Warm-up" : m == .failure ? "Failure" : "Drop"))
                            .transition(.scale(scale: 0.2).combined(with: .opacity))
                    }
                    // The arrow turns up while the menu is open, and back as it closes (owner's pick A, 2026-11-11).
                    if menu {
                        Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                            .rotationEffect(.degrees(open ? 180 : 0))
                            .animation(still ? nil : .spring(response: 0.3, dampingFraction: 0.75), value: open)
                    }
                }
                // A mark lands in the pill once the menu is back in it (0.3 s), with a snap (Direction B).
                .animation(still ? nil : .spring(response: 0.32, dampingFraction: 0.55).delay(0.3), value: marks)
                .animation(still ? nil : .snappy(duration: 0.3), value: shown)
                .font(TypeScale.body.monospacedDigit())
                .foregroundStyle(accent.opacity(dimmed ? 0.75 : 1))
                .padding(.horizontal, 10).frame(height: TypeScale.pill)
                .background(Capsule().fill(dimmed ? Color.clear : accent.opacity(0.22)))
                .background(GeometryReader { g in
                    Color.clear.onAppear { store.pillFrame = g.frame(in: .global) }
                        .onChange(of: g.frame(in: .global)) { _, f in store.pillFrame = f }
                })
            }
            .buttonStyle(PillPress(still: still))
            .onAppear {
                // Back from a rest (or a page away): roll from the set it showed last.
                if let last = store.pillPlace, last != now, !still {
                    from = last
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { from = nil }
                }
                store.pillPlace = now
            }
            .onChange(of: now) { _, n in if !resting { store.pillPlace = n } }
            .accessibilityLabel(marks.reduce(Text("Set \(Int64(place.n)) of \(Int64(place.of))")) { t, m in
                t + Text(verbatim: ", ") + (m == .warmup ? Text("Warm-up") : m == .failure ? Text("Failure") : Text("Drop"))
            })
            // "More" is the set menu's name for VoiceOver (already translated).
            .accessibilityAction(named: Text("More")) { store.openMenu() }
        }
    }
}

extension SetPill {
    static func marks(_ row: SetRow) -> [MarkKind] {
        (row.warmup ? [.warmup] : []) + (row.failure == true ? [.failure] : []) + (row.drop != nil || row.drops != nil ? [.drop] : [])
    }

    /// A 16 pt disc with the mark's first letter in the watch's language (W, F, D in English; owner 2026-11-11:
    /// a letter reads quicker than a glyph), on the mark's colour; an outline with the wrist down.
    static func disc(_ m: MarkKind, dimmed: Bool, word: String) -> some View {
        let color = m == .warmup ? Theme.warmup : m == .failure ? Theme.red : Color(white: 0.96)
        return Text(verbatim: String(word.prefix(1)).uppercased())
            .font(.system(size: 12, weight: .heavy, design: .rounded))
        .foregroundStyle(dimmed ? color : Color.black.opacity(0.85))
        .frame(width: 18, height: 18)
        .background(Circle().fill(dimmed ? Color.clear : color))
        .overlay(Circle().stroke(color, lineWidth: dimmed ? 1 : 0))
        .accessibilityHidden(true)
    }
}

/// The set menu grows out of the set pill: the pill's tint stretches to the whole screen and turns
/// black, the menu fades in on it; closing runs it back into the pill (owner's pick C, 2026-11-11).
/// Reduce Motion and Always On: it just appears and goes.
struct MenuLayer: View {
    let ref: SetRef
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var grown = false
    @State private var closing = false

    private var motion: Animation? { reduceMotion || dimmed ? nil : .spring(response: 0.36, dampingFraction: 0.88) }

    var body: some View {
        GeometryReader { g in
            let full = g.frame(in: .global)
            let pill = store.pillFrame == .zero ? full : store.pillFrame
            let r = grown ? full : pill
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: grown ? 0 : pill.height / 2, style: .continuous)
                    .fill(grown ? Color.black : accent.opacity(0.22))
                    .frame(width: r.width, height: r.height)
                    .offset(x: r.minX - full.minX, y: r.minY - full.minY)
                SetMenuView(entry: ref.entry, set: ref.set, close: close)
                    .environmentObject(store)
                    .padding(.top, 9)   // the close button and the pill level with the clock
                    .ignoresSafeArea(edges: .top)
                    .opacity(grown ? 1 : 0)
                    .allowsHitTesting(grown && !closing)
            }
        }
        .ignoresSafeArea()
        .accessibilityAddTraits(.isModal)
        .onAppear { withAnimation(motion) { grown = true } }
    }

    private func close() {
        guard !closing else { return }
        closing = true
        withAnimation(motion) { grown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + (motion == nil ? 0 : 0.3)) { store.menuFor = nil }
    }
}

/// The set pill dips a little under the finger, so the tap is felt as it lands.
private struct PillPress: ButtonStyle {
    let still: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !still ? 0.92 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(still ? nil : .spring(response: 0.2, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Sets on their way to the iPhone: an arrow and how many, quiet but there; the phone crossed out
/// while it is out of reach. Nothing at all once everything arrived.
struct SyncPill: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        let state = store.sync
        if state.count > 0 {
            HStack(spacing: 2) {
                Image(systemName: state == .away(state.count) ? "iphone.slash" : "arrow.up")
                    .font(.system(size: 11, weight: .bold))
                Text(verbatim: "\(state.count)").font(.system(size: 13, weight: .semibold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText(value: Double(state.count)))
            }
            .foregroundStyle(Theme.orange)
            .padding(.horizontal, 5)
            .frame(minHeight: 16)
            .background(Capsule().fill(dimmed ? Color.clear : Theme.orange.opacity(0.18)))
            .overlay(Capsule().stroke(Theme.orange.opacity(0.6), lineWidth: dimmed ? 1 : 0))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Waiting to sync"))
            .accessibilityValue(Text(verbatim: "\(state.count)"))
        }
    }
}

/// The same in words, for the Overview, the start screen and the summary: "All synced", or
/// "Waiting to sync 3" and, with the phone away, "iPhone out of reach". The count comes after the
/// words, so no language needs a plural for it.
struct SyncLine: View {
    @EnvironmentObject var store: SessionStore
    /// Say "All synced" too (the Overview, the summary); the start screen only speaks up when sets wait.
    var showSynced = true
    @Environment(\.accent) private var accent

    var body: some View {
        let state = store.sync
        if state.count > 0 {
            VStack(alignment: .leading, spacing: 0) {
                Label {
                    Text("Waiting to sync") + Text(verbatim: " \(state.count)")
                } icon: {
                    Image(systemName: "arrow.up.circle")
                }
                .foregroundStyle(Theme.orange)
                if state == .away(state.count) {
                    Text("iPhone out of reach").foregroundStyle(Theme.label2)
                }
            }
            .font(.system(.caption2, design: .rounded))
            .accessibilityElement(children: .combine)
        } else if showSynced && store.heardFromPhone {
            Label { Text("All synced") } icon: { Image(systemName: "checkmark.circle") }
                .font(.system(.caption2, design: .rounded))
                .foregroundStyle(Theme.label2)
        }
    }
}

/// The set page: the set up next, or the rest after one, or a hold while it runs. Each comes in
/// with a short fade (the rest is an entrance), never a cut.
struct LivePage: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var dimmed

    private enum Panel: Hashable { case count, hold, fix, rest, set, done }

    private var panel: Panel {
        if store.holdCountFrom != nil { return .count }
        if store.holdEndsAt != nil { return .hold }
        if store.viewing != nil { return .fix }
        if store.restPanel { return .rest }
        return store.entry != nil ? .set : .done
    }

    var body: some View {
        ZStack {
            switch panel {
            case .count:
                if let from = store.holdCountFrom {
                    CountdownView(from: from, label: Text("Start hold"), start: { store.startHold(auto: true) }, cancel: { store.stopHoldCount() })
                        .transition(.opacity)
                }
            case .hold:
                if let end = store.holdEndsAt { HoldView(end: end).transition(.opacity) }
            case .rest:
                if let end = store.restEndsAt { RestView(end: end).transition(.opacity) }
            case .fix, .set:
                SetPanel().transition(.opacity)
            case .done:
                AllDonePanel().transition(.opacity)
            }
        }
        .animation(Motion.fade(reduceMotion, dimmed), value: panel)
    }
}

/// Past the last set: say so, and point at the Overview's Finish.
struct AllDonePanel: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 40))
                .foregroundStyle(accent)
                .accessibilityHidden(true)
            Text("All sets done")
                .font(TypeScale.title)
                .multilineTextAlignment(.center)
            Button { store.tab = .overview } label: {
                Label { Text("Finish workout") } icon: { Image(systemName: "flag.checkered") }
            }
            .buttonStyle(PrimaryButtonStyle())
        }
        .padding(.horizontal, 6)
    }
}

/* ---------- the Overview ---------- */

struct OverviewPage: View {
    @EnvironmentObject var store: SessionStore
    @State private var confirmDiscard = false

    var body: some View {
        ScrollView {
            if let w = store.workout {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: w.name)
                        .font(TypeScale.title)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    let p = store.progress
                    if p.total > 0 {
                        Text("\(p.done) of \(p.total) sets").font(TypeScale.second).foregroundStyle(Theme.label2)
                    }
                    ForEach(Overview.rows(w, current: store.entryIndex), id: \.index) { row in
                        if row.supersetStart {
                            Label { Text("Superset") } icon: { Image(systemName: "link") }
                                .font(TypeScale.label)
                                .foregroundStyle(Theme.purple)
                                .padding(.top, 6)
                                .padding(.leading, 4)
                        }
                        OverviewRowView(row: row)
                            .padding(.bottom, row.inSuperset && !isLastOfGroup(w, row.index) ? 0 : 2)
                    }
                    SyncLine()
                        .padding(.top, 6)
                        .padding(.leading, 4)
                    HoldToFinish { store.finish() }
                        .padding(.top, 6)
                    Button(role: .destructive) { confirmDiscard = true } label: {
                        Text("Discard workout").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(RowButtonStyle(tint: Theme.red))
                    .padding(.top, 2)
                    HStack {
                        Spacer()
                        LockButton(health: store.health)
                        Spacer()
                    }
                    .padding(.top, 4)
                }
                .padding(.horizontal, 2)
            }
        }
        .confirmationDialog(Text("Discard workout?"), isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("Discard workout", role: .destructive) { store.discard() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func isLastOfGroup(_ w: ActiveWorkout, _ i: Int) -> Bool {
        i + 1 >= w.entries.count || w.entries[i + 1].group != w.entries[i].group
    }
}

/// One exercise on the Overview: its mark (on now, done, still to do), its name and its sets.
struct OverviewRowView: View {
    @EnvironmentObject var store: SessionStore
    let row: OverviewRow
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button { store.jump(to: row.index) } label: {
            HStack(spacing: 8) {
                mark
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: row.name)
                        .font(TypeScale.body)
                        .foregroundStyle(row.finished ? Theme.label2 : Color.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(verbatim: "\(row.done)/\(row.total)")
                        .font(TypeScale.second.monospacedDigit())
                        .foregroundStyle(Theme.label2)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: Theme.tap, alignment: .leading)
            .glass(RoundedRectangle(cornerRadius: 12, style: .continuous),
                   fill: dimmed ? Color.clear : (row.current ? Theme.surface2 : Theme.surface), dimmed: dimmed)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(row.current ? accent : Theme.surface2, lineWidth: row.current ? 1.5 : (dimmed ? 1 : 0)))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        // Not while a hold runs: its seconds belong to the exercise on the set page.
        .disabled(store.holdEndsAt != nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.name))
        .accessibilityValue(Text("\(row.done) of \(row.total) sets"))
        .accessibilityAddTraits(row.current ? AccessibilityTraits([.isButton, .isSelected]) : AccessibilityTraits.isButton)
    }

    /// The exercise's still (the first frame of the animation the phone already sent for this
    /// workout, nothing new), with its state on the corner; without one, the state in a circle.
    /// Always On: no pictures (no large lit areas), only the outlined slot.
    @ViewBuilder private var mark: some View {
        let still = store.show.showClip && !dimmed ? store.clips[row.id]?.images.first : nil
        ZStack {
            if let image = still {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .brightness(-0.15)
                    .saturation(row.finished ? 0 : 1)
                    .opacity(row.finished ? 0.6 : 1)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .overlay(alignment: .bottomTrailing) { glyph(small: true).offset(x: 3, y: 3) }
            } else {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(dimmed ? Color.clear : Theme.surface2)
                RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(Theme.surface2, lineWidth: dimmed ? 1 : 0)
                glyph(small: false)
            }
        }
        .frame(width: 30, height: 30)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func glyph(small: Bool) -> some View {
        let symbol = row.current ? "play.fill" : (row.finished ? "checkmark" : "")
        if !symbol.isEmpty {
            Image(systemName: symbol)
                .font(.system(size: small ? 8 : 11, weight: .bold))
                .foregroundStyle(row.current ? accent : Theme.label2)
                .frame(width: small ? 14 : 30, height: small ? 14 : 30)
                .background(Circle().fill(small ? Color.black : Color.clear))
        }
    }
}

/*
 * Finish, held for a second: the accent fills the button from the left while the finger stays,
 * and lets go if it lifts early. One tick when it starts, the finish's own taps when it is done.
 * VoiceOver: a plain action (a double tap there is never a stray one).
 */
struct HoldToFinish: View {
    let action: () -> Void
    @State private var progress: CGFloat = 0
    @Environment(\.accent) private var accent
    @Environment(\.onAccent) private var onAccent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    static let seconds: Double = 1

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Color.clear.glass(Capsule(), fill: dimmed ? Color.clear : Theme.surface2, dimmed: dimmed)
                Capsule().stroke(accent, lineWidth: 1.5)
                label(Color.white)
                // The filled part, with the label in the ink on top of it.
                ZStack(alignment: .leading) {
                    Capsule().fill(accent)
                    label(onAccent)
                }
                .mask(alignment: .leading) { Rectangle().frame(width: g.size.width * progress) }
            }
        }
        .frame(height: Theme.tap)
        .contentShape(Capsule())
        .onLongPressGesture(minimumDuration: HoldToFinish.seconds, maximumDistance: 30, perform: {
            progress = 1
            action()
        }, onPressingChanged: { pressing in
            if pressing { WKInterfaceDevice.current().play(.click) }
            withAnimation(pressing ? .linear(duration: HoldToFinish.seconds) : (reduceMotion ? nil : .easeOut(duration: 0.2))) {
                progress = pressing ? 1 : 0
            }
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Finish workout"))
        .accessibilityHint(Text("Hold to finish"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { action() }
    }

    private func label(_ color: Color) -> some View {
        Label { Text("Hold to finish") } icon: { Image(systemName: "flag.checkered") }
            .font(.system(.body, design: .rounded).weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 8)
    }
}
