import SwiftUI
import WatchKit

/*
 * The end of a workout, struck as a medal (#1309; the approved design is concept A, "The medal").
 *
 *   0.0 s    a blank disc falls onto the glass (scale 1.5 to 1, a little blur, speeding up)
 *   0.3 s    the strike: the workout stamps into it, a shock ring, sparks, a 4 % squash (haptic stop)
 *   to 1.45  it rocks to rest like a coin on a table, the light sliding over it; a light runs
 *            round the rim, one notch per set
 *   1.55 on  a records day (gold): a diamond drops into its setting per record (a rising tap each)
 *            a day without records (steel): the volume is stamped in, a success tap at 1.15
 *   then     one glint, and a small turn that says the Crown spins it
 *
 * The Crown (one value, stops at whole numbers): 0 the front, 1 the back (sets, volume, heart rate,
 * calories, the date) with its grooved edge on the way, 2 home to the front, small at the top, with
 * the record bars and Done under it, then a page at a time down to Done. A tap on the medal goes to
 * the next stop; a swipe turns it too. Always On: the front as a line engraving, nothing moves.
 * Reduce Motion: a fade, and the Crown cross-fades the faces instead of spinning them.
 *
 * Lengths on the medal are face units, 200 across it (Medal in WatchCore holds the layout rules).
 */

/// "Workout saved", as a medal. Done ignores taps for its first second: the thumb on Finish is
/// still on the glass. It takes the Crown as soon as it opens: it replaces the workout, whose Crown
/// control is gone, and the Crown did nothing until a touch (owner, 1.4.5).
struct SummaryView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.locale) private var locale
    @Environment(\.accent) private var accent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var shownAt = Date()
    /// The entrance's clock: from the first moment the medal is seen (not while the wrist is down).
    @State private var start: Date?
    @State private var settled = false
    /// The Crown's value, and the one drawn, which follows it with a spring.
    @State private var crown = 0.0
    @State private var c = 0.0
    @State private var restHeight: CGFloat = 0
    @State private var dragFrom: Double?
    @State private var hrIn = false
    @State private var kcalIn = false
    /// The words on the medal, worked out when it opens, not on every frame.
    @State private var cached: MedalWords?
    @FocusState private var focused: Bool
    let summary: WorkoutSummary

    var body: some View {
        GeometryReader { geo in
            let lay = MedalLayout(size: geo.size, records: summary.prs.count, restHeight: restHeight)
            let words = cached ?? self.words
            TimelineView(.animation(minimumInterval: nil, paused: settled || dimmed || start == nil)) { tl in
                MedalStage(c: c, t: dimmed ? 99 : time(at: tl.date), lay: lay, words: words, summary: summary,
                           accent: accent, dimmed: dimmed, reduce: reduceMotion, hrIn: hrIn, kcalIn: kcalIn,
                           onTap: { turn(to: Medal.nextStop(crown)) }, onDone: done)
            }
            .contentShape(Rectangle())
            .gesture(drag(lay))
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .digitalCrownRotation($crown, from: 0, through: lay.cMax, by: 1, sensitivity: .low,
                                  isContinuous: false, isHapticFeedbackEnabled: true)
            .onAppear { jumpToEnd(lay) }
            .onChange(of: lay.cMax) { jumpToEnd(lay) }
        }
        .ignoresSafeArea()
        .onPreferenceChange(RestHeightKey.self) { restHeight = $0 }
        .onChange(of: crown) { _, v in
            if dragFrom != nil { c = v } else { withAnimation(turnAnimation) { c = v } }
        }
        .onChange(of: dimmed) { _, down in
            // Wrist down: back to the front. Up again for the first time: the entrance plays now.
            if down { crown = 0; c = 0 } else if start == nil { start = Date() }
        }
        .onChange(of: summary) { cached = words }
        .onChange(of: locale) { cached = words }
        .onChange(of: summary.hrAvg) { _, v in if v != nil { withAnimation(.easeOut(duration: 0.35)) { hrIn = true } } }
        .onChange(of: summary.calories) { _, v in if v != nil { withAnimation(.easeOut(duration: 0.35)) { kcalIn = true } } }
        .task(id: start) {
            guard let s = start else { return }
            let left = Medal.entranceEnds(records: summary.prs.count) - Date().timeIntervalSince(s)
            if left > 0 { try? await Task.sleep(nanoseconds: UInt64(left * 1_000_000_000)) }
            settled = true
        }
        .onAppear {
            shownAt = Date()
            focused = true
            cached = words
            hrIn = summary.hrAvg != nil
            kcalIn = summary.calories != nil
            if !dimmed { start = Date() }
            if SessionStore.demoScreen == "summary-back" { crown = 1; c = 1 }
        }
    }

    private var turnAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.3) : .spring(response: 0.42, dampingFraction: 0.86)
    }

    private func time(at date: Date) -> Double {
        // Not started yet: nothing shows (a resting medal for one frame would spoil the fall).
        guard let s = start else { return 0 }
        return settled ? 99 : max(0, date.timeIntervalSince(s))
    }

    private func turn(to v: Double) {
        if crown == v { withAnimation(turnAnimation) { c = v } } else { crown = v }
    }

    /// CI's end shot, and VoiceOver: open at the end, where the records and Done are on screen.
    private func jumpToEnd(_ lay: MedalLayout) {
        guard SessionStore.demoScreen == "summary-end" || voiceOver else { return }
        crown = lay.cMax
        c = lay.cMax
    }

    private func done() {
        guard Date().timeIntervalSince(shownAt) >= 1 else { return }
        store.closeSummary()
    }

    /// A swipe turns it like the Crown: the medal follows the finger, then settles on the nearest
    /// stop, one stop at most per swipe.
    private func drag(_ lay: MedalLayout) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { g in
                let from = dragFrom ?? c
                if dragFrom == nil { dragFrom = from }
                c = min(max(lay.c(points: lay.points(from) - g.translation.height), 0), lay.cMax)
            }
            .onEnded { g in
                let from = (dragFrom ?? c).rounded()
                dragFrom = nil
                let aim = lay.c(points: lay.points(from) - g.predictedEndTranslation.height).rounded()
                turn(to: min(max(aim, from - 1, 0), from + 1, lay.cMax))
            }
    }

    /* ---------- the words on it, in the app's language ---------- */

    private var words: MedalWords {
        let up = { (s: String) in s.uppercased(with: locale) }
        let k = summary.prs.count
        let bpm = store.L("%@ bpm").replacingOccurrences(of: "%@", with: "").trimmingCharacters(in: .whitespaces)
        let kcal = MeasurementFormatter.kcal(locale)
        let sets = summary.sets.formatted(.number.locale(locale))
        let volume = summary.volume.formatted(.number.precision(.fractionLength(0)).locale(locale))
        let time = summary.duration.map(Medal.time)
        let legend = k == 0 ? String(format: store.L("%@ sets"), sets) : k == 1 ? store.L("New record") : "\(k) " + store.L("Records")
        let hrAvg = summary.hrAvg.map { "\(SafeNum.rounded($0))" }
        let peak = summary.hrMax.map { "\(store.L("max")) \(SafeNum.rounded($0)) \(bpm)" }
        let date = summary.endedAt.map { Date(timeIntervalSince1970: $0 / 1000).formatted(.dateTime.day().month(.abbreviated).year().locale(locale)) }
        // VoiceOver: the whole medal, front and back, in one sentence.
        var spoken = [store.L(summary.endedOnPhone ? "Ended on your iPhone" : "Workout saved"), summary.name]
        if let d = summary.duration { spoken.append(Self.spokenDuration(d, locale: locale)) }
        spoken.append(k == 0 ? String(format: store.L("%@ sets"), sets)
                      : legend + ": " + summary.prs.joined(separator: ", "))
        if k > 0 { spoken.append(String(format: store.L("%@ sets"), sets)) }
        spoken.append("\(volume) \(summary.unit)")
        if let a = summary.hrAvg, let m = summary.hrMax {
            spoken.append(store.L("Heart rate") + " " + String(format: store.L("%lld avg · %lld max"), SafeNum.rounded(a), SafeNum.rounded(m)))
        }
        if let cal = summary.calories { spoken.append("\(SafeNum.rounded(cal)) \(kcal)") }
        return MedalWords(
            status: store.L(summary.endedOnPhone ? "On iPhone" : "Saved"),
            name: up(summary.name), arcable: Medal.arcable(summary.name),
            time: time?.text ?? sets, timeLabel: up(time == nil ? store.L("Sets") : time!.hours ? store.L("Hours") : store.L("min")),
            legend: up(legend), sets: sets, setsWord: up(store.L("Sets")),
            volume: volume, unit: up(summary.unit),
            avgLabel: up("\(store.L("avg")) \(bpm)"), kcalLabel: up(kcal),
            hrAvg: hrAvg, peak: peak.map(up), kcal: summary.calories.map { "\(SafeNum.rounded($0))" },
            date: date.map(up), reps: store.L("Reps").lowercased(with: locale),
            spoken: spoken.joined(separator: ", "))
    }

    /// "52 minutes", "1 hour, 5 minutes", for VoiceOver.
    private static func spokenDuration(_ seconds: Double, locale: Locale) -> String {
        let f = DateComponentsFormatter()
        var calendar = Calendar.current
        calendar.locale = locale
        f.calendar = calendar
        f.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        f.unitsStyle = .full
        return f.string(from: max(60, seconds)) ?? ""
    }

    /// "52 min", "1 h 5 min", in the app's language.
    static func duration(_ seconds: Double, locale: Locale = .current) -> String {
        let f = DateComponentsFormatter()
        var calendar = Calendar.current
        calendar.locale = locale
        f.calendar = calendar
        f.allowedUnits = seconds >= 3600 ? [.hour, .minute] : [.minute]
        f.unitsStyle = .short
        return f.string(from: max(60, seconds)) ?? ""
    }
}

