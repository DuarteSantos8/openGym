import SwiftUI
import WatchKit

/*
 * The set page, read top to bottom like Apple's Workout: the exercise, which set this is (Warm-up,
 * Left or Right beside it, the superset's partner under it), the numbers in boxes, last time, and
 * one wide button with ‹ and › either side of it.
 *
 * The Digital Crown edits the numbers: it turns the box that is outlined (the reps, or the weight
 * when the phone says so), in the exercise's own steps. A tap on the other box hands the crown to
 * it; a second tap on an outlined box opens a keypad for a value the steps don't land on. The
 * crown never pages exercises any more (the Overview does that).
 *
 * ‹ goes back to a set already done and opens it with what was logged: change a number and the
 * button says Save. › goes forward, past the set up next too (Done there logs it out of order).
 */
enum NumberField: String, Identifiable {
    case weight, reps, seconds
    var id: String { rawValue }
}

struct SetPanel: View {
    @EnvironmentObject var store: SessionStore
    @FocusState private var focus: NumberField?
    @State private var selected: NumberField?
    @State private var keypad: NumberField?
    @State private var confirmSkip = false
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var luminanceReduced
    private var dimmed: Bool { luminanceReduced || SessionStore.demoAOD }   // demoAOD: CI's Always On (the pager gives no environment value)

    var body: some View {
        page
            // A removed set: its own plain screen until Undo has passed. A set added: a toast.
            .overlay { if let r = store.removed { RemovedView(removed: r).transition(.opacity) } }
            .overlay(alignment: .top) {
                if let t = store.toast, store.removed == nil {
                    ZStack(alignment: .top) { Color.black.opacity(0.6); SetToast(text: t).padding(.top, 46) }
                        .ignoresSafeArea().transition(.opacity)
                }
            }
            .animation(Motion.fade(reduceMotion, dimmed), value: store.toast)
    }

    @ViewBuilder
    private var page: some View {
        if let w = store.workout, let ref = store.shownRef,
           w.entries.indices.contains(ref.entry), w.entries[ref.entry].sets.indices.contains(ref.set) {
            let entry = w.entries[ref.entry]
            let fixing = store.viewing != nil
            // What fits: on 41 mm the name takes one line and the extra lines go; on 45 mm and up
            // the superset's partner and last time come back.
            GeometryReader { g in
                layout(entry, ref: ref, unit: entry.weightUnit(w.unit), fixing: fixing, height: g.size.height)
                    .frame(width: g.size.width, height: g.size.height)
            }
            .padding(.horizontal, 2)
            // Down to the page dots on every case size: the system's inset (bigger on larger cases) left an
            // empty band under Done. The dots sit in the bottom 10 pt; 12 pt is kept clear above them.
            .padding(.bottom, 20)
            // The clock's row, drawn by the page so the set pill slides with it (SessionStore.ownTopRow).
            .overlay(alignment: .topLeading) {
                SessionBadges(pill: true).alignmentGuide(.top) { $0[.bottom] + 4 }.padding(.leading, 2)
            }
            .ignoresSafeArea(edges: .bottom)
            .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            .animation(Motion.fade(reduceMotion, dimmed), value: ref)
            .onAppear {
                pickCrown(entry)
                if SessionStore.demoScreen?.hasPrefix("menu") == true, store.menuFor == nil { store.lockTouches(); store.menuFor = ref }
            }
            .onChange(of: ref) { _ in pickCrown(entry) }
            .fullScreenCover(item: $keypad) { field in
                KeypadView(field: field, unit: entry.weightUnit(w.unit), start: value(field)) { set(field, $0) }
            }
            .confirmationDialog(Text("Skip this set?"), isPresented: $confirmSkip) {
                Button("Skip set") { store.skipSet() }
                Button("Cancel", role: .cancel) {}
            }
        } else {
            ExerciseDonePanel()
        }
    }

