import SwiftUI
import WatchKit

/*
 * Double Tap (Series 9 and later, Ultra 2): the system presses the one control marked
 * .handGestureShortcut(.primaryAction) and draws the highlight itself. Which control that is
 * comes from WatchCore's Gestures.resolve through SessionStore.doubleTapEffect, so exactly one is
 * enabled at a time. Never with the screen dimmed (the wrist is down) and never on the scrolling
 * pages (the Overview with its Finish, Metrics, Music): the resolver gives nothing there.
 */

extension View {
    /// Double Tap presses this control while `enabled`. Before watchOS 11 there is no such thing.
    func doubleTapShortcut(_ enabled: Bool) -> some View { modifier(DoubleTapShortcut(enabled: enabled)) }

    /// The control that does `effect`: Double Tap presses it while that is what the lifter's choice
    /// resolves to here (and nothing sits over the screen).
    func doubleTapTarget(_ effect: GestureEffect?) -> some View { modifier(DoubleTapTarget(effect: effect)) }

    /// Marks a keypad or dialog that `up` shows: until it closes, no gesture reaches what is behind it.
    func gestureOverlay(_ up: Bool) -> some View { modifier(GestureOverlay(up: up)) }
}

struct GestureOverlay: ViewModifier {
    @EnvironmentObject var store: SessionStore
    let up: Bool

    func body(content: Content) -> some View {
        content
            .onChange(of: up) { store.overlayUp = $0 }
            // Gone while its dialog was open: nothing else would clear it.
            .onDisappear { if up { store.overlayUp = false } }
    }
}

struct DoubleTapShortcut: ViewModifier {
    let enabled: Bool

    func body(content: Content) -> some View {
        if #available(watchOS 11, *) {
            content.handGestureShortcut(.primaryAction, isEnabled: enabled)
        } else {
            content
        }
    }
}

struct DoubleTapTarget: ViewModifier {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed
    let effect: GestureEffect?

    func body(content: Content) -> some View {
        content.doubleTapShortcut(!dimmed && effect != nil && store.doubleTapEffect == effect)
    }
}

/// The phone's "test it": a button with the Double Tap shortcut. Pressed (by a pinch, or by hand),
/// the wrist confirms and the phone is told.
struct GestureTestSheet: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.tap.fill")
                .font(.system(size: 30))
                .foregroundStyle(store.accent)
                .accessibilityHidden(true)
            Text("Double tap now")
                .font(.system(.headline, design: .rounded))
                .multilineTextAlignment(.center)
            Button { store.gestureTestPassed() } label: { Text("Done") }
                .buttonStyle(PrimaryButtonStyle())
                .doubleTapShortcut(!dimmed)
        }
        .padding(.horizontal, 6)
    }
}