private extension MeasurementFormatter {
    /// "kcal" in the app's language.
    static func kcal(_ locale: Locale) -> String {
        let f = MeasurementFormatter()
        f.locale = locale
        f.unitStyle = .short
        return f.string(from: UnitEnergy.kilocalories)
    }
}

/// The words on the medal, worked out once per summary.
private struct MedalWords: Equatable {
    var status: String
    var name: String
    var arcable: Bool
    var time: String
    var timeLabel: String
    var legend: String
    var sets: String
    var setsWord: String
    var volume: String
    var unit: String
    var avgLabel: String
    var kcalLabel: String
    var hrAvg: String?
    var peak: String?
    var kcal: String?
    var date: String?
    var reps: String
    var spoken: String
}

private struct RestHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Where the medal sits on this screen, and how the Crown's stops map to points.
private struct MedalLayout: Equatable {
    let w, h, d, u, cy0, endScale, cyEnd, restTop, overflow: Double
    let stops: Int

    init(size: CGSize, records: Int, restHeight: CGFloat) {
        w = size.width
        h = size.height
        d = Medal.diameter(width: w, height: h)
        u = d / 200
        // Centred under the 30 pt status row.
        cy0 = 30 + (h - 30) / 2 - 2
        endScale = Medal.endScale(records: records)
        cyEnd = 29 + d * endScale / 2
        restTop = cyEnd + d * endScale / 2 + (records > 0 ? 9 : 12)
        overflow = restHeight > 0 ? max(0, restTop + restHeight + 10 - h) : 0
        stops = Medal.endStops(overflow: overflow)
    }

    var cMax: Double { 2 + Double(stops) }
    /// A swipe's points per stop: 60 for a turn, then a page of what runs past the bottom.
    private var page: Double { stops > 0 ? overflow / Double(stops) : 60 }
    func points(_ c: Double) -> Double { c <= 2 ? c * 60 : 120 + (c - 2) * page }
    func c(points p: Double) -> Double { p <= 120 ? p / 60 : 2 + (p - 120) / page }
}

/* ---------- the metals ---------- */

private func rgb(_ hex: UInt32, _ a: Double = 1) -> Color {
    Color(red: Double(hex >> 16 & 0xff) / 255, green: Double(hex >> 8 & 0xff) / 255, blue: Double(hex & 0xff) / 255, opacity: a)
}

/// Gold for a records day, forged steel without; never the accent. Ink on the darkest part of each
/// field: 5.9:1 on gold, 6.6:1 on steel. Always On draws in `aod` on black (over 8:1).
private struct Metal: Equatable {
    let hi, lt, md, dk, sh, ink, rimDark, glow, aod, aodLine: Color

    static let gold = Metal(hi: rgb(0xfff3cf), lt: rgb(0xf2d791), md: rgb(0xd9b45f), dk: rgb(0xbb9545), sh: rgb(0x7a5a1e),
                            ink: rgb(0x2a1c07), rimDark: rgb(0x5b4214), glow: rgb(0xffba40, 0.22),
                            aod: rgb(0xd6b25e), aodLine: rgb(0xd6b25e, 0.5))
    static let steel = Metal(hi: rgb(0xf4f7fb), lt: rgb(0xd4dae1), md: rgb(0xb0b8c2), dk: rgb(0x949da8), sh: rgb(0x4f5762),
                             ink: rgb(0x13171c), rimDark: rgb(0x30363e), glow: rgb(0xa0c3eb, 0.17),
                             aod: rgb(0xb4bcc6), aodLine: rgb(0xb4bcc6, 0.45))