    @ViewBuilder
    private func layout(_ entry: Entry, ref: SetRef, unit: String, fixing: Bool, height: CGFloat) -> some View {
        let row = entry.sets[ref.set]
        let fit = room(entry, ref: ref, row: row, fixing: fixing, height: height)
        let partnerLine = fit.partner
        let lastLine = fit.last
        let twoLines = fit.twoLines
        VStack(spacing: 3) {
            // The set's lines move with ‹ › (Motion.nudge); the arrows and the button stay still.
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    // The exercise's animation, as the phone sent it for this workout (only the one on show moves).
                    if store.show.showClip, let clip = store.clips[entry.id] {
                        ClipView(clip: clip, animating: store.tab == .set).frame(width: 28, height: 28)
                    }
                    // Big and left-aligned, as Apple Workout names the exercise (the set number is in the top row).
                    Text(verbatim: entry.name)
                        .font(TypeScale.title)
                        .lineLimit(twoLines ? 2 : 1)
                        .minimumScaleFactor(0.7)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.leading, 5) // 10 pt from the edge, as on every page
                .frame(maxWidth: .infinity, alignment: .leading)
                placeLine(entry, ref: ref, row: row, fixing: fixing, partner: partnerLine ? nil : partnerNames(ref.entry))
                if partnerLine, let partners = partnerNames(ref.entry) {
                    Label { Text(verbatim: partners) } icon: { Image(systemName: "link") }
                        .font(TypeScale.second)
                        .foregroundStyle(Theme.purple)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .accessibilityLabel(Text("Superset") + Text(verbatim: ", \(partners)"))
                        .padding(.leading, 5)
                }
                if fixing, row.sides != nil { sideSwitch }
                if entry.isCardio {
                    Spacer(minLength: 2)
                    Text("Log this one on your iPhone.")
                        .font(TypeScale.second)
                        .foregroundStyle(Theme.label2)
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.7)
                } else {
                    numbers(entry, row: row, unit: unit).frame(maxHeight: .infinity)
                }
                if lastLine, !fixing, !row.warmup, store.show.showLast, let last = entry.last, !last.isEmpty {
                    Text("Last time: \(LastTime.compact(last))")
                        .font(TypeScale.second)
                        .foregroundStyle(Theme.label2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8) // never under 12 pt
                        .dynamicTypeSize(...DynamicTypeSize.large)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .zIndex(1)
            .id(ref)
            .transition(Motion.nudge(store.lastStep, reduceMotion: reduceMotion))
            bottomRow(entry, fixing: fixing)
        }
    }

    /// "Set 2 of 4" and what kind of set: warm-up, the side up, done (when it is a fix).
    /// What fits, in order of use: the superset's partner on a line of its own, last time, a
    /// second line for a long name. The set's place line, the boxes and the button always do.
    private func room(_ entry: Entry, ref: SetRef, row: SetRow, fixing: Bool, height: CGFloat) -> (partner: Bool, last: Bool, twoLines: Bool) {
        guard !typeSize.isAccessibilitySize else { return (false, false, false) }
        var spare = height - 132   // the fixed lines and the boxes at their Apple-sized height
        // The tag line (band, side, Done) takes a line of its own when it shows.
        // (Warm-up, Failure and Drop are discs in the top row's set pill.)
        let tags = !(row.band ?? "").isEmpty || (!fixing && row.sideUp != nil) || fixing
        if tags { spare -= 24 }
        let partner = partnerNames(ref.entry) != nil && spare >= 15
        if partner { spare -= 15 }
        let hasLast = !fixing && !row.warmup && store.show.showLast && !(entry.last ?? "").isEmpty
        let last = hasLast && spare >= 14
        if last { spare -= 14 }
        return (partner, last, spare >= 20)
    }

    /// `partner`: on a small screen the superset's partner goes on this line instead of one of its own.
    private func placeLine(_ entry: Entry, ref: SetRef, row: SetRow, fixing: Bool, partner: String?) -> some View {
        let side = fixing ? store.fixSide : row.sideUp
        let failure = row.failure == true
        let drop = row.drop != nil || row.drops != nil
        // The words when they fit; at 41 mm when the line is crowded, glyph-only discs.
        return ViewThatFits(in: .horizontal) {
            tagLine(entry, ref: ref, row: row, fixing: fixing, side: side, partner: partner, failure: failure, drop: drop, words: true)
            tagLine(entry, ref: ref, row: row, fixing: fixing, side: side, partner: partner, failure: failure, drop: drop, words: false)
        }
        .padding(.leading, 5)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    private func tagLine(_ entry: Entry, ref: SetRef, row: SetRow, fixing: Bool, side: String?, partner: String?,
                         failure: Bool, drop: Bool, words: Bool) -> some View {
        HStack(spacing: 4) {
            // "Set 2 of 4" is the top row's pill now (SetPill).
            // Resistance bands (phone lib/bands.js): the band names, as the phone sent them.
            if let band = row.band, !band.isEmpty { Tag(text: Text(verbatim: band), color: Theme.yellow) }
            if !fixing, side == "L" { Tag(text: Text("Left"), color: Theme.teal) }
            if !fixing, side == "R" { Tag(text: Text("Right"), color: Theme.teal) }
            if fixing { Tag(text: Text("Done"), color: store.accent) }
            if let partner = partner, !fixing {
                Label { Text(verbatim: partner) } icon: { Image(systemName: "link") }
                    .font(TypeScale.second)
                    .foregroundStyle(Theme.purple)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityLabel(Text("Superset") + Text(verbatim: ", \(partner)"))
            }
            if fixing, let end = store.restEndsAt, end > Date() {
                // The rest runs on while a set is fixed: its time stays in sight.
                Text(timerInterval: SafeNum.timerRange(min(Date(), end), end), countsDown: true)
                    .font(.system(.caption2, design: .rounded).weight(.semibold).monospacedDigit())
                    .foregroundStyle(store.accent)
                    .frame(maxWidth: 40)
            }
            // The effort of a set being fixed shares this line (owner 2026-11-11: no line of its own).
            if fixing, !row.warmup, !entry.isCardio, let kind = store.effortKind { fixEffort(kind) }
        }
    }

    /// The two sides of a per-side set being fixed: which one the numbers are.
    private var sideSwitch: some View {
        HStack(spacing: 4) {
            ForEach(["L", "R"], id: \.self) { side in
                Button { store.setFixSide(side) } label: {
                    Text(side == "L" ? LocalizedStringKey("Left") : LocalizedStringKey("Right"))
                        .font(TypeScale.label)
                        .textCase(.uppercase)
                        .foregroundStyle(store.fixSide == side ? Color.black : Theme.teal)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 24)
                        .glass(Capsule(), tint: store.fixSide == side ? Theme.teal : nil, fill: store.fixSide == side ? Theme.teal : Theme.teal.opacity(0.18), dimmed: dimmed)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(store.fixSide == side ? AccessibilityTraits.isSelected : AccessibilityTraits())
            }
        }
    }

    /// The effort on a set being fixed: a tap goes through the quick ratings and back to as it was.
    private func fixEffort(_ kind: String) -> some View {
        let v = store.fixEffort
        let color = v.map { Effort.color(kind, $0) } ?? Theme.label2
        return Button {
            let chips = Effort.chips(kind)
            if let cur = v, let i = chips.firstIndex(of: cur) {
                store.fixEffort = i + 1 < chips.count ? chips[i + 1] : nil
            } else {
                store.fixEffort = chips.first
            }
            WKInterfaceDevice.current().play(.click)
        } label: {
            Text(verbatim: "\(Effort.name(kind)) \(v.map { Effort.chipLabel(kind, $0) } ?? "–")")
                .font(TypeScale.label.monospacedDigit())
                .foregroundStyle(color)
                .padding(.horizontal, 10)
                .frame(minHeight: 24)
                .glass(Capsule(), tint: color.opacity(0.35), fill: color.opacity(0.18), dimmed: dimmed)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Effort"))
        .accessibilityValue(v.map { Text(verbatim: "\(Effort.name(kind)) \(Effort.chipLabel(kind, $0))") } ?? Text("None"))
        .accessibilityHint(Text("Tap to change it."))
    }

    /// The boxes: weight and reps; reps and the added weight on a bodyweight set; a hold's seconds.
    @ViewBuilder private func numbers(_ entry: Entry, row: SetRow, unit: String) -> some View {
        let tint = row.warmup ? Theme.warmup : Color.white
        let shown: [(NumberField, String?, Text, Bool)] =
            entry.isTimed ? [(.seconds, "s", Text("Hold"), false)] + ((row.w ?? 0) > 0 ? [(.weight, unit, Text("Weight"), false)] : [])
            : entry.isBodyweight ? [(.reps, nil, Text("Reps"), false), (.weight, unit, Text("Added weight"), true)]
            : [(.weight, unit, Text("Weight"), false), (.reps, nil, Text("Reps"), false)]
        // Whatever the case size, the boxes take the height left and the digits as much of it as fits.
        GeometryReader { g in
            // Sized for the widest value the box can take, not the one on show: nothing jumps as the crown turns.
            let fit = digits(g.size, shown.map { (widest($0.0, plus: $0.3), $0.1) })
            HStack(spacing: 6) {
                ForEach(Array(shown.enumerated()), id: \.element.0) { i, f in
                    box(f.0, value: value(f.0), unit: f.1, label: f.2, tint: tint, plus: f.3, size: fit.size, compact: fit.compact)
                        .frame(width: fit.widths[i])
                }
            }
        }
    }

    /// "888.5" for a weight on a 2.5 step, "88" for reps, "888" for seconds: three digits, and the step's decimals.
    private func widest(_ field: NumberField, plus: Bool) -> String {
        let decimals = field == .weight ? formatNumber(step(.weight)).split(separator: ".").dropFirst().first.map { "." + $0 } ?? "" : ""
        return (plus ? "+" : "") + (field == .reps ? "88" : "888") + decimals
    }

    /// Apple Workout's boxes (watchOS 27): equal halves, one digit size for both, as big as the widest value
    /// each box can take lets it (and the room's height).
    private func digits(_ room: CGSize, _ values: [(String, String?)]) -> (size: CGFloat, widths: [CGFloat], compact: Bool) {
        let n = CGFloat(max(1, values.count))
        let width = (room.width - 6 * (n - 1)) / n
        // Rounded digits are 0.6 of the size wide, a point or comma 0.3; a unit is 14 pt text.
        let wide = values.map { v, u -> CGFloat in
            let ems = v.reduce(0) { $0 + (".,".contains($1) ? 0.3 : 0.6) } as CGFloat
            return (width - 16 - (u.map { CGFloat($0.count) * 8.5 + 2 } ?? 0)) / max(0.6, ems)
        }.min() ?? 40
        // Too short for the name line over the digits (40 mm with tags): the digits alone; VoiceOver still says the name.
        let compact = room.height < 48
        let tall = (room.height - 6 - (compact ? 0 : 16)) / 0.93
        let size = max(18, min(tall, wide, TypeScale.number))
        return (size, Array(repeating: width, count: values.count), compact)
    }

    @ViewBuilder private func box(_ field: NumberField, value: Double, unit: String?, label: Text, tint: Color, plus: Bool = false, size: CGFloat, compact: Bool) -> some View {
        // The tapped box takes the Crown one grid step per detent (Coaich G18). The raw Crown binding raced on
        // the wrist (owner 2026-11-09, again after #916); the system wheel drew a second square (owner, same day).
        if selected == field && !dimmed {
            CrownBox(field: field, choices: CrownWheel.choices(step: step(field), range: range(field), current: value),
                     value: value, unit: unit, label: label, tint: tint, plus: plus, size: size, compact: compact, focus: $focus,
                     apply: { set(field, $0) }, tap: { keypad = field })
                .modifier(BoxAccessibility(field: field, value: value, unit: unit, label: label, step: step(field),
                                           nudge: nudge, edit: { keypad = field }))
        } else {
            NumberBox(value: (plus && value > 0 ? "+" : "") + formatNumber(value), unit: unit, label: label, tint: tint, selected: false, size: size, compact: compact)
                .onTapGesture { selected = field; focus = field }
                .modifier(BoxAccessibility(field: field, value: value, unit: unit, label: label, step: step(field),
                                           nudge: nudge, edit: { keypad = field }))
        }
    }

    /// ‹ the button ›: Done (or Start hold) on the set up next, Save on a set being fixed.
    @ViewBuilder private func bottomRow(_ entry: Entry, fixing: Bool) -> some View {
        HStack(spacing: 4) {
            ArrowButton(left: true, enabled: store.canStep(-1)) { store.step(-1) }
            if fixing {
                Button { store.saveFix() } label: {
                    Label { Text("Save") } icon: { Image(systemName: "checkmark") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!store.fixChanged)
            } else if entry.isTimed {
                Button { store.startHold() } label: {
                    Label { Text("Start hold") } icon: { Image(systemName: "play.fill") }
                }
                .buttonStyle(PrimaryButtonStyle())
            } else if entry.isCardio {
                Spacer()
            } else {
                Button { store.completeSet() } label: {
                    Label { Text("Done") } icon: { Image(systemName: "checkmark") }
                        .labelStyle(typeSize.isAccessibilitySize ? AnyLabelStyle(.iconOnly) : AnyLabelStyle(.titleAndIcon))
                }
                .buttonStyle(PrimaryButtonStyle())
                .background(GeometryReader { g in
                    Color.clear.onAppear { store.doneFrame = g.frame(in: .global) }
                        .onChange(of: g.frame(in: .global)) { _, f in store.doneFrame = f }
                })
                // A long press: skip this set instead (VoiceOver: an action of its own).
                .simultaneousGesture(LongPressGesture(minimumDuration: 0.8).onEnded { _ in confirmSkip = true })
                .accessibilityAction(named: Text("Skip set")) { store.skipSet() }
            }
            ArrowButton(left: false, enabled: store.canStep(1)) { store.step(1) }
        }
    }

    /* ---------- the numbers behind the boxes ---------- */

    private func value(_ field: NumberField) -> Double {
        let fixing = store.viewing != nil
        switch field {
        case .weight: return fixing ? store.fixW : store.weight
        case .reps: return fixing ? store.fixR : store.reps
        case .seconds: return fixing ? store.fixSec : store.seconds
        }
    }

    private func set(_ field: NumberField, _ v: Double) {
        let fixing = store.viewing != nil
        let r = range(field)
        let clean = min(r.upperBound, max(r.lowerBound, field == .weight ? v : v.rounded()))
        switch field {
        case .weight: if fixing { store.fixW = clean } else { store.weight = clean }
        case .reps: if fixing { store.fixR = clean } else { store.reps = clean }
        case .seconds: if fixing { store.fixSec = clean } else { store.seconds = clean }
        }
    }

    private func nudge(_ field: NumberField, by d: Double) {
        let s = step(field)
        set(field, ((value(field) + d) / s).rounded() * s)
        WKInterfaceDevice.current().play(.click)
    }

    private func step(_ field: NumberField) -> Double {
        switch field {
        case .weight:
            let unit = store.entry?.weightUnit(store.unit) ?? store.unit
            return store.shownEntry?.step.flatMap { $0 > 0 ? $0 : nil } ?? (unit == "lb" ? 5 : 2.5)
        case .reps: return 1
        case .seconds: return 5
        }
    }

    private func range(_ field: NumberField) -> ClosedRange<Double> {
        switch field {
        case .weight: return 0...((store.shownEntry?.weightUnit(store.unit) ?? store.unit) == "lb" ? 1500 : 700)
        case .reps: return 0...200
        case .seconds: return 1...3600
        }
    }

    /// The box the crown turns when a set comes up: the phone's choice (reps, or weight), a hold's seconds.
    private func pickCrown(_ entry: Entry) {
        let field: NumberField? = entry.isCardio ? nil
            : entry.isTimed ? .seconds
            : (store.crownStartsOnWeight && !entry.isBodyweight ? .weight : .reps)
        if SessionStore.demoScreen == "edit-weight" { selected = .weight } else { selected = field }
        // After the set's lines came back in (‹ › gives them a new identity), not before.
        DispatchQueue.main.async { focus = selected }
        if SessionStore.demoScreen == "keypad" { keypad = .weight }
    }

    private func partnerNames(_ ei: Int) -> String? {
        guard let w = store.workout else { return nil }
        let names = Overview.partners(w.entries, ei)
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }
}

/// A number you can turn: big, in a soft rounded box, its unit small beside it and its name under
/// it. Outlined in the accent, with the crown's mark, when the crown turns it.
struct NumberBox: View {
    let value: String
    let unit: String?
    let label: Text
    var tint: Color = .white
    let selected: Bool
    /// The digits' size, from the room the page has (SetPanel.digits).
    var size: CGFloat = 40
    /// No name line: the box is too short for it.
    var compact = false
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accent) private var accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // Apple Workout's set boxes (watchOS 26): the name small and in capitals on top, the number big under
        // it, both in the box's colour (the accent; orange on a warm-up), on a tint of that colour.
        let color = tint == .white ? accent : tint
        VStack(alignment: .leading, spacing: 0) {
            if !compact {
                HStack(spacing: 3) {
                    label.textCase(.uppercase)
                    if selected { Image(systemName: "digitalcrown.arrow.clockwise.fill").font(.system(size: 10)) }
                }
                .font(TypeScale.label)
                .lineLimit(1).minimumScaleFactor(0.8)
                .dynamicTypeSize(...DynamicTypeSize.large)
            }
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: value)
                    .font(.system(size: size, weight: .semibold, design: .rounded).monospacedDigit())
                    .contentTransition(.numericText())
                    // The digits roll to the new value instead of snapping, also on a fast Crown spin (owner 2026-11-11).
                    .animation(reduceMotion || dimmed ? nil : .snappy(duration: 0.22), value: value)
                    // Momentum (Direction B): each step stretches the digits up a touch and they spring back; a fast spin keeps them taut.
                    .keyframeAnimator(initialValue: 1.0, trigger: reduceMotion || dimmed ? "" : value) { digits, s in
                        digits.scaleEffect(x: 1, y: s, anchor: .bottom)
                    } keyframes: { _ in
                        LinearKeyframe(1.07, duration: 0.06)
                        SpringKeyframe(1.0, duration: 0.32, spring: Spring(response: 0.28, dampingRatio: 0.5))
                    }
                if let u = unit {
                    Text(verbatim: u).font(TypeScale.label).textCase(.uppercase)
                }
            }
            .lineLimit(1)
            .padding(.vertical, -size * 0.13) // the digits' own line is taller than they are: the box need not pay for it
            .minimumScaleFactor(0.5) // a safety net: smaller digits, never "62…"
        }
        .foregroundStyle(color.opacity(dimmed ? 0.7 : 1))
        .padding(.horizontal, 8).padding(.vertical, 3)
        // As tall as the page lets it: the numbers are what a glance is for.
        .frame(maxWidth: .infinity, minHeight: compact ? 32 : Theme.tap, maxHeight: (compact ? 6 : 22) + size * 0.93 + 4, alignment: .leading)
        // Flat, as Apple's (glass is for the buttons): a dark tint of the colour, an outline only in Always On.
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(dimmed ? Color.clear : color.opacity(0.22)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
            .stroke(color, lineWidth: selected ? 2 : (dimmed ? 1 : 0)))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// What VoiceOver gets on a number box, wheel or not: its name and value, up and down a step, Edit for the keypad.
