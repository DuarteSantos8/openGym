import SwiftUI
import WatchKit

/*
 * The set menu (Workout.jsx's set menu, from the wrist): this set in a slim card, Warm-up, Failure
 * and Drop as three discs, Add set and Remove side by side under them. One screen, never scrolls
 * (41 mm: 176 x 215). The system draws the close button and the clock; the "Set 2" pill sits beside
 * them. Taps are ignored for a second after it opens (SetPage.openMenu locks them).
 *
 * Remove is held for a second, the red fill reaching the far edge exactly when it fires; a tap only
 * shows the hint. The removal itself waits out its Undo on the Removed screen (RemovedView).
 */
struct SetMenuView: View {
    let entry: Int
    let set: Int
    @EnvironmentObject var store: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hint = SessionStore.demoScreen == "menu-hint"
    @State private var holding = SessionStore.demoScreen == "menu-hold"
    @State private var progress: CGFloat = SessionStore.demoScreen == "menu-hold" ? 0.55 : 0
    static let removeSeconds: Double = 1

    var body: some View {
        if let w = store.workout, let e = w.entries[safe: entry], let row = e.sets[safe: set] {
            let offer = store.offer(entry: entry, set: set)
            let line = SetMenuView.line(row, unit: e.weightUnit(w.unit))
            VStack(spacing: 0) {
                // The system's close button and clock sit in this row; the pill goes between them.
                HStack(spacing: 0) { Color.clear.frame(width: 46); pill(row); Spacer(minLength: 0) }
                    .frame(height: 34)
                card(row, line: line)
                Spacer(minLength: 4)
                HStack(spacing: 0) {
                    disc(.warmup, offer.warmup, label: Text("Warm-up"))
                    disc(.failure, offer.failure, label: Text("Failure"))
                    disc(.drop, offer.drop, label: dropLabel(offer))
                }
                Spacer(minLength: 2)
                hintLine(line: line).frame(height: 14)
                Spacer(minLength: 2)
                HStack(spacing: 10) {
                    addButton(offer.canAdd)
                    removeButton(offer.canRemove)
                }
                .frame(height: 48)
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 15)   // measured: 12 pt clear at 41 mm (the sheet is a little taller than the screen)
            .dynamicTypeSize(...DynamicTypeSize.large)
        }
    }

    /// "Drop", and "Drop 50" once it is on and the phone has said the weight.
    private func dropLabel(_ offer: MenuOffer) -> Text {
        if offer.drop == .on, let w = offer.dropWeight, w > 0 { return Text("Drop") + Text(verbatim: " \(formatNumber(w))") }
        return Text("Drop")
    }

    /// "62.5 kg × 8", "40 s", or the reps alone for a set without a weight.
    static func line(_ row: SetRow, unit: String) -> String {
        if let s = row.sec, row.r == nil, s > 0 { return "\(formatNumber(s)) s" }
        let r = row.r.map { formatNumber($0) }
        guard let w = row.w, w > 0 else { return r ?? "–" }
        return "\(formatNumber(w)) \(unit)" + (r.map { " × \($0)" } ?? "")
    }