    /// Two highlight lobes, as a conic gradient starting at `deg` (0 = up, clockwise, as CSS).
    private func conic(_ stops: [(Color, Double)], _ deg: Double) -> AngularGradient {
        AngularGradient(stops: stops.map { Gradient.Stop(color: $0.0, location: $0.1) }, center: .center, angle: .degrees(deg - 90))
    }
    func rim(_ light: Double) -> AngularGradient {
        conic([(hi, 0), (md, 0.14), (sh, 0.28), (md, 0.42), (hi, 0.5), (md, 0.64), (sh, 0.78), (md, 0.92), (hi, 1)], light + 95)
    }
    func bevel(_ light: Double) -> AngularGradient {
        conic([(hi, 0), (sh, 0.25), (hi, 0.5), (sh, 0.75), (hi, 1)], light + 200)
    }
    func field(_ light: Double) -> AngularGradient {
        conic([(lt, 0), (md, 0.2), (dk, 0.3), (md, 0.4), (lt, 0.5), (md, 0.7), (dk, 0.8), (md, 0.9), (lt, 1)], light)
    }
}

/* ---------- the stage: everything drawn from the Crown's value and the entrance's clock ---------- */

private func clamp(_ x: Double, _ a: Double = 0, _ b: Double = 1) -> Double { min(b, max(a, x)) }
private func smooth(_ x: Double) -> Double { let x = clamp(x); return x * x * (3 - 2 * x) }
private func lerp(_ a: Double, _ b: Double, _ p: Double) -> Double { a + (b - a) * p }

/// The coin's settle (Euler's disk): the tilt dies away while the wobble speeds up. The wobble's
/// angle, 240 steps a second.
private let wobble: [Double] = {
    var out: [Double] = [], psi = 0.0
    for i in 0...400 {
        let a = 8 * exp(-Double(i) / 240 * 3.4)
        out.append(psi)
        psi += min(44, 7 * (8 / max(a, 0.05)).squareRoot()) / 240
    }
    return out
}()

/// The medal's thickness, for its edge while it spins.
private let thickness = 14.0

private struct MedalStage: View, Animatable {
    var c: Double
    let t: Double
    let lay: MedalLayout
    let words: MedalWords
    let summary: WorkoutSummary
    let accent: Color
    let dimmed: Bool
    let reduce: Bool
    let hrIn: Bool
    let kcalIn: Bool
    let onTap: () -> Void
    let onDone: () -> Void

    var animatableData: Double {
        get { c }
        set { c = newValue }
    }

    private var records: Int { summary.prs.count }
    private var metal: Metal { records > 0 ? .gold : .steel }