private struct BoxAccessibility: ViewModifier {
    let field: NumberField
    let value: Double
    let unit: String?
    let label: Text
    let step: Double
    let nudge: (NumberField, Double) -> Void
    let edit: () -> Void

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(Text(verbatim: unit.map { "\(formatNumber(value)) \($0)" } ?? formatNumber(value)))
            .accessibilityHint(Text("Turn the Digital Crown to change it."))
            .accessibilityAdjustableAction { d in
                switch d {
                case .increment: nudge(field, step)
                case .decrement: nudge(field, -step)
                @unknown default: break
                }
            }
            .accessibilityAction(named: Text("Edit"), edit)
    }
}

/// The box the Crown turns: one detent is one step of the grid (`CrownWheel.choices`), `sensitivity: .low`, a
/// haptic per detent, so a fast spin cannot race. Each step goes to the set at once: what Done saves is what shows.
/// One outline (the box's own), no system focus ring.
struct CrownBox: View {
    let field: NumberField
    let choices: [Double]
    let value: Double
    let unit: String?
    let label: Text
    let tint: Color
    let plus: Bool
    let size: CGFloat
    let compact: Bool
    var focus: FocusState<NumberField?>.Binding
    let apply: (Double) -> Void
    let tap: () -> Void
    @State private var index = 0

