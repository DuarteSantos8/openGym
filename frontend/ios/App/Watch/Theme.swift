import SwiftUI
import WatchKit

/*
 * openGym's look on the wrist: the app's dark theme (frontend/src/index.css) as Swift tokens, and
 * the few controls every screen shares. Black page, grey surfaces one step up, the accent only on
 * the one thing to press. The accent is the app's own, as the phone sends it (WatchSettings.accent),
 * handed down as an environment value so a change on the phone recolours every screen at once.
 *
 * Always On (wrist down): no lit fills, only their outlines, and the text a little dimmer. The
 * screen is updated rarely then and every lit pixel costs.
 */
enum Theme {
    /// The brand's green (#a3e635, the logo's and a new profile's accent since 1.4.5), until the
    /// phone has said which accent it wears. It is light, so the ink on it is near-black (onAccent).
    static let green = Color(red: 0xa3 / 255, green: 0xe6 / 255, blue: 0x35 / 255)
    static let accent = green
    /// The brand's near-black (#0c0e12): what reads on the green.
    static let onGreen = Color(red: 0x0c / 255, green: 0x0e / 255, blue: 0x12 / 255)
    static let orange = Color(red: 1, green: 0x9f / 255, blue: 0x0a / 255)
    static let red = Color(red: 1, green: 0x45 / 255, blue: 0x3a / 255)
    static let yellow = Color(red: 1, green: 0xd6 / 255, blue: 0x0a / 255)
    static let teal = Color(red: 0x40 / 255, green: 0xc8 / 255, blue: 0xe0 / 255)
    static let purple = Color(red: 0xbf / 255, green: 0x5a / 255, blue: 0xf2 / 255)
    /// Warm-up sets (the app's --orange).
    static let warmup = orange
    /// --surface and --surface-2: a card, and what sits on a card or is pressed.
    static let surface = Color(red: 0x1c / 255, green: 0x1c / 255, blue: 0x1e / 255)
    static let surface2 = Color(red: 0x2c / 255, green: 0x2c / 255, blue: 0x2e / 255)
    /// --label-2 and --label-3: secondary and quiet text.
    static let label2 = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.6)
    static let label3 = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.32)
    /// A control's fill (a box, a small round button).
    static let dim = surface2
    /// The corner of a box or card: a continuous curve, like the app's cards.
    static let radius: CGFloat = 14
    /// The smallest a thing a finger has to hit may be.
    static let tap: CGFloat = 44
}

private struct AccentKey: EnvironmentKey { static let defaultValue: Color = Theme.green }
private struct OnAccentKey: EnvironmentKey { static let defaultValue: Color = Theme.onGreen }

extension EnvironmentValues {
    /// The app's accent, as the phone sends it.
    var accent: Color {
        get { self[AccentKey.self] }
        set { self[AccentKey.self] = newValue }
    }
    /// What reads on the accent (black on green, white on blue).
    var onAccent: Color {
        get { self[OnAccentKey.self] }
        set { self[OnAccentKey.self] = newValue }
    }
}

extension Color {
    /// "#a3e635" as a colour, nil for anything else (WatchCore's Hex).
    init?(hex: String?) {
        guard let c = Hex.rgb(hex) else { return nil }
        self.init(red: c.r, green: c.g, blue: c.b)
    }
}

func formatNumber(_ v: Double) -> String {
    // SafeNum: a weight of 1e20 (a typo on the phone) or infinity would trap Int(v).
    if v.rounded() == v { return String(SafeNum.int(v)) }
    // 62.25 keeps its second decimal (a keypad value), 62.5 has one.
    let two = String(format: "%.2f", v)
    return two.hasSuffix("0") ? String(format: "%.1f", v) : two
}

/* ---------- buttons ---------- */

extension Theme {
    /// Liquid Glass draws its own edge; outlines that stood in for it go.
    static var hasGlass: Bool { if #available(watchOS 26, *) { return true } else { return false } }
}

extension View {
    /// Liquid Glass behind a control on watchOS 26 (tinted when given), `fill` before 26 and in Always On.
    @ViewBuilder func glass<S: Shape>(_ shape: S, tint: Color? = nil, fill: Color, dimmed: Bool) -> some View {
        if #available(watchOS 26, *), !dimmed {
            glassEffect(tint.map { Glass.regular.tint($0).interactive() } ?? .regular.interactive(), in: shape)
        } else {
            background(shape.fill(fill))
        }
    }
}