    var body: some View {
        let d = lay.d, u = lay.u, w = lay.w, h = lay.h
        // The entrance.
        var fall = 1.0, opacity = 1.0, blur = 0.0, struck = 1.0, tilt = 0.0, psi = 0.0
        var ring = -1.0, sparks = -1.0, halo = 0.55, glint = -1.0, peek = 0.0, marks = 1.0, status = 1.0
        let glintAt = Medal.glintAt(records: records), peekAt = glintAt + 0.95
        if dimmed {
            halo = 0
        } else if reduce {
            opacity = clamp(t / 0.3)
            halo = 0.55 * opacity
            marks = opacity
            status = opacity
        } else {
            if t < Medal.strikeAt {
                let p = t / Medal.strikeAt
                fall = 1.5 - 0.5 * pow(p, 2.2)
                opacity = clamp(t / 0.12)
                blur = (1 - p) * 4
                struck = 0
                halo = 0
            } else {
                let v = t - Medal.strikeAt
                fall = 1 - 0.04 * exp(-v * 12) * cos(v * 38)
                struck = clamp(v / 0.09)
                tilt = v < 1.4 ? 8 * exp(-v * 3.4) : 0
                psi = wobble[min(wobble.count - 1, Int((v * 240).rounded()))]
                ring = v < 0.45 ? v / 0.45 : -1
                sparks = v < 0.5 ? v / 0.5 : -1
                halo = 0.55 + 0.45 * exp(-v * 5)
            }
            if t >= glintAt && t < glintAt + 0.7 { glint = (t - glintAt) / 0.7 }
            // A hint that it turns, only while the Crown is untouched.
            if t > peekAt && t < peekAt + 0.7 && c == 0 { peek = 16 * sin(.pi * (t - peekAt) / 0.7) }
            marks = clamp((t - 2.2) / 0.3)
            status = clamp((t - 0.35) / 0.25)
        }
        // The Crown.
        let p = smooth(c - 1)
        let scroll = Medal.scroll(c: c, overflow: lay.overflow)
        let th = reduce || dimmed ? 0 : .pi * min(c, 2) + peek * .pi / 180
        let cs = cos(th), sn = sin(th)
        let scale = fall * lerp(1, lay.endScale, p)
        let cy = lerp(lay.cy0, lay.cyEnd, p) - scroll
        let light = 300 + th * 90 / .pi + 28 * (tilt / 8) * sin(psi)
        let fx = thickness / 2 * sn * u
        let fade = 1 - smooth(c) + smooth(c - 1)   // Reduce Motion: the front's share of the cross-fade
        let restY = lerp(h + 8, lay.restTop, p) - scroll

        return ZStack(alignment: .topLeading) {
            Color.black
            // The glow behind it, flaring at the strike.
            if !dimmed {
                Circle()
                    .fill(RadialGradient(colors: [metal.glow, metal.glow.opacity(0)], center: .center, startRadius: 0, endRadius: d * 0.79))
                    .frame(width: d * 1.75, height: d * 1.75)
                    .scaleEffect(scale)
                    .opacity(halo * (1 - p * 0.7))
                    .position(x: w / 2, y: cy)
                    .allowsHitTesting(false)
            }
            if ring >= 0 {
                Circle().stroke(metal.lt, lineWidth: 1.4)
                    .frame(width: d, height: d)
                    .scaleEffect(1 + 0.3 * ring)
                    .opacity(0.7 * (1 - ring))
                    .position(x: w / 2, y: lay.cy0)
                    .allowsHitTesting(false)
            }
            if sparks >= 0 {
                Sparks(progress: sparks, d: d, color: metal.hi)
                    .frame(width: w, height: h)
                    .position(x: w / 2, y: lay.cy0)
                    .allowsHitTesting(false)
            }
            // The medal.
            ZStack {
                if abs(sn) >= 0.01 && !reduce {
                    Edge(th: th, sets: summary.sets, metal: metal, u: u)
                }
                face(front: true, light: light, struck: struck, glint: glint)
                    .scaleEffect(x: reduce ? 1 : max(cs, 0.001), y: 1)
                    .offset(x: reduce ? 0 : fx)
                    .colorMultiply(Color(white: 0.6 + 0.4 * abs(cs)))
                    .opacity(reduce ? fade : cs > 0 ? 1 : 0)
                face(front: false, light: light, struck: struck, glint: -1)
                    .scaleEffect(x: reduce ? 1 : max(-cs, 0.001), y: 1)
                    .offset(x: reduce ? 0 : -fx)
                    .colorMultiply(Color(white: 0.6 + 0.4 * abs(cs)))
                    .opacity(reduce ? 1 - fade : cs < 0 ? 1 : 0)
            }
            .frame(width: d, height: d)
            .rotation3DEffect(.degrees(tilt), axis: (x: cos(psi), y: sin(psi), z: 0), perspective: 0.4)
            .contentShape(Circle())
            .onTapGesture(perform: onTap)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: words.spoken))
            .scaleEffect(scale)
            .blur(radius: blur)
            .opacity(opacity)
            .position(x: w / 2, y: cy)
            // The record bars, the sync line and Done, risen into the space the medal left.
            rest
                .frame(width: w - 20)
                .fixedSize(horizontal: false, vertical: true)
                .background(GeometryReader { g in Color.clear.preference(key: RestHeightKey.self, value: g.size.height) })
                .offset(x: 10, y: restY)
                .opacity(p)
                .allowsHitTesting(p > 0.9)
                .accessibilityHidden(p < 0.5)
            // Scrolled: nothing runs under the status row and the clock (the top 28 pt), then a soft edge.
            LinearGradient(stops: [.init(color: .black, location: 0.67), .init(color: .black.opacity(0), location: 1)],
                           startPoint: .top, endPoint: .bottom)
                .frame(width: w, height: 42)
                .opacity(clamp(scroll / 8))
                .allowsHitTesting(false)
            statusRow.opacity(status)
            if !dimmed { stopMarks.opacity(marks).position(x: w - 6, y: h / 2) }
        }
        .frame(width: w, height: h)
    }

    /* ---------- one face ---------- */

    private func face(front: Bool, light: Double, struck: Double, glint: Double) -> some View {
        let d = lay.d, u = lay.u
        let field = d * 0.84
        return ZStack {
            if dimmed {
                Circle().strokeBorder(metal.aodLine, lineWidth: 1.1)
                Circle().strokeBorder(metal.aodLine, lineWidth: 0.7).frame(width: field, height: field)
            } else {
                Circle().fill(metal.rim(light))
                Circle().fill(metal.bevel(light)).frame(width: d * 0.88, height: d * 0.88)
                // The back's field catches the light 40° on from the front's.
                Circle().fill(metal.field(front ? light : light + 40)).frame(width: field, height: field)
                Grain(front: front, d: field).equatable().frame(width: field, height: field)
                // The field sits below the bevel: a dark rim and a soft shadow from the top edge.
                Circle().strokeBorder(Color.black.opacity(0.35), lineWidth: 0.6).frame(width: field, height: field)
                Circle().strokeBorder(LinearGradient(colors: [.black.opacity(0.3), .clear], startPoint: .top, endPoint: .center), lineWidth: 1.8)
                    .frame(width: field, height: field)
            }
            Notches(sets: summary.sets, metal: metal, u: u, aod: dimmed).equatable().opacity(struck)
            if !dimmed {
                NotchLights(sets: summary.sets, t: front && !reduce ? min(t, 3) : 99, u: u).equatable().opacity(struck)
            }
            Stamp(marks: front ? frontMarks : backMarks, metal: metal, u: u, aod: dimmed).equatable()
                .scaleEffect(1 + 0.08 * (1 - struck))
                .opacity(struck)
            if front {
                if records > 0 {
                    Gems(count: records, t: min(t, 4), metal: metal, u: u, aod: dimmed, reduce: reduce).equatable()
                }
                if glint >= 0 { Glint(progress: glint, field: field) }
            } else {
                backLate(u: u)
            }
        }
        .frame(width: d, height: d)
    }

    /// Heart rate and calories reach the back from Apple Health a moment late: each fills its own
    /// engraved recess, and the peak fades in on the bottom arc. Nothing else moves.
    private func backLate(u: Double) -> some View {
        ZStack {
            Recesses(metal: metal, u: u, hr: hrIn, kcal: kcalIn, aod: dimmed)
            if let hr = words.hrAvg {
                Stamp(marks: [.text(hr, size: 24, tracking: -0.4, x: -4, y: 22, align: .trailing, width: Self.valueWidth(22), mono: true)]
                      + (words.peak.map { [.arc($0, size: 16, tracking: 1.4, radius: 79, top: false, length: 190)] } ?? []),
                      metal: metal, u: u, aod: dimmed).equatable()
                    .opacity(hrIn ? 1 : 0)
            }
            if let kcal = words.kcal {
                Stamp(marks: [.text(kcal, size: 24, tracking: -0.4, x: -4, y: 48, align: .trailing, width: Self.valueWidth(48), mono: true)],
                      metal: metal, u: u, aod: dimmed).equatable()
                    .opacity(kcalIn ? 1 : 0)
            }
        }
    }

    /// Room on the field for a row's number (right-aligned at -4) and its label (from 2), at that baseline.
    private static func halfChord(_ y: Double) -> Double { (84 * 84 - (y - 8) * (y - 8)).squareRoot() - 6 }
    private static func valueWidth(_ y: Double) -> Double { halfChord(y) - 4 }
    private static func labelWidth(_ y: Double) -> Double { halfChord(y) - 2 }

    private var frontMarks: [Mark] {
        var m: [Mark] = [.ring, .name(words.name, arcable: words.arcable),
                         .arc(words.legend, size: 16, tracking: 1.6, radius: 79, top: false, length: 190),
                         .text(words.time, size: words.time.count > 2 ? 52 : 62, tracking: -1.5, x: 0, y: 12, align: .center, width: 132, mono: true, opacity: dimmed ? 0.8 : 1),
                         .text(words.timeLabel, size: 16, tracking: 2, x: 0, y: 30, align: .center, width: 110)]
        if records == 0 {
            m += [.rule(y: 38.5, half: 13),
                  .text("\(words.volume) \(words.unit)", size: 16.5, tracking: 0.4, x: 0, y: 56, align: .center, width: 120, mono: true)]
        }
        return m
    }

    private var backMarks: [Mark] {
        var m: [Mark] = []
        if let date = words.date { m.append(.arc(date, size: 16, tracking: 1.6, radius: 70, top: true, length: 200)) }
        let rows: [(Double, String?, String)] = [(-30, words.sets, words.setsWord), (-4, words.volume, words.unit), (22, nil, words.avgLabel), (48, nil, words.kcalLabel)]
        for (y, value, label) in rows {
            if let value { m.append(.text(value, size: 24, tracking: -0.4, x: -4, y: y, align: .trailing, width: Self.valueWidth(y), mono: true)) }
            m.append(.text(label, size: 16, tracking: 0.4, x: 2, y: y, align: .leading, width: Self.labelWidth(y)))
        }
        return m
    }

    /* ---------- around the medal ---------- */

    private var statusRow: some View {
        HStack(spacing: 4) {
            Image(systemName: summary.endedOnPhone ? "iphone" : "checkmark.circle.fill")
                .foregroundStyle(accent)
                .opacity(dimmed ? 0.6 : 1)
            Text(verbatim: words.status)
                .foregroundStyle(dimmed ? Color.white.opacity(0.62) : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .font(.system(size: 14, weight: .semibold, design: .rounded))
        .frame(maxWidth: lay.w * 0.5, alignment: .leading)
        .padding(.leading, 18)
        // On the system clock's line.
        .padding(.top, 13)
        .accessibilityHidden(true)
    }

    /// Which stop the Crown is at: the front, the back, the end.
    private var stopMarks: some View {
        let on = Medal.mark(c)
        return VStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.white.opacity(i == on ? 1 : 0.3))
                    .frame(width: 4, height: i == on ? 10 : 4)
            }
        }
        .accessibilityHidden(true)
    }

    private var rest: some View {
        VStack(spacing: 0) {
            ForEach(Array(plates.enumerated()), id: \.offset) { _, plate in
                RecordPlate(name: plate.name, line: plate.line, reps: words.reps, metal: .gold).padding(.bottom, 6)
            }
            SyncLine().frame(maxWidth: .infinity).padding(.top, 4).padding(.bottom, 8)
            Button(action: onDone) { Text("Done") }
                .buttonStyle(PrimaryButtonStyle())
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    /// The record bars: each record with its old and new best; a summary from an older build has
    /// only the names.
    private var plates: [(name: String, line: RecordLine?)] {
        summary.records.isEmpty ? summary.prs.map { ($0, nil) } : summary.records.map { ($0.name, $0) }
    }
}

/* ---------- the engraving ---------- */

/// What is stamped into a face, in face units.
private enum Mark: Equatable {
    enum Align: Equatable { case leading, center, trailing }
    /// The two thin rings round the field's middle.
    case ring
    /// The workout's name round the top: half the rim with a star each side, or 220° when long,
    /// then smaller, then cut. Scripts whose letters join go straight across instead.
    case name(String, arcable: Bool)
    case arc(String, size: Double, tracking: Double, radius: Double, top: Bool, length: Double)
    case text(String, size: Double, tracking: Double, x: Double, y: Double, align: Align, width: Double, mono: Bool = false, opacity: Double = 1)
    case rule(y: Double, half: Double)
}

/// A recessed engraving: the ink, and a light edge 0.9 units under it (none in Always On).
private struct Stamp: View, Equatable {
    let marks: [Mark]
    let metal: Metal
    let u: Double
    let aod: Bool

    var body: some View {
        Canvas { ctx, size in
            ctx.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.scaleBy(x: u, y: u)
            let ink = aod ? metal.aod : metal.ink
            if !aod {
                var hl = ctx
                hl.translateBy(x: 0, y: 0.9)
                for m in marks { Engraver.draw(m, in: hl, color: .white.opacity(0.5), edge: true) }
            }
            for m in marks { Engraver.draw(m, in: ctx, color: ink, edge: false, line: aod ? metal.aodLine : nil) }
        }
        .allowsHitTesting(false)
    }
}

private enum Engraver {
    static func font(_ size: Double, mono: Bool = false) -> Font {
        let f = Font.system(size: size, weight: .heavy, design: .rounded)
        return mono ? f.monospacedDigit() : f
    }

    static func draw(_ m: Mark, in ctx: GraphicsContext, color: Color, edge: Bool, line: Color? = nil) {
        switch m {
        case .ring:
            if edge { return }
            ctx.stroke(Path(ellipseIn: CGRect(x: -61.6, y: -61.6, width: 123.2, height: 123.2)),
                       with: .color(line ?? color.opacity(0.32)), lineWidth: 0.8)
            if line == nil {
                ctx.stroke(Path(ellipseIn: CGRect(x: -62.4, y: -62.4, width: 124.8, height: 124.8)), with: .color(.white.opacity(0.4)), lineWidth: 0.6)
            }
        case .rule(let y, let half):
            if edge { return }
            var p = Path()
            p.move(to: CGPoint(x: -half, y: y))
            p.addLine(to: CGPoint(x: half, y: y))
            ctx.stroke(p, with: .color(line ?? color.opacity(0.55)), lineWidth: 1.1)
        case .name(let s, let arcable):
            name(s, arcable: arcable, in: ctx, color: color)
        case .arc(let s, let size, let tracking, let r, let top, let length):
            let (text, fs) = fit(s, size: size, tracking: tracking, length: length, smallest: 13, in: ctx)
            arc(text, size: fs, tracking: tracking, radius: r, top: top, in: ctx, color: color)
        case .text(let s, let size, let tracking, let x, let y, let align, let width, let mono, let opacity):
            var g = ctx
            g.opacity = opacity
            straight(s, size: size, tracking: tracking, at: CGPoint(x: x, y: y), align: align, width: width, mono: mono, in: g, color: color)
        }
    }

    /// The name round the top. Short: half the rim, a star each side. Long: a 220° arc, down to
    /// 13.5 units, then cut with an ellipsis ("Upper body hypertrophy A" fits whole on 41 mm).
    static func name(_ s: String, arcable: Bool, in ctx: GraphicsContext, color: Color) {
        guard arcable else {
            straight(s, size: 15, tracking: 0.4, at: CGPoint(x: 0, y: -42), align: .center, width: 112, mono: false, in: ctx, color: color)
            return
        }
        if width(s, size: 16, tracking: 1.6, in: ctx) <= 183 {
            arc(s, size: 16, tracking: 1.6, radius: 70, top: true, in: ctx, color: color)
            for x in [-74.0, 74] {
                var g = ctx
                g.translateBy(x: x, y: 0)
                g.scaleBy(x: 0.42, y: 0.42)
                g.fill(sparkle, with: .color(color))
            }
        } else {
            let (text, fs) = fit(s, size: 16, tracking: 0.9, length: 262, smallest: 13.5, in: ctx)
            arc(text, size: fs, tracking: 0.9, radius: 70, top: true, in: ctx, color: color)
        }
    }

    private static func glyph(_ ch: Character, size: Double, in ctx: GraphicsContext) -> (GraphicsContext.ResolvedText, CGSize) {
        let r = ctx.resolve(Text(verbatim: String(ch)).font(font(size)))
        var s = r.measure(in: CGSize(width: 1000, height: 1000))
        if ch == " " { s.width = max(s.width, size * 0.27) }
        return (r, s)
    }

    static func width(_ s: String, size: Double, tracking: Double, in ctx: GraphicsContext) -> Double {
        s.reduce(0) { $0 + glyph($1, size: size, in: ctx).1.width } + tracking * Double(max(s.count - 1, 0))
    }

    /// Smaller until it fits the arc (not under `smallest`), then cut with an ellipsis.
    static func fit(_ s: String, size: Double, tracking: Double, length: Double, smallest: Double, in ctx: GraphicsContext) -> (String, Double) {
        let full = width(s, size: size, tracking: tracking, in: ctx)
        guard full > length else { return (s, size) }
        let fs = max(smallest, ((size * length / full) * 2).rounded(.down) / 2)
        var text = s
        while text.count > 2 && width(text, size: fs, tracking: tracking, in: ctx) > length {
            text = String(text.dropLast(2).trimmingCharacters(in: .whitespaces)) + "…"
        }
        return (text, fs)
    }

    /// One letter at a time along a circle: round the top reading clockwise, letters standing
    /// outward; round the bottom reading left to right, letters standing inward.
    static func arc(_ s: String, size: Double, tracking: Double, radius r: Double, top: Bool, in ctx: GraphicsContext, color: Color) {
        let glyphs = s.map { glyph($0, size: size, in: ctx) }
        let total = glyphs.reduce(0) { $0 + $1.1.width } + tracking * Double(max(glyphs.count - 1, 0))
        var pos = 0.0
        for (glyph, sz) in glyphs {
            var g = glyph
            let mid = pos + sz.width / 2
            let a = top ? -Double.pi / 2 - total / (2 * r) + mid / r : Double.pi / 2 + total / (2 * r) - mid / r
            var gc = ctx
            gc.translateBy(x: r * cos(a), y: r * sin(a))
            gc.rotate(by: .radians(top ? a + .pi / 2 : a - .pi / 2))
            g.shading = .color(color)
            gc.draw(g, at: .zero, anchor: UnitPoint(x: 0.5, y: g.firstBaseline(in: sz) / max(sz.height, 1)))
            pos += sz.width + tracking
        }
    }

    /// A line on its baseline at `at`, smaller to fit `width`.
    static func straight(_ s: String, size: Double, tracking: Double, at: CGPoint, align: Mark.Align, width: Double, mono: Bool,
                         in ctx: GraphicsContext, color: Color) {
        func resolve(_ fs: Double) -> (GraphicsContext.ResolvedText, CGSize) {
            let r = ctx.resolve(Text(verbatim: s).font(font(fs, mono: mono)).tracking(tracking))
            return (r, r.measure(in: CGSize(width: 2000, height: 1000)))
        }
        var (r, sz) = resolve(size)
        if sz.width > width, sz.width > 0 { (r, sz) = resolve(size * width / sz.width) }
        r.shading = .color(color)
        let x: Double = align == .leading ? 0 : align == .center ? 0.5 : 1
        ctx.draw(r, at: at, anchor: UnitPoint(x: x, y: r.firstBaseline(in: sz) / max(sz.height, 1)))
    }

    /// A 4-point star, 7 units each way.
    static let sparkle: Path = {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: -7))
        p.addCurve(to: CGPoint(x: 7, y: 0), control1: CGPoint(x: 0.6, y: -1.2), control2: CGPoint(x: 1.2, y: -0.6))
        p.addCurve(to: CGPoint(x: 0, y: 7), control1: CGPoint(x: 1.2, y: 0.6), control2: CGPoint(x: 0.6, y: 1.2))
        p.addCurve(to: CGPoint(x: -7, y: 0), control1: CGPoint(x: -0.6, y: 1.2), control2: CGPoint(x: -1.2, y: 0.6))
        p.addCurve(to: CGPoint(x: 0, y: -7), control1: CGPoint(x: -1.2, y: -0.6), control2: CGPoint(x: -0.6, y: -1.2))
        p.closeSubpath()
        return p
    }()
}