    var body: some View {
        NumberBox(value: (plus && value > 0 ? "+" : "") + formatNumber(value), unit: unit, label: label, tint: tint, selected: true, size: size, compact: compact)
            .focusable()
            .focusEffectDisabled()
            .focused(focus, equals: field)
            .digitalCrownRotation(detent: $index, from: 0, through: max(choices.count - 1, 0), by: 1,
                                  sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
            .onTapGesture(perform: tap) // a second tap: the keypad, as before
            .onAppear { index = choices.firstIndex(of: value) ?? 0; focus.wrappedValue = field }
            .onChange(of: index) { i in if choices.indices.contains(i), choices[i] != value { apply(choices[i]) } }
            .onChange(of: value) { v in if let i = choices.firstIndex(of: v), i != index { index = i } } // the keypad typed over it
    }
}

/// ‹ or ›, as tall as the button between them.
struct ArrowButton: View {
    let left: Bool
    let enabled: Bool
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button(action: action) {
            Image(systemName: left ? "chevron.left" : "chevron.right")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.white.opacity(enabled ? (dimmed ? 0.6 : 1) : 0.25))
                .frame(width: 30, height: Theme.tap)
                .glass(RoundedRectangle(cornerRadius: 10, style: .continuous), fill: dimmed ? Color.clear : Theme.surface, dimmed: dimmed)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(left ? Text("Previous set") : Text("Next set"))
    }
}