    private func pill(_ row: SetRow) -> some View {
        HStack(spacing: 3) {
            Text("Set \(Int64(set + 1))")
            if row.done { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
        }
        .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
        .foregroundStyle(accent)
        .padding(.horizontal, 10).padding(.vertical, 3)
        .background(Capsule().fill(accent.opacity(0.22)))
        .accessibilityElement(children: .combine)
    }

    /* ---------- the card ---------- */

    private func card(_ row: SetRow, line: String) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: line)
                .font(.system(size: 20, weight: .semibold, design: .rounded).monospacedDigit())
                .lineLimit(1).minimumScaleFactor(0.6)
            Spacer(minLength: 2)
            if row.warmup { glyph("flame.fill", Theme.warmup) }
            if row.failure == true { glyph("bolt.fill", Theme.red) }
            if row.drop != nil || row.drops != nil { glyph("arrow.turn.down.right", Color(white: 0.96)) }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surface))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: line))
    }

    private func glyph(_ name: String, _ color: Color) -> some View {
        Image(systemName: name).font(.system(size: 11, weight: .bold)).foregroundStyle(Color.black.opacity(0.85))
            .frame(width: 20, height: 20).background(Circle().fill(color))
            .accessibilityHidden(true)
    }

    /* ---------- the discs ---------- */

    private func color(_ k: MarkKind) -> Color { k == .warmup ? Theme.warmup : (k == .failure ? Theme.red : Color(white: 0.96)) }
    private func symbol(_ k: MarkKind) -> String { k == .warmup ? "flame.fill" : (k == .failure ? "bolt.fill" : "arrow.turn.down.right") }

    @ViewBuilder
    private func disc(_ kind: MarkKind, _ state: Disc, label: Text) -> some View {
        if state != .hidden {
            let on = state == .on
            let locked = state == .locked
            Button {
                store.mark(kind, on: !on, entry: entry, set: set)
            } label: {
                VStack(spacing: 2) {
                    ZStack {
                        if on {
                            Circle().fill(color(kind))
                        } else if locked {
                            Circle().strokeBorder(Theme.label3, style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                        } else {
                            Color.clear.glass(Circle(), fill: Theme.surface2, dimmed: dimmed)
                        }
                        Image(systemName: symbol(kind)).font(.system(size: 18, weight: .bold))
                            .foregroundStyle(on ? Color.black.opacity(0.85) : (locked ? Theme.label3 : Color.white))
                    }
                    .frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) { if on { badge("checkmark", fill: .black.opacity(0.85), ink: .white) } }
                    .overlay(alignment: .bottomTrailing) { if locked { badge("lock.fill", fill: Theme.surface2, ink: Theme.label2) } }
                    label.font(.system(size: 12, weight: on ? .semibold : .regular, design: .rounded))
                        .foregroundStyle(locked ? Theme.label3 : Color.white)
                        .lineLimit(1).minimumScaleFactor(0.9)
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(locked)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(kind == .warmup ? Text("Warm-up") : (kind == .failure ? Text("Taken to failure") : Text("Drop set")))
            .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
        }
    }

    private func badge(_ name: String, fill: Color, ink: Color) -> some View {
        Image(systemName: name).font(.system(size: 8, weight: .heavy)).foregroundStyle(ink)
            .frame(width: 16, height: 16).background(Circle().fill(fill))
            .overlay(Circle().stroke(Color.black, lineWidth: 1.5))
            .offset(x: 3, y: name == "checkmark" ? -3 : 3)
    }

    /* ---------- Add set and Remove ---------- */

    private func hintLine(line: String) -> some View {
        Group {
            if holding {
                Text("Set \(Int64(set + 1)) · \(line) is lost").foregroundStyle(Theme.red)
            } else if hint {
                Text("Hold 1 s to remove").foregroundStyle(Theme.label2)
            } else {
                Color.clear
            }
        }
        .font(.system(size: 12, weight: .medium, design: .rounded))
        .lineLimit(1).minimumScaleFactor(0.85)
        .accessibilityHidden(true)
    }

    private func addButton(_ enabled: Bool) -> some View {
        Button {
            store.addSet(entry: entry)
            dismiss()
        } label: {
            VStack(spacing: 0) {
                Image(systemName: "plus").font(.system(size: 18, weight: .bold))
                Text("Add set").font(.system(size: 14, weight: .semibold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.75)
            }
            .foregroundStyle(accent)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .glass(RoundedRectangle(cornerRadius: 20, style: .continuous), tint: accent.opacity(0.5), fill: accent.opacity(0.2), dimmed: dimmed)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }

    private func removeButton(_ enabled: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        return GeometryReader { g in
            ZStack(alignment: .leading) {
                Color.clear.glass(shape, fill: Theme.red.opacity(0.14), dimmed: dimmed)
                removeLabel(Theme.red).frame(width: g.size.width)
                // The filled part, its label in white on top, reaching the edge exactly when it fires.
                ZStack {
                    Rectangle().fill(Theme.red)
                    removeLabel(Color.white)
                }
                .frame(width: g.size.width)
                .mask(alignment: .leading) { Rectangle().frame(width: g.size.width * progress) }
            }
            .clipShape(shape)
            .overlay(shape.stroke(Theme.red, lineWidth: 1.5))
        }
        .contentShape(Rectangle())
        .opacity(enabled ? 1 : 0.35)
        .onLongPressGesture(minimumDuration: SetMenuView.removeSeconds, maximumDistance: 30, perform: {
            guard enabled, store.touchAllowed else { return }
            progress = 1
            store.removeSet(entry: entry, set: set)
            dismiss()
        }, onPressingChanged: { pressing in
            guard enabled, store.touchAllowed else { return }
            if pressing {
                holding = true; hint = false
                WKInterfaceDevice.current().play(.click)
            } else {
                // Let go before it fired (a tap too): only the hint stays.
                if holding { hint = true }
                holding = false
            }
            withAnimation(pressing ? .linear(duration: SetMenuView.removeSeconds) : (reduceMotion ? nil : .easeOut(duration: 0.2))) {
                progress = pressing ? 1 : 0
            }
        })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Remove"))
        .accessibilityHint(Text("Hold 1 s to remove"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if enabled { store.removeSet(entry: entry, set: set); dismiss() } }
    }

    private func removeLabel(_ color: Color) -> some View {
        VStack(spacing: 0) {
            Image(systemName: "minus").font(.system(size: 18, weight: .bold))
            Text("Remove").font(.system(size: 14, weight: .semibold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.75)
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 4)
    }
}

/*
 * The set is gone and Undo is one big button; a thin bar drains over the 4 s, then the page is back.
 * Undo is not behind the touch lock: the finger that held Remove lifted on the menu, not here.
 */
struct RemovedView: View {
    let removed: SessionStore.RemovedSet
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent

    var body: some View {
        let unit = store.workout.flatMap { w in store.shownEntry?.weightUnit(w.unit) } ?? ""
        let line = SetMenuView.line(SetRow(w: removed.w, r: removed.r, sec: nil, done: false, warmup: false), unit: unit)
        VStack(spacing: 6) {
            Image(systemName: "trash").font(.system(size: 20, weight: .semibold)).foregroundStyle(Theme.red)
                .frame(width: 44, height: 44).background(Circle().fill(Theme.red.opacity(0.18)))
            Text("Set \(Int64(removed.setNumber)) removed")
                .font(.system(.title3, design: .rounded).weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
            Text(verbatim: line).font(.system(.footnote, design: .rounded)).foregroundStyle(Theme.label2).lineLimit(1)
            Button { store.undoRemove() } label: {
                Label { Text("Undo") } icon: { Image(systemName: "arrow.uturn.backward") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(height: 48)
            bar
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.black.ignoresSafeArea())
    }

    /// Full at 4 s left, empty at 0 (frozen at 55 % for the demo's screenshot).
    private var bar: some View {
        TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
            let f = SessionStore.demoScreen == "removed" ? 0.55 : max(0, min(1, removed.until.timeIntervalSince(ctx.date) / UndoWindow.seconds))
            GeometryReader { g in
                Capsule().fill(Theme.surface2)
                    .overlay(alignment: .leading) { Capsule().fill(accent).frame(width: g.size.width * f) }
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// "Set 4 added · at the end", over the page for two seconds.
struct SetToast: View {
    let text: String
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundStyle(accent)
                .frame(width: 28, height: 28).background(Circle().fill(accent.opacity(0.22)))
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: text).font(.system(.callout, design: .rounded).weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
                Text("at the end").font(.system(size: 12, design: .rounded)).foregroundStyle(Theme.label2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surface2))
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: text) + Text(verbatim: ", ") + Text("at the end"))
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