/// Brushed metal on the front (a sunburst of 257 hairline spokes), circular graining on the back.
private struct Grain: View, Equatable {
    let front: Bool
    let d: Double

    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height / 2), r = size.width / 2
            if front {
                var light = Path(), dark = Path()
                let step = 1.4 * Double.pi / 180
                for i in 0..<Int(2 * Double.pi / step) {
                    let a = Double(i) * step
                    for (path, from) in [(0, a), (1, a + step / 2)] {
                        var wedge = Path()
                        wedge.move(to: c)
                        wedge.addArc(center: c, radius: r, startAngle: .radians(from), endAngle: .radians(from + step / 2), clockwise: false)
                        wedge.closeSubpath()
                        if path == 0 { light.addPath(wedge) } else { dark.addPath(wedge) }
                    }
                }
                ctx.fill(light, with: .color(.white.opacity(0.075)))
                ctx.fill(dark, with: .color(.black.opacity(0.05)))
            } else {
                var light = Path(), dark = Path()
                var k = 0.0
                while k * 1.5 < r {
                    light.addEllipse(in: CGRect(x: c.x - (k * 1.5 + 0.275), y: c.y - (k * 1.5 + 0.275), width: 2 * (k * 1.5 + 0.275), height: 2 * (k * 1.5 + 0.275)))
                    dark.addEllipse(in: CGRect(x: c.x - (k * 1.5 + 1.025), y: c.y - (k * 1.5 + 1.025), width: 2 * (k * 1.5 + 1.025), height: 2 * (k * 1.5 + 1.025)))
                    k += 1
                }
                ctx.stroke(light, with: .color(.white.opacity(0.09)), lineWidth: 0.55)
                ctx.stroke(dark, with: .color(.black.opacity(0.07)), lineWidth: 0.95)
            }
        }
        .clipShape(Circle())
        .allowsHitTesting(false)
    }
}