/// An exercise with nothing left to do on the set page (picked on the Overview after it was done):
/// ‹ looks back at its sets, a skipped one waits behind ›.
struct ExerciseDonePanel: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.accent) private var accent

    var body: some View {
        let left = store.entry?.sets.contains { !$0.done } ?? false
        VStack(spacing: 6) {
            if let e = store.entry {
                Text(verbatim: e.name)
                    .font(TypeScale.title)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            Image(systemName: left ? "forward.circle" : "checkmark.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(left ? Theme.label2 : accent)
                .accessibilityHidden(true)
            Text(left ? LocalizedStringKey("A skipped set is still waiting.") : LocalizedStringKey("All sets done"))
                .font(TypeScale.second)
                .foregroundStyle(Theme.label2)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 2)
            HStack(spacing: 4) {
                ArrowButton(left: true, enabled: store.canStep(-1)) { store.step(-1) }
                Button { store.tab = .overview } label: { Text("Overview") }
                    .buttonStyle(RowButtonStyle())
                ArrowButton(left: false, enabled: store.canStep(1)) { store.step(1) }
            }
        }
        .padding(.horizontal, 2)
    }
}

/*
 * A value typed in, for what the crown's steps don't land on (62.25 kg, 13 reps in one go). The
 * number on top turns red when it is out of range, and ✓ saves only what fits.
 */
