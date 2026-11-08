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
    /// resolves to here. `when`: false while something sits over the screen (a keypad, a dialog).
    func doubleTapTarget(_ effect: GestureEffect?, when ready: Bool = true) -> some View {
        modifier(DoubleTapTarget(effect: effect, ready: ready))
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
    let ready: Bool

    func body(content: Content) -> some View {
        content.doubleTapShortcut(ready && !dimmed && effect != nil && store.doubleTapEffect == effect)
    }
}

/// "Next exercise" has no button on screen (the set page is full), so Double Tap gets a real one
/// that is not drawn: it does nothing for a finger, and its action ticks the wrist.
struct NextExerciseTarget: View {
    @EnvironmentObject var store: SessionStore

    var body: some View {
        Button { store.perform(.nextExercise) } label: { Color.clear }
            .buttonStyle(.plain)
            .frame(width: 1, height: 1)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .doubleTapTarget(.nextExercise)
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