/// A V cut into the rim per set (48 at most), with a lit edge.
private struct Notches: View, Equatable {
    let sets: Int
    let metal: Metal
    let u: Double
    let aod: Bool

    var body: some View {
        Canvas { ctx, size in
            ctx.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.scaleBy(x: u, y: u)
            var cuts = Path()
            for deg in Medal.notchAngles(sets: sets) {
                let a = deg * .pi / 180, w = 1.7 * .pi / 180, w2 = 0.45 * .pi / 180
                func p(_ r: Double, _ b: Double) -> CGPoint { CGPoint(x: r * cos(b), y: r * sin(b)) }
                cuts.move(to: p(100.5, a - w))
                cuts.addLine(to: p(100.5, a + w))
                cuts.addLine(to: p(89, a + w2))
                cuts.addLine(to: p(89, a - w2))
                cuts.closeSubpath()
            }
            if aod {
                ctx.stroke(cuts, with: .color(metal.aodLine), lineWidth: 1)
            } else {
                ctx.fill(cuts, with: .color(metal.ink.opacity(0.6)))
            }
        }
        .allowsHitTesting(false)
    }
}

/// The notches' lit edges. From 0.5 s a light runs once round the rim, lighting one per set.
private struct NotchLights: View, Equatable {
    let sets: Int
    let t: Double
    let u: Double