/// The one type scale for every screen (owner 2026-11-11): six roles, nothing under 12 pt. Text styles,
/// so Dynamic Type still scales them. Text outside a card starts 10 pt from the screen's edge. Metrics keeps Apple Workout's own sizes (owner 2026-11-10).
enum TypeScale {
    static let title = Font.system(.title3, design: .rounded).weight(.bold)          // ~20: names and page titles
    static let body = Font.system(.body, design: .rounded).weight(.semibold)         // ~17: rows, pills, buttons
    static let second = Font.system(.callout, design: .rounded)                      // ~15, grey: the line under
    static let label = Font.system(.caption, design: .rounded).weight(.bold)         // ~12, capitals: WEIGHT, KG
    static let number: CGFloat = 40   // the set's boxes grow to this, never past it
    static let hero: CGFloat = 60     // the rest and hold countdowns only
    static let pill: CGFloat = 26     // every pill's height
}

/// The one thing to press on a screen: full width, a capsule in the accent, the ink on it.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.accent) private var accent
    @Environment(\.onAccent) private var onAccent
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(dimmed ? accent : onAccent)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: Theme.tap)
            .glass(Capsule(), tint: accent, fill: dimmed ? Color.clear : accent, dimmed: dimmed)
            .overlay(Capsule().stroke(accent, lineWidth: dimmed ? 1.5 : 0))
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.35)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A quieter choice: a grey row, like a row in the app's grouped lists.
struct RowButtonStyle: ButtonStyle {
    var tint: Color = .white
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.body, design: .rounded))
            .foregroundStyle(tint.opacity(dimmed ? 0.7 : 1))
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: Theme.tap, alignment: .leading)
            .glass(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous),
                   fill: dimmed ? Color.clear : (configuration.isPressed ? Theme.surface2 : Theme.surface), dimmed: dimmed)
            .overlay(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous).stroke(Theme.surface2, lineWidth: dimmed ? 1 : 0))
            .contentShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .opacity(enabled ? 1 : 0.35)
    }
}

/// A word in a small capsule: "Warm-up", "Left", "Superset".
struct Tag: View {
    let text: Text
    let color: Color

    var body: some View {
        text
            .font(TypeScale.label)
            .textCase(.uppercase)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.18)))
    }
}

/// A big round primary button (the 3-2-1, older screens): an SF Symbol on the accent.
struct RoundButton: View {
    let systemImage: String
    let label: Text
    var size: CGFloat = 76
    /// The label under the button, said in words (on by default: "Done" under the check).
    var caption = true
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed
    @Environment(\.accent) private var accent
    @Environment(\.onAccent) private var onAccent

    var body: some View {
        VStack(spacing: 3) {
            Button(action: action) {
                Image(systemName: systemImage)
                    .font(.system(size: size * 0.44, weight: .heavy))
                    .foregroundStyle(dimmed ? accent : onAccent)
                    .frame(width: size, height: size)
                    .glass(Circle(), tint: accent, fill: dimmed ? Color.clear : accent, dimmed: dimmed)
                    .overlay(Circle().stroke(accent, lineWidth: dimmed ? 2 : 0))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
            if caption { label.font(TypeScale.label).foregroundStyle(dimmed ? Color.secondary : accent).lineLimit(1) }
        }
    }
}

/// A small round secondary button: an SF Symbol on a grey disc, a 44 pt target.
struct EdgeButton: View {
    let systemImage: String
    let label: Text
    var size: CGFloat = Theme.tap
    let action: () -> Void
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.white.opacity(dimmed ? 0.7 : 1))
                .frame(width: size, height: size)
                .glass(Circle(), fill: dimmed ? Color.clear : Theme.dim, dimmed: dimmed)
                .overlay(Circle().stroke(Theme.dim, lineWidth: dimmed ? 1 : 0))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// Water Lock, as Apple's Workout has it: the screen and the crown's press stop doing anything
/// (a sleeve or a bent wrist no longer leaves the workout or taps Done); turning the crown unlocks.
/// watchOS allows it only while a workout session runs, so without Apple Health there is none.
struct LockButton: View {
    @ObservedObject var health: WorkoutManager

    var body: some View {
        if health.running {
            EdgeButton(systemImage: "drop.fill", label: Text("Lock")) { WKInterfaceDevice.current().enableWaterLock() }
        }
    }
}
