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
    /// Shrinks the menu back into the set pill (MenuLayer).
    let close: () -> Void
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hint = SessionStore.demoScreen == "menu-hint"
    @State private var holding = SessionStore.demoScreen == "menu-hold"
    @State private var progress: CGFloat = SessionStore.demoScreen == "menu-hold" ? 0.55 : 0
    @State private var confirmRemove = false
    static let removeSeconds: Double = 1

    var body: some View {
        if let w = store.workout, let e = w.entries[safe: entry], let row = e.sets[safe: set] {
            let offer = store.offer(entry: entry, set: set)
            // The numbers the set page shows (its draft, or the fix), not the phone's copy, which can lack the weight.
            let fixing = store.viewing != nil
            let shown = e.isTimed ? row : SetRow(w: fixing ? store.fixW : store.weight, r: fixing ? store.fixR : store.reps,
                                                  sec: nil, done: row.done, warmup: row.warmup)
            let line = SetMenuView.line(shown, unit: e.weightUnit(w.unit), weighted: !e.isBodyweight && !e.isTimed)
            let number = SetNav.place(e, set).n
            VStack(spacing: 0) {
                // The system's close button and clock sit in this row; the pill goes between them.
                HStack(spacing: 0) { closeButton; pill(row, number); Spacer(minLength: 0) }
                    .frame(height: 34)
                // Equal gaps between the four rows (owner 2026-11-11); the hint sits in the last gap, not a row of its own.
                Spacer(minLength: 4)
                card(row, line: line)
                Spacer(minLength: 4)
                HStack(spacing: 0) {
                    disc(.warmup, offer.warmup, label: Text("Warm-up disc"))
                    disc(.failure, offer.failure, label: Text("Failure"))
                    disc(.drop, offer.drop, label: dropLabel(offer))
                }
                Spacer(minLength: 4)
                HStack(spacing: 10) {
                    addButton(offer.canAdd)
                    removeButton(offer.canRemove)
                }
                .frame(minHeight: 40, maxHeight: 48) // glyph over label; gives way first on 40 mm
                .overlay(alignment: .top) { hintLine(number, line: line).alignmentGuide(.top) { $0[.bottom] + 3 } }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 20)   // the layer is the whole screen: clear of the bottom edge and its corners
            .dynamicTypeSize(...DynamicTypeSize.large)
        }
    }

    /// The menu's own close, where the system sheet had its X (the menu is a layer now, not a sheet).
    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(white: 0.85))
                .frame(width: 34, height: 34)
                .background(Circle().fill(Theme.surface2))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, -5)
        .frame(width: 46, alignment: .leading)
        .accessibilityLabel(Text("Done"))   // changes apply at once: closing is being done
    }

    /// "Drop", and "Drop 50" once it is on and the phone has said the weight.
    private func dropLabel(_ offer: MenuOffer) -> Text {
        if offer.drop == .on, let w = offer.dropWeight, w > 0 { return Text("Drop") + Text(verbatim: " \(formatNumber(w))") }
        return Text("Drop")
    }

    /// "62.5 kg × 8", "40 s", or the reps alone for a set without a weight (`weighted`: the weight even at 0, as the set page's box).
    static func line(_ row: SetRow, unit: String, weighted: Bool = false) -> String {
        if let s = row.sec, row.r == nil, s > 0 { return "\(formatNumber(s)) s" }
        let r = row.r.map { formatNumber($0) }
        guard let w = row.w, w > 0 || weighted else { return r ?? "–" }
        return "\(formatNumber(w)) \(unit)" + (r.map { " × \($0)" } ?? "")
    }

    /// "Set 2" (a check after it when done; 13 pt, then the number alone when the word is too wide). The clock sits to the right: the pill never grows past the gap
    /// (screen width less the close button and the clock).
    private func pill(_ row: SetRow, _ number: Int) -> some View {
        let room = WKInterfaceDevice.current().screenBounds.width - 112
        func capsule(_ word: Bool, _ size: CGFloat = 17) -> some View {
            HStack(spacing: 3) {
                if word { Text("Set \(Int64(number))") } else { Text(verbatim: "\(number)") }
                if row.done { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
            }
            .lineLimit(1).fixedSize()
            .font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(accent)
            .padding(.horizontal, size < 17 ? 8 : 10).frame(height: TypeScale.pill)
            .background(Capsule().fill(accent.opacity(0.22)))
        }
        return ViewThatFits(in: .horizontal) { capsule(true); capsule(true, 13); capsule(false) }
            .frame(maxWidth: room, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Set \(Int64(number))"))
            .accessibilityValue(row.done ? Text("Done") : Text(verbatim: ""))
    }

    /* ---------- the card ---------- */

    private func card(_ row: SetRow, line: String) -> some View {
        HStack(spacing: 4) {
            Text(verbatim: line)
                .font(TypeScale.title.monospacedDigit())
                .lineLimit(1).minimumScaleFactor(0.6)
            Spacer(minLength: 2)
            if row.warmup { glyph("flame.fill", Theme.warmup) }
            if row.failure == true { glyph("bolt.fill", Theme.red) }
            if row.drop != nil || row.drops != nil { glyph(nil, Color(white: 0.96)) }
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).fill(Theme.surface))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: line))
    }

    /// A round badge: the SF Symbol `name`, or the Drop step when nil.
    private func glyph(_ name: String?, _ color: Color) -> some View {
        Group { if let name { Image(systemName: name).font(.system(size: 11, weight: .bold)) } else { StepDownGlyph(size: 11) } }
            .foregroundStyle(Color.black.opacity(0.85))
            .frame(width: 20, height: 20).background(Circle().fill(color))
            .accessibilityHidden(true)
    }

    /* ---------- the discs ---------- */

    private func color(_ k: MarkKind) -> Color { k == .warmup ? Theme.warmup : (k == .failure ? Theme.red : Color(white: 0.96)) }

    @ViewBuilder
    private func disc(_ kind: MarkKind, _ state: Disc, label: Text) -> some View {
        if state != .hidden {
            let on = state == .on
            let locked = state == .locked
            Button {
                // Every mark closes the menu, the tag then shows on the set page (a warm-up also moves the row).
                if store.mark(kind, on: !on, entry: entry, set: set) { close() }
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
                        Group {
                            if kind == .drop { StepDownGlyph(size: 18) }
                            else { Image(systemName: kind == .warmup ? "flame.fill" : "bolt.fill").font(.system(size: 18, weight: .bold)) }
                        }
                            .foregroundStyle(on ? Color.black.opacity(0.85) : (locked ? Theme.label3 : Color.white))
                    }
                    .frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) { if on { badge("checkmark", fill: .black.opacity(0.85), ink: .white) } }
                    .overlay(alignment: .bottomTrailing) { if locked { badge("lock.fill", fill: Theme.surface2, ink: Theme.label2) } }
                    label.font(.system(.caption, design: .rounded).weight(on ? .bold : .regular)).lineLimit(1).minimumScaleFactor(0.8).padding(.horizontal, 2)
                        .foregroundStyle(locked ? Theme.label3 : Color.white)
                        .lineLimit(1).fixedSize()   // never scaled under 12 pt; a long word may overhang its column a little
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

    private func hintLine(_ number: Int, line: String) -> some View {
        Group {
            if holding {
                hintText(Text("Set \(Int64(number)) · \(line) is lost"), Theme.red)
            } else if hint {
                hintText(Text("Hold 1 s to remove"), Theme.label2)
            } else {
                Color.clear
            }
        }
        .frame(maxWidth: .infinity, minHeight: 14, maxHeight: 14, alignment: .bottom)
        .accessibilityHidden(true)
    }

    /// One line when it fits. When it does not (ru, uk: "Подход 2 · 62.5 kg × 8 будет потерян") two
    /// lines, 12 pt each; either covers the discs' labels on black while it shows; the layout does not move under the finger.
    private func hintText(_ t: Text, _ color: Color) -> some View {
        ViewThatFits(in: .horizontal) {
            t.lineLimit(1).fixedSize(horizontal: true, vertical: false)
                .frame(maxWidth: .infinity).padding(.vertical, 1).background(Color.black)
            t.multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity).padding(.vertical, 1).background(Color.black)
        }
        .font(.system(size: 12, weight: .medium, design: .rounded))
        .foregroundStyle(color)
    }

    private func addButton(_ enabled: Bool) -> some View {
        Button {
            if store.addSet(entry: entry) { close() }
        } label: {
            ZStack {
                Color.clear.glass(RoundedRectangle(cornerRadius: 20, style: .continuous), tint: accent.opacity(0.5), fill: accent.opacity(0.2), dimmed: dimmed)
                buttonContent("plus", Text("Add set"), accent)
            }
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
            close()
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
        // VoiceOver has no hold: a confirm stands in for it (spec).
        .accessibilityAction { if enabled { confirmRemove = true } }
        .confirmationDialog(Text("Remove"), isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) { store.removeSet(entry: entry, set: set); close() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func removeLabel(_ color: Color) -> some View { buttonContent("minus", Text("Remove"), color) }

    /// The one look of Add set and Remove: glyph in a fixed box (plus and minus differ in SF Symbol padding), label under it, centred in the full button.
    private func buttonContent(_ symbol: String, _ label: Text, _ color: Color) -> some View {
        VStack(spacing: 1) {
            Image(systemName: symbol).font(.system(size: 18, weight: .bold)).frame(width: 22, height: 22)
            label.font(TypeScale.label).lineLimit(1).minimumScaleFactor(0.92)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
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
                .font(TypeScale.title).lineLimit(1).minimumScaleFactor(0.7)
            Text(verbatim: line).font(TypeScale.second).foregroundStyle(Theme.label2).lineLimit(1)
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropped = false

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").font(.system(size: 14, weight: .bold)).foregroundStyle(accent)
                .frame(width: 28, height: 28).background(Circle().fill(accent.opacity(0.22)))
            VStack(alignment: .leading, spacing: 0) {
                Text(verbatim: text).font(.system(.callout, design: .rounded).weight(.bold)).lineLimit(1).minimumScaleFactor(0.75)
                Text("at the end").font(TypeScale.second).foregroundStyle(Theme.label2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surface2))
        .padding(.horizontal, 4)
        // Drops in from the top with a snap (Direction B).
        .offset(y: dropped || reduceMotion || dimmed ? 0 : -28)
        .onAppear { withAnimation(reduceMotion || dimmed ? nil : .spring(response: 0.34, dampingFraction: 0.6)) { dropped = true } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: text) + Text(verbatim: ", ") + Text("at the end"))
    }
}

private extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