    var body: some View {
        Canvas { ctx, size in
            ctx.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.scaleBy(x: u, y: u)
            let angles = Medal.notchAngles(sets: sets)
            for (i, deg) in angles.enumerated() {
                let a = deg * .pi / 180, w = 1.7 * .pi / 180, w2 = 0.45 * .pi / 180
                let at = 0.5 + Double(i) * 0.6 / Double(angles.count)
                let o = t < at ? 0.2 : 0.45 + 0.55 * exp(-(t - at) * 7)
                var p = Path()
                p.move(to: CGPoint(x: 100 * cos(a + w), y: 100 * sin(a + w)))
                p.addLine(to: CGPoint(x: 89.5 * cos(a + w2), y: 89.5 * sin(a + w2)))
                ctx.stroke(p, with: .color(.white.opacity(o)), lineWidth: 0.7)
            }
        }
        .allowsHitTesting(false)
    }
}

/// The back's two empty slots for heart rate and calories, until Apple Health fills them.
private struct Recesses: View {
    let metal: Metal
    let u: Double
    let hr: Bool
    let kcal: Bool
    let aod: Bool

    var body: some View {
        ZStack {
            slot(y: 3.5).opacity(hr ? 0 : 1)
            slot(y: 29.5).opacity(kcal ? 0 : 1)
        }
        .allowsHitTesting(false)
    }

    private func slot(y: Double) -> some View {
        RoundedRectangle(cornerRadius: 5 * u)
            .fill(aod ? Color.clear : metal.ink.opacity(0.14))
            .overlay(RoundedRectangle(cornerRadius: 5 * u).stroke(aod ? metal.aodLine : .clear, lineWidth: 0.7))
            .frame(width: 32 * u, height: 20 * u)
            .offset(x: (-38 + 16) * u, y: (y + 10) * u)
    }
}

/// One diamond per record, each dropping into its setting with a small overshoot and a twinkle.
private struct Gems: View, Equatable {
    let count: Int
    let t: Double
    let metal: Metal
    let u: Double
    let aod: Bool
    let reduce: Bool

    var body: some View {
        Canvas { ctx, size in
            ctx.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.scaleBy(x: u, y: u)
            let (angles, r) = Medal.gems(records: count)
            let times = Medal.gemTimes(records: count)
            for (j, deg) in angles.enumerated() {
                let a = deg * .pi / 180
                let x = Medal.gemRing * cos(a), y = Medal.gemRing * sin(a)
                let at = reduce ? 0.3 : times[j]
                let q = clamp((t - at) / 0.28)
                let scale = reduce || q >= 1 ? 1 : 1 + 0.75 * pow(1 - q, 3) - 0.07 * sin(.pi * q)
                var g = ctx
                g.opacity = reduce ? clamp((t - at) / 0.3) : clamp(q * 3)
                g.translateBy(x: x, y: y)
                g.scaleBy(x: scale, y: scale)
                Gem.draw(in: g, r: r, metal: metal, aod: aod)
                guard !aod && !reduce else { continue }
                let w = (t - at - 0.1) / 0.5
                if w > 0 && w < 1 {
                    let s = sin(.pi * w)
                    star(ctx, x: x + 7.5, y: y - 7.5, scale: s * 0.95, turn: w * 50, opacity: s)
                } else if j == 0 && t > at + 0.6 {
                    star(ctx, x: x + 6.5, y: y - 6.5, scale: 0.5, turn: 0, opacity: 0.9)
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func star(_ ctx: GraphicsContext, x: Double, y: Double, scale: Double, turn: Double, opacity: Double) {
        var g = ctx
        g.translateBy(x: x, y: y)
        g.rotate(by: .degrees(turn))
        g.scaleBy(x: max(scale, 0.001), y: max(scale, 0.001))
        g.fill(Engraver.sparkle, with: .color(.white.opacity(opacity)))
    }
}

/// A round brilliant from above: crown facets round an octagonal table, a bezel and 4 prongs.
private enum Gem {
    static let facets: [Color] = [rgb(0xffffff), rgb(0x6f87ad), rgb(0xe8f1ff), rgb(0x8aa0c4), rgb(0xffffff), rgb(0x5d7499), rgb(0xdbe8fb), rgb(0x9db2d3)]

    static func draw(in ctx: GraphicsContext, r: Double, metal: Metal, aod: Bool) {
        func p(_ rr: Double, _ k: Double) -> CGPoint {
            let a = (k * 45 - 22.5) * .pi / 180
            return CGPoint(x: rr * cos(a), y: rr * sin(a))
        }
        func circle(_ rr: Double, at c: CGPoint = .zero) -> Path { Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: 2 * rr, height: 2 * rr)) }
        func poly(_ pts: [CGPoint]) -> Path { var path = Path(); path.addLines(pts); path.closeSubpath(); return path }
        let table = poly((0..<8).map { p(r * 0.5, Double($0)) })
        if aod {
            ctx.stroke(circle(r * 1.2), with: .color(metal.aodLine), lineWidth: 0.7)
            for k in 0..<8 {
                let k = Double(k)
                ctx.stroke(poly([p(r, k), p(r, k + 0.5), p(r * 0.5, k)]), with: .color(metal.aod), lineWidth: 0.55)
                ctx.stroke(poly([p(r, k + 0.5), p(r, k + 1), p(r * 0.5, k + 1), p(r * 0.5, k)]), with: .color(metal.aod), lineWidth: 0.55)
            }
            ctx.stroke(table, with: .color(metal.aod), lineWidth: 0.55)
            return
        }
        ctx.fill(circle(r * 1.2), with: .color(metal.rimDark))
        ctx.fill(circle(r * 1.06), with: .color(metal.hi.opacity(0.7)))
        for k in 0..<8 {
            let kk = Double(k)
            ctx.fill(poly([p(r, kk), p(r, kk + 0.5), p(r * 0.5, kk)]), with: .color(facets[k]))
            ctx.fill(poly([p(r, kk + 0.5), p(r, kk + 1), p(r * 0.5, kk + 1), p(r * 0.5, kk)]), with: .color(facets[(k + 3) % 8]))
        }
        for k in 0..<4 {
            let prong = circle(r * 0.17, at: p(r * 1.04, Double(k * 2) + 0.5))
            ctx.fill(prong, with: .color(metal.hi))
            ctx.stroke(prong, with: .color(metal.rimDark), lineWidth: 0.35)
        }
        ctx.fill(table, with: .color(rgb(0xf4f9ff)))
        ctx.fill(poly([p(r * 0.5, 5), p(r * 0.5, 6), p(r * 0.12, 5.5)]), with: .color(.white))
        ctx.stroke(table, with: .color(rgb(0x506e96, 0.35)), lineWidth: 0.35)
    }
}

/// One glint across the face: a band of added light, masked to the field.
private struct Glint: View {
    let progress: Double
    let field: Double

    var body: some View {
        let x = 0.19 * field + lerp(-1.3, 3, smooth(progress)) * 0.38 * field - field / 2
        LinearGradient(colors: [.white.opacity(0), .white.opacity(0.38), .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
            .frame(width: field * 0.38, height: field * 1.6)
            .rotationEffect(.degrees(22))
            .offset(x: x)
            .frame(width: field, height: field)
            .clipShape(Circle())
            .blendMode(.plusLighter)
            .allowsHitTesting(false)
    }
}

/// The medal's edge while it turns: an orthographic coin, its far face's outline, the band between
/// the faces, and one groove across the band per set.
private struct Edge: View {
    let th: Double
    let sets: Int
    let metal: Metal
    let u: Double

    var body: some View {
        Canvas { ctx, size in
            ctx.translateBy(x: size.width / 2, y: size.height / 2)
            ctx.scaleBy(x: u, y: u)
            let cs = cos(th), sn = sin(th), fx = thickness / 2 * sn, rx = 100 * abs(cs)
            let band = GraphicsContext.Shading.linearGradient(
                Gradient(stops: [.init(color: metal.sh, location: 0), .init(color: metal.hi, location: 0.3),
                                 .init(color: metal.md, location: 0.55), .init(color: metal.sh, location: 1)]),
                startPoint: CGPoint(x: 0, y: -100), endPoint: CGPoint(x: 0, y: 100))
            ctx.fill(Path(ellipseIn: CGRect(x: -fx - rx, y: -100, width: 2 * rx, height: 200)), with: band)
            ctx.fill(Path(ellipseIn: CGRect(x: fx - rx, y: -100, width: 2 * rx, height: 200)), with: band)
            ctx.fill(Path(CGRect(x: -abs(fx), y: -100, width: 2 * abs(fx), height: 200)), with: band)
            for deg in Medal.notchAngles(sets: sets) {
                let ph = deg * .pi / 180
                guard cos(ph) * sn < 0 else { continue }   // only the grooves on the side we see
                let x0 = 100 * cos(ph) * cs, y = 100 * sin(ph)
                var groove = Path(), lit = Path()
                groove.move(to: CGPoint(x: x0 - fx, y: y))
                groove.addLine(to: CGPoint(x: x0 + fx, y: y))
                lit.move(to: CGPoint(x: x0 - fx, y: y + 1.6))
                lit.addLine(to: CGPoint(x: x0 + fx, y: y + 1.6))
                ctx.stroke(groove, with: .color(metal.ink.opacity(0.55)), lineWidth: 2.4)
                ctx.stroke(lit, with: .color(.white.opacity(0.35)), lineWidth: 0.8)
            }
        }
        .allowsHitTesting(false)
    }
}

/// Ten sparks thrown off the rim by the strike.
private struct Sparks: View {
    let progress: Double
    let d: Double
    let color: Color

    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            for i in 0..<10 {
                let a = Double(i * 36 + 13 * (i % 3)) * .pi / 180
                let r = d / 2 + 4 + Double(10 + 12 * (i % 3)) * (1 - pow(1 - progress, 2))
                let p = CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a))
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6)), with: .color(color.opacity(0.3 * (1 - progress))))
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 1.1, y: p.y - 1.1, width: 2.2, height: 2.2)), with: .color(color.opacity(1 - progress)))
            }
        }
    }
}