struct KeypadView: View {
    let field: NumberField
    let unit: String
    let start: Double
    let save: (Double) -> Void
    @State private var pad: Keypad
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accent) private var accent
    @Environment(\.onAccent) private var onAccent
    @Environment(\.isLuminanceReduced) private var dimmed

    init(field: NumberField, unit: String, start: Double, save: @escaping (Double) -> Void) {
        self.field = field
        self.unit = unit
        self.start = start
        self.save = save
        _pad = State(initialValue: Keypad(decimals: field == .weight ? 2 : 0))
    }

    private var range: ClosedRange<Double> {
        switch field {
        case .weight: return 0...(unit == "lb" ? 1500 : 700)
        case .reps: return 0...200
        case .seconds: return 1...3600
        }
    }

    var body: some View {
        GeometryReader { g in
            // Full screen, from the clock's row down: close and the number beside the clock, the keys fill the rest.
            let keyH = max(26, (g.size.height - 36 - 34 - 5 * 4 - 10) / 4)
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).frame(width: 32, height: 32)
                    }
                    .buttonStyle(.plain)
                    .glass(Circle(), fill: Theme.surface2, dimmed: dimmed)
                    .accessibilityLabel(Text("Cancel"))
                    display
                }
                .frame(height: 36)
                .padding(.trailing, 50)   // the system clock
                ForEach([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], [".", "0", "⌫"]], id: \.self) { keys in
                    HStack(spacing: 4) {
                        ForEach(keys, id: \.self) { key in keyButton(key, height: keyH) }
                    }
                }
                Button { if let v = pad.value, pad.fits(range) { save(v); dismiss() } } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(dimmed || !pad.fits(range) ? accent : onAccent)
                        .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34)
                        .glass(Capsule(), tint: pad.fits(range) ? accent : nil, fill: dimmed || !pad.fits(range) ? Color.clear : accent, dimmed: dimmed || !pad.fits(range))
                        .overlay(Capsule().stroke(accent, lineWidth: pad.fits(range) && !dimmed ? 0 : 1.5))
                }
                .buttonStyle(.plain)
                .disabled(!pad.fits(range))
                .accessibilityLabel(Text("Save"))
            }
            .frame(width: g.size.width, height: g.size.height, alignment: .top)
        }
        .padding(.horizontal, 4)
        .background(Color.black.ignoresSafeArea())
        .ignoresSafeArea()   // the whole screen; 10 pt kept clear above the bottom edge
        .toolbar(.hidden, for: .navigationBar)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// The number typed (or the one it replaces, dim, until a key is pressed).
    private var display: some View {
        let typed = !pad.text.isEmpty
        let bad = typed && !pad.fits(range)
        return HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(verbatim: typed ? pad.text : formatNumber(start))
                .font(.system(size: 28, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundStyle(bad ? Theme.red : (typed ? Color.white : Theme.label3))
            if field != .reps {
                Text(verbatim: field == .seconds ? "s" : unit).font(TypeScale.label).textCase(.uppercase).foregroundStyle(Theme.label2)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func keyButton(_ key: String, height: CGFloat) -> some View {
        let off = key == "." && pad.decimals == 0
        Button {
            if key == "⌫" { pad.back() } else { pad.press(key) }
            WKInterfaceDevice.current().play(.click)
        } label: {
            Group {
                if key == "⌫" { Image(systemName: "delete.left") } else { Text(verbatim: key) }
            }
            .font(.system(size: 22, weight: .semibold, design: .rounded))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .glass(RoundedRectangle(cornerRadius: 12, style: .continuous), fill: dimmed ? Color.clear : Theme.surface2, dimmed: dimmed)
        .opacity(off ? 0 : 1)
        .disabled(off)
        .accessibilityLabel(key == "⌫" ? Text(verbatim: "⌫") : Text(verbatim: key))
    }
}

/// A LabelStyle chosen at run time (the Done button drops its word at the largest text sizes).
struct AnyLabelStyle: LabelStyle {
    private let make: (Configuration) -> AnyView

    init<S: LabelStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}


/// Failure (red, bolt) or Drop (near-white, step down) on the set page; glyph-only disc when crowded.
struct SetTypeTag: View {
    enum Kind { case failure, drop }
    let kind: Kind
    let words: Bool
    let dimmed: Bool

    private var color: Color { kind == .failure ? Theme.red : Color(white: 0.96) }
    @ViewBuilder private func glyph(_ size: CGFloat) -> some View {
        if kind == .failure { Image(systemName: "bolt.fill").font(.system(size: size, weight: .bold)) } else { StepDownGlyph(size: size) }
    }

    var body: some View {
        let label = kind == .failure ? Text("Failure") : Text("Drop")
        Group {
            if words {
                HStack(spacing: 2) {
                    glyph(9)
                    label.font(TypeScale.label).lineLimit(1)
                }
                .padding(.horizontal, 5).padding(.vertical, 1)
            } else {
                glyph(11).frame(width: 20, height: 20)
            }
        }
        // Always On: outlines instead of fills.
        .foregroundStyle(dimmed ? color : Color.black.opacity(0.85))
        .background(Capsule().fill(dimmed ? Color.clear : color))
        .overlay(Capsule().stroke(color, lineWidth: dimmed ? 1 : 0))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(kind == .failure ? Text("Taken to failure") : Text("Drop set"))
    }
}

/// The Drop mark: a step down, as in the set-types mockup (SF Symbols has no stairs). Drawn in the
/// text colour, `size` is the font size it stands beside.
struct StepDownGlyph: View {
    let size: CGFloat
    var body: some View {
        Path { p in
            p.move(to: CGPoint(x: 0.1, y: 0.2)); p.addLine(to: CGPoint(x: 0.45, y: 0.2)); p.addLine(to: CGPoint(x: 0.45, y: 0.5))
            p.addLine(to: CGPoint(x: 0.9, y: 0.5)); p.addLine(to: CGPoint(x: 0.9, y: 0.8))
        }
        .applying(CGAffineTransform(scaleX: size, y: size))
        .stroke(style: StrokeStyle(lineWidth: size * 0.16, lineCap: .round, lineJoin: .round))
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
