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
        NavigationStack {
            TabView(selection: $store.tab) {
                OverviewPage().tag(SessionTab.overview)
                LivePage().tag(SessionTab.set)
            }
            .tabViewStyle(.page)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { SessionBadges() }
            }
        }
        // Wrist down on the Overview: the set is what the next glance is for.
        .onChange(of: dimmed) { down in
            if down && (store.tab == .overview || store.tab == .music) { store.tab = .set }
        }
    }
}

/// Beside the clock: the heart rate, and whether sets wait for the phone.
struct SessionBadges: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        HStack(spacing: 4) {
            OfflineSign()
            if store.show.showHr { HeartRateBadge(health: store.health) }
        }
    }
}

/// The set page: the set up next, or the rest after one, or a hold while it runs.
struct LivePage: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        if let from = store.holdCountFrom {
            CountdownView(from: from, label: Text("Start hold"), start: { store.startHold(auto: true) }, cancel: { store.stopHoldCount() })
        } else if let end = store.holdEndsAt {
            HoldView(end: end)
        } else if let end = store.restEndsAt, end > Date() {
            RestView(end: end)
        } else if store.entry != nil {
            ExercisePage(index: store.entryIndex)
        } else {
            AllDonePanel()
        }
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
                .font(.system(.headline, design: .rounded))
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
                        .font(.system(.headline, design: .rounded))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    let p = store.progress
                    if p.total > 0 {
                        Text("\(p.done) of \(p.total) sets").font(.caption2).foregroundStyle(Theme.label2)
                    }
                    ForEach(Overview.rows(w, current: store.entryIndex), id: \.index) { row in
                        if row.supersetStart {
                            Label { Text("Superset") } icon: { Image(systemName: "link") }
                                .font(.system(.caption2, design: .rounded).weight(.bold))
                                .foregroundStyle(Theme.purple)
                                .padding(.top, 6)
                                .padding(.leading, 4)
                        }
                        OverviewRowView(row: row)
                            .padding(.bottom, row.inSuperset && !isLastOfGroup(w, row.index) ? 0 : 2)
                    }
                    HoldToFinish { store.finish() }
                        .padding(.top, 10)
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
                        .font(.system(.footnote, design: .rounded).weight(.semibold))
                        .foregroundStyle(row.finished ? Theme.label2 : Color.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(verbatim: "\(row.done)/\(row.total)")
                        .font(.system(.caption2, design: .rounded).monospacedDigit())
                        .foregroundStyle(Theme.label2)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 7)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: Theme.tap, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(dimmed ? Color.clear : (row.current ? Theme.surface2 : Theme.surface)))
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

    @ViewBuilder private var mark: some View {
        ZStack {
            Circle().fill(dimmed ? Color.clear : Theme.surface2)
            Circle().stroke(Theme.surface2, lineWidth: dimmed ? 1 : 0)
            if row.current {
                Image(systemName: "play.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(accent)
            } else if row.finished {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.label2)
            }
        }
        .frame(width: 26, height: 26)
        .accessibilityHidden(true)
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
                Capsule().fill(dimmed ? Color.clear : Theme.surface2)
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