/* ---------- a record bar ---------- */

/// A gold bar per record: the exercise, then its old best (dimmed) to its new one.
private struct RecordPlate: View {
    let name: String
    let line: RecordLine?
    let reps: String
    let metal: Metal
    @Environment(\.locale) private var locale
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .footnote) private var nameSize: CGFloat = 12
    @ScaledMetric(relativeTo: .title3) private var valueSize: CGFloat = 18

    var body: some View {
        HStack(spacing: 6) {
            Canvas { ctx, size in
                ctx.translateBy(x: size.width / 2, y: size.height / 2)
                ctx.scaleBy(x: size.width / 20, y: size.width / 20)
                Gem.draw(in: ctx, r: 6.6, metal: metal, aod: dimmed)
            }
            .frame(width: 21, height: 21)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: name.uppercased(with: locale))
                    .font(.system(size: nameSize, weight: .heavy, design: .rounded))
                    .tracking(0.4)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if let line { value(line) }
            }
        }
        .foregroundStyle(dimmed ? metal.aod : metal.ink)
        .padding(EdgeInsets(top: 6, leading: 7, bottom: 7, trailing: 10))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
            if dimmed {
                shape.strokeBorder(metal.aodLine, lineWidth: 1)
            } else {
                shape.fill(LinearGradient(stops: [.init(color: rgb(0xf6e3a6), location: 0), .init(color: rgb(0xdcb45e), location: 0.42),
                                                  .init(color: rgb(0xc19a48), location: 0.72), .init(color: rgb(0xdcbb6c), location: 1)],
                                          startPoint: UnitPoint(x: 0.33, y: 0), endPoint: UnitPoint(x: 0.67, y: 1)))
                    .overlay(shape.strokeBorder(LinearGradient(stops: [.init(color: .white.opacity(0.65), location: 0), .init(color: .clear, location: 0.12),
                                                                       .init(color: .clear, location: 0.88), .init(color: .black.opacity(0.25), location: 1)],
                                                               startPoint: .top, endPoint: .bottom), lineWidth: 1))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: spoken))
    }

    private func value(_ line: RecordLine) -> some View {
        let (old, new) = line.texts(locale: locale)
        let unit = line.kind == .hold ? "" : line.kind == .reps ? " " + reps : " " + line.unit
        let big = Font.system(size: valueSize, weight: .heavy, design: .rounded).monospacedDigit()
        return (Text(verbatim: old).foregroundColor((dimmed ? metal.aod : metal.ink).opacity(0.6))
                + Text(verbatim: " → ").font(.system(size: valueSize * 0.72, weight: .heavy, design: .rounded)).foregroundColor((dimmed ? metal.aod : metal.ink).opacity(0.7))
                + Text(verbatim: new)
                + Text(verbatim: unit).font(.system(size: valueSize * 0.67, weight: .heavy, design: .rounded)))
            .font(big)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }

    /// "Bench Press, 105 kg": the record itself.
    private var spoken: String {
        guard let line else { return name }
        let new = line.texts(locale: locale).new
        return "\(name), \(new)\(line.kind == .hold ? "" : line.kind == .reps ? " " + reps : " " + line.unit)"
    }
}
